import type Stripe from "stripe";
import { sql } from "@/lib/db";
import { getStripe } from "@/lib/stripe";
import { CONSIGNOR_SHARE } from "@/lib/types";
import { sendPayoutNotice } from "@/lib/email";

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
      SELECT r.id, r.rental_price, i.ownership, i.consignor_id,
             COALESCE(NULLIF(i.name, ''), i.brand) AS brand
      FROM rentals r JOIN items i ON i.id = r.item_id
      WHERE r.id = ${rentalId}
    `;
    const r = rows[0];
    if (!r || r.ownership !== "consignment" || !r.consignor_id) return;

    const amount = Math.round(Number(r.rental_price) * CONSIGNOR_SHARE * 100) / 100;
    if (amount <= 0) return; // free/ambassador rental — nothing owed

    // Claim the rental's payout slot. ON CONFLICT → already handled, stop here.
    const inserted = await sql`
      INSERT INTO payouts (consignor_id, amount, method, status, auto, rental_id, notes)
      VALUES (${r.consignor_id}, ${amount}, 'stripe', 'pending', true, ${rentalId},
              ${"Auto payout · " + r.brand})
      ON CONFLICT (rental_id) DO NOTHING
      RETURNING id
    `;
    // Row created as 'pending' — it accrues in the consignor's ledger. Payout
    // happens later when the owner pays the balance in one action (or on the
    // consignor's schedule); we don't auto-transfer here.
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
      ON CONFLICT (loss_rental_id) DO NOTHING
      RETURNING id
    `;
    // Accrues as 'pending' in the ledger regardless of whether we recover the
    // charge from the renter; paid out later with the owed balance.
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
      SET status = 'paid', stripe_transfer_id = ${transfer.id}, paid_at = CURRENT_DATE
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
    console.error(`[connect] transfer for payout ${payoutId} deferred:`, (err as Error).message);
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
