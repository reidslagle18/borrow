import type Stripe from "stripe";
import { sql } from "@/lib/db";
import { getStripe } from "@/lib/stripe";
import { sendPayoutNotice, sendConsignorLossNotice } from "@/lib/email";

/**
 * Stripe Connect — automatic bank payouts to consignors.
 *
 * Model: each consignor has an Express connected account. A single checkout can
 * mix pieces from different consignors (and owned stock), so we DON'T split the
 * charge; instead, when a consignment rental is checked back in (completed), we
 * send a separate Transfer of that rental's 60% share to the consignor. A
 * payout row is keyed UNIQUELY to the rental, so a rental never pays twice.
 *
 * Payouts that can't go out yet (consignor not onboarded, or platform funds not
 * settled) are stored as 'pending' and retried by the cron sweep / on the
 * account.updated webhook.
 */

type ConsignorRow = {
  id: number;
  name: string;
  email: string | null;
  stripe_account_id: string | null;
  payouts_enabled: boolean;
};

/** Create (once) and return the consignor's Express connected account id. */
export async function getOrCreateConnectedAccount(
  stripe: Stripe,
  consignor: ConsignorRow
): Promise<string> {
  if (consignor.stripe_account_id) return consignor.stripe_account_id;
  const account = await stripe.accounts.create({
    type: "express",
    country: "US",
    email: consignor.email ?? undefined,
    business_type: "individual",
    capabilities: { transfers: { requested: true } },
    metadata: { consignor_id: String(consignor.id) },
  });
  await sql`UPDATE consignors SET stripe_account_id = ${account.id} WHERE id = ${consignor.id}`;
  return account.id;
}

/** A hosted onboarding link (collects bank + identity). Single-use, ~minutes. */
export async function createOnboardingLink(
  stripe: Stripe,
  accountId: string,
  returnUrl: string,
  refreshUrl: string
): Promise<string> {
  const link = await stripe.accountLinks.create({
    account: accountId,
    return_url: returnUrl,
    refresh_url: refreshUrl,
    type: "account_onboarding",
  });
  return link.url;
}

/** Whether a Stripe account can actually receive transfers right now. */
function isPayoutReady(acct: Stripe.Account): boolean {
  return !!acct.payouts_enabled && acct.capabilities?.transfers === "active";
}

/**
 * The consignor-facing truth about their direct deposit, resolved live from
 * Stripe when the cached flag says "not ready":
 *  - active: money flows automatically, nothing to do
 *  - action_needed: Stripe still needs something from them (resume onboarding)
 *  - verifying: they finished their part; Stripe is verifying — nothing to do
 * Also self-heals the cached payouts_enabled flag and releases queued payouts
 * the moment an account turns active.
 */
export async function getDepositStatus(c: {
  id: number;
  stripe_account_id: string | null;
  payouts_enabled: boolean;
}): Promise<{ active: boolean; started: boolean; action_needed: boolean; verifying: boolean }> {
  const started = !!c.stripe_account_id;
  let active = !!c.payouts_enabled;
  let action_needed = false;
  let verifying = false;
  if (started && !active) {
    const stripe = getStripe();
    if (stripe) {
      try {
        const acct = await stripe.accounts.retrieve(c.stripe_account_id as string);
        active = isPayoutReady(acct);
        if (active) {
          await sql`UPDATE consignors SET payouts_enabled = true WHERE id = ${c.id}`;
          await sweepPendingPayouts(c.id); // release anything already earned
        } else {
          const req = acct.requirements;
          const due = [
            ...(req?.currently_due ?? []),
            ...(req?.past_due ?? []),
          ];
          action_needed = due.length > 0 || !acct.details_submitted;
          verifying = !action_needed;
        }
      } catch {
        /* keep cached values */
      }
    }
  }
  return { active, started, action_needed, verifying };
}

/** Refresh the cached payouts_enabled flag for a connected account. */
export async function refreshConsignorPayoutStatus(
  stripe: Stripe,
  accountId: string
): Promise<boolean> {
  const acct = await stripe.accounts.retrieve(accountId);
  const ready = isPayoutReady(acct);
  await sql`UPDATE consignors SET payouts_enabled = ${ready} WHERE stripe_account_id = ${accountId}`;
  return ready;
}

/**
 * Pay a consignor their share for one just-completed rental. Idempotent: claims
 * the rental via a UNIQUE payout row first, so concurrent calls / retries can't
 * double-pay. Records 'paid' on a successful transfer, otherwise 'pending' for
 * the sweep to retry. Never throws to its caller — payout problems must not
 * block checking a piece back in.
 */
export async function payoutForCompletedRental(rentalId: number): Promise<void> {
  try {
    const rows = await sql`
      SELECT r.id, r.rental_price, r.source, i.ownership, i.consignor_id,
             COALESCE(c.consignor_rate, 60) AS rate,
             COALESCE(NULLIF(i.name, ''), i.brand) AS brand
      FROM rentals r JOIN items i ON i.id = r.item_id
      LEFT JOIN consignors c ON c.id = i.consignor_id
      WHERE r.id = ${rentalId}
    `;
    const r = rows[0];
    if (!r || r.ownership !== "consignment" || !r.consignor_id) return;

    // Consignor's own locked rate (Borrow keeps the rest), not a flat 60/40.
    // Always their normal cut = rate × the IN-STORE price — same on e.closet as
    // in store (the e.closet markup is Borrow's; consignors are paid the same).
    const gross = Math.round(Number(r.rental_price) * (Number(r.rate) / 100) * 100) / 100;
    if (gross <= 0) return; // nothing owed

    // Withhold any money the consignor owes back (e.g. a payout sent in error)
    // from this payout, up to the whole amount, until it's fully recovered.
    const recs = await sql`
      SELECT id, amount, recovered FROM consignor_recoveries
      WHERE consignor_id = ${r.consignor_id} AND resolved_at IS NULL
      ORDER BY id ASC`;
    let outstanding = 0;
    for (const x of recs) outstanding += Number(x.amount) - Number(x.recovered);
    outstanding = Math.round(Math.max(0, outstanding) * 100) / 100;
    const withhold = Math.round(Math.min(gross, outstanding) * 100) / 100;
    const amount = Math.round((gross - withhold) * 100) / 100;

    const label = r.source === "ecloset" ? "e.closet payout · " : "Auto payout · ";
    const note = withhold > 0 ? `${label}${r.brand} (−$${withhold} withheld to recover a prior overpayment)` : `${label}${r.brand}`;

    // Claim the rental's payout slot (idempotent via the PARTIAL unique index on
    // rental_id). A fully-withheld payout is $0 and marked paid so the sweep skips it.
    const inserted = await sql`
      INSERT INTO payouts (consignor_id, amount, method, status, auto, rental_id, notes)
      VALUES (${r.consignor_id}, ${amount}, 'stripe', ${amount > 0 ? "pending" : "paid"}, true, ${rentalId},
              ${note})
      ON CONFLICT (rental_id) WHERE rental_id IS NOT NULL DO NOTHING
      RETURNING id
    `;
    if (inserted.length > 0) {
      // Apply the withholding across the open recovery rows — once, tied to the
      // freshly-created payout row so a retry can't double-recover.
      let toApply = withhold;
      for (const x of recs) {
        if (toApply <= 0.001) break;
        const remaining = Math.round((Number(x.amount) - Number(x.recovered)) * 100) / 100;
        if (remaining <= 0) continue;
        const take = Math.round(Math.min(remaining, toApply) * 100) / 100;
        const newRecovered = Math.round((Number(x.recovered) + take) * 100) / 100;
        await sql`
          UPDATE consignor_recoveries
          SET recovered = ${newRecovered},
              resolved_at = CASE WHEN ${newRecovered} >= amount THEN now() ELSE resolved_at END
          WHERE id = ${x.id}`;
        toApply = Math.round((toApply - take) * 100) / 100;
      }
      // Send the remainder to their bank if onboarded (only when >$0).
      if (amount > 0) {
        await trySendPayout(
          Number(inserted[0].id),
          Number(r.consignor_id),
          amount,
          `payout_rental_${rentalId}`
        );
      }
    }
  } catch (err) {
    console.error(`[connect] payoutForCompletedRental(${rentalId}) failed:`, (err as Error).message);
  }
}

/**
 * Total-loss payout: owe the consignor the FULL agreed replacement value when
 * their piece is lost / damaged beyond repair. Created and owed regardless of
 * whether we recover the amount from the renter. Idempotent per rental via the
 * unique loss_rental_id. Distinct from the normal 60% rental payout.
 */
export async function createConsignorLossPayout(rentalId: number): Promise<void> {
  try {
    const rows = await sql`
      SELECT r.id, r.replacement_value AS rental_repl, i.ownership, i.consignor_id,
             i.replacement_value AS item_repl,
             COALESCE(NULLIF(i.name, ''), i.brand) AS brand
      FROM rentals r JOIN items i ON i.id = r.item_id
      WHERE r.id = ${rentalId}
    `;
    const r = rows[0];
    if (!r || r.ownership !== "consignment" || !r.consignor_id) return;

    // Prefer the value recorded on the rental at loss time; fall back to the
    // piece's current replacement value.
    const amount = Math.round(
      Number(r.rental_repl ?? r.item_repl ?? 0) * 100
    ) / 100;
    if (amount <= 0) return;

    const inserted = await sql`
      INSERT INTO payouts (consignor_id, amount, method, status, auto, kind, loss_rental_id, notes)
      VALUES (${r.consignor_id}, ${amount}, 'stripe', 'pending', true, 'loss', ${rentalId},
              ${"Replacement (total loss) · " + r.brand})
      ON CONFLICT (loss_rental_id) WHERE loss_rental_id IS NOT NULL DO NOTHING
      RETURNING id
    `;
    // Owed regardless of whether we recover from the renter. Auto-send it to the
    // consignor's bank now if they're onboarded; otherwise it stays 'pending'
    // for the sweep. Only for a freshly-created row (idempotent).
    if (inserted.length > 0) {
      // Tell the consignor their piece was lost and the replacement is coming
      // (best-effort; only on a freshly-created loss row so it can't double-send).
      try {
        const c = (
          await sql`SELECT name, email FROM consignors WHERE id = ${r.consignor_id}`
        )[0];
        if (c?.email) {
          await sendConsignorLossNotice({
            to: String(c.email),
            consignorName: String(c.name || ""),
            itemBrand: String(r.brand),
            amount,
          });
        }
      } catch {
        /* non-fatal — the payout still happens */
      }
      await trySendPayout(
        Number(inserted[0].id),
        Number(r.consignor_id),
        amount,
        `payout_loss_${rentalId}`
      );
    }
  } catch (err) {
    console.error(`[connect] createConsignorLossPayout(${rentalId}) failed:`, (err as Error).message);
  }
}

/**
 * Attempt the actual Stripe transfer for an existing pending payout row. Leaves
 * it 'pending' (for retry) if the consignor isn't onboarded or funds aren't
 * available yet. Safe to call repeatedly — the idempotency key is the rental.
 */
async function trySendPayout(
  payoutId: number,
  consignorId: number,
  amount: number,
  idempotencyKey: string
): Promise<void> {
  const stripe = getStripe();
  if (!stripe) return;

  const c = (
    await sql`SELECT id, name, email, stripe_account_id, payouts_enabled FROM consignors WHERE id = ${consignorId}`
  )[0] as ConsignorRow | undefined;
  if (!c || !c.stripe_account_id || !c.payouts_enabled) return; // not ready — stays pending

  try {
    const transfer = await stripe.transfers.create(
      {
        amount: Math.round(amount * 100),
        currency: "usd",
        destination: c.stripe_account_id,
        transfer_group: idempotencyKey,
        metadata: { consignor_id: String(consignorId), payout_id: String(payoutId) },
      },
      { idempotencyKey }
    );
    await sql`
      UPDATE payouts
      SET status = 'paid', stripe_transfer_id = ${transfer.id}, paid_at = (now() AT TIME ZONE 'America/Chicago')::date
      WHERE id = ${payoutId}
    `;
    if (c.email) {
      await sendPayoutNotice({
        to: c.email,
        consignorName: c.name ?? "",
        amount,
        method: "Direct deposit",
      }).catch(() => {});
    }
  } catch (err) {
    // Insufficient available balance / temporary issue → keep pending for the
    // cron sweep. A hard failure also stays pending and is visible in the admin.
    const msg = (err as Error).message;
    console.error(`[connect] transfer for payout ${payoutId} deferred:`, msg);
    await sql`
      UPDATE payouts SET notes = ${"[deferred] " + msg.slice(0, 400)}
      WHERE id = ${payoutId}
    `.catch(() => {});
  }
}

/**
 * Retry pending auto-payouts. Optionally scoped to one consignor (used right
 * after their onboarding completes); otherwise sweeps everyone (cron).
 */
export async function sweepPendingPayouts(consignorId?: number): Promise<{ attempted: number }> {
  const pending = consignorId
    ? await sql`
        SELECT id, consignor_id, amount, kind, rental_id, loss_rental_id FROM payouts
        WHERE status = 'pending' AND auto = true
          AND (rental_id IS NOT NULL OR loss_rental_id IS NOT NULL)
          AND consignor_id = ${consignorId}
        ORDER BY id ASC`
    : await sql`
        SELECT p.id, p.consignor_id, p.amount, p.kind, p.rental_id, p.loss_rental_id FROM payouts p
        JOIN consignors c ON c.id = p.consignor_id
        WHERE p.status = 'pending' AND p.auto = true
          AND (p.rental_id IS NOT NULL OR p.loss_rental_id IS NOT NULL)
          AND c.payouts_enabled = true
        ORDER BY p.id ASC`;

  for (const p of pending) {
    const key =
      p.kind === "loss"
        ? `payout_loss_${p.loss_rental_id}`
        : `payout_rental_${p.rental_id}`;
    await trySendPayout(Number(p.id), Number(p.consignor_id), Number(p.amount), key);
  }
  return { attempted: pending.length };
}
