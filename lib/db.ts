import { neon } from "@neondatabase/serverless";

type NeonClient = ReturnType<typeof neon>;
type SqlTag = (
  strings: TemplateStringsArray,
  ...values: unknown[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
) => Promise<any[]>;

let client: NeonClient | null = null;

// Lazy init so importing this module never requires DATABASE_URL at build time.
export const sql: SqlTag = (strings, ...values) => {
  if (!client) client = neon(process.env.DATABASE_URL!);
  return client(strings, ...values) as ReturnType<SqlTag>;
};

let schemaReady: Promise<void> | null = null;

async function createSchema(): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS consignors (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      notes TEXT,
      portal_code TEXT UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  // Consignor payout details (how BORROW sends them their money).
  await sql`ALTER TABLE consignors ADD COLUMN IF NOT EXISTS venmo TEXT`;
  await sql`ALTER TABLE consignors ADD COLUMN IF NOT EXISTS payout_backup TEXT`;
  // Stripe Connect (automatic bank payouts). stripe_account_id is their Express
  // connected account; payouts_enabled is cached from Stripe once onboarding +
  // identity/bank verification is complete and transfers are active.
  await sql`ALTER TABLE consignors ADD COLUMN IF NOT EXISTS stripe_account_id TEXT`;
  await sql`ALTER TABLE consignors ADD COLUMN IF NOT EXISTS payouts_enabled BOOLEAN NOT NULL DEFAULT false`;
  // When the welcome (payout-setup) email was last sent, so we can show it.
  await sql`ALTER TABLE consignors ADD COLUMN IF NOT EXISTS welcome_sent_at TIMESTAMPTZ`;
  // Last time an "items awaiting your approval" email went out — used to avoid
  // emailing the same consignor more than once a day.
  await sql`ALTER TABLE consignors ADD COLUMN IF NOT EXISTS approval_email_sent_at TIMESTAMPTZ`;
  // Per-consignor commission rate (%), locked once at signing and never changed
  // automatically. agreement_signed_rate/terms snapshot exactly what they signed.
  await sql`ALTER TABLE consignors ADD COLUMN IF NOT EXISTS consignor_rate INT`;
  await sql`ALTER TABLE consignors ADD COLUMN IF NOT EXISTS agreement_signed_rate INT`;
  await sql`ALTER TABLE consignors ADD COLUMN IF NOT EXISTS agreement_signed_terms TEXT`;
  // Signed consignor agreement record (digital signature): typed legal name,
  // timestamp, and IP captured at signing, plus the agreement version signed.
  await sql`ALTER TABLE consignors ADD COLUMN IF NOT EXISTS agreement_signed_name TEXT`;
  await sql`ALTER TABLE consignors ADD COLUMN IF NOT EXISTS agreement_signed_at TIMESTAMPTZ`;
  await sql`ALTER TABLE consignors ADD COLUMN IF NOT EXISTS agreement_signed_ip TEXT`;
  await sql`ALTER TABLE consignors ADD COLUMN IF NOT EXISTS agreement_version TEXT`;
  await sql`CREATE SEQUENCE IF NOT EXISTS item_id_seq START 1`;
  await sql`
    CREATE TABLE IF NOT EXISTS items (
      id TEXT PRIMARY KEY,
      barcode TEXT,
      name TEXT,
      brand TEXT NOT NULL,
      description TEXT,
      size TEXT NOT NULL,
      color TEXT,
      fabric TEXT,
      fit_notes TEXT,
      silhouette TEXT,
      new_with_tags BOOLEAN NOT NULL DEFAULT false,
      tier TEXT NOT NULL CHECK (tier IN ('value','standard','mid','high','premium')),
      rental_price NUMERIC(8,2) NOT NULL,
      purchase_cost NUMERIC(8,2),
      retail_value NUMERIC(8,2),
      acquisition_date DATE,
      source TEXT,
      condition_notes TEXT,
      ownership TEXT NOT NULL CHECK (ownership IN ('owned','consignment','ambassador')),
      consignor_id INT REFERENCES consignors(id),
      event_types TEXT[] NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'available'
        CHECK (status IN ('available','reserved','rented','consignor_hold','cleaning','retired','with_consignor','in_storage')),
      location TEXT,
      photo_url TEXT,
      photos TEXT[] NOT NULL DEFAULT '{}',
      rental_count INT NOT NULL DEFAULT 0,
      cleaning_count INT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      retired_at DATE,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  // --- Additive migrations for the expanded piece model ---
  // Safe to run on every boot: ADD COLUMN IF NOT EXISTS is idempotent and
  // leaves existing rows untouched. Keeps the BRW-xxxx `id` as the PK so
  // existing rentals.item_id foreign keys stay intact.
  await sql`ALTER TABLE items ADD COLUMN IF NOT EXISTS barcode TEXT`;
  await sql`ALTER TABLE items ADD COLUMN IF NOT EXISTS name TEXT`;
  await sql`ALTER TABLE items ADD COLUMN IF NOT EXISTS description TEXT`;
  await sql`ALTER TABLE items ADD COLUMN IF NOT EXISTS fabric TEXT`;
  await sql`ALTER TABLE items ADD COLUMN IF NOT EXISTS fit_notes TEXT`;
  await sql`ALTER TABLE items ADD COLUMN IF NOT EXISTS silhouette TEXT`;
  await sql`ALTER TABLE items ADD COLUMN IF NOT EXISTS location TEXT`;
  await sql`ALTER TABLE items ADD COLUMN IF NOT EXISTS source TEXT`;
  await sql`ALTER TABLE items ADD COLUMN IF NOT EXISTS acquisition_date DATE`;
  await sql`ALTER TABLE items ADD COLUMN IF NOT EXISTS retail_value NUMERIC(8,2)`;
  // Agreed loss/replacement value + a flag marking a manual override so the
  // default (max of 70% retail, acquisition cost) never clobbers a hand-set one.
  await sql`ALTER TABLE items ADD COLUMN IF NOT EXISTS replacement_value NUMERIC(8,2)`;
  await sql`ALTER TABLE items ADD COLUMN IF NOT EXISTS replacement_value_manual BOOLEAN NOT NULL DEFAULT false`;
  // When the consignor (or staff on their behalf) confirmed this piece's agreed
  // replacement value at intake. Required before a consigned piece goes live.
  await sql`ALTER TABLE items ADD COLUMN IF NOT EXISTS replacement_confirmed_at TIMESTAMPTZ`;
  // Backfill any piece without one from the default formula (one-time; only
  // touches nulls so manual/edited values are preserved).
  await sql`
    UPDATE items
    SET replacement_value = GREATEST(
          ceil(COALESCE(retail_value, 0) * 0.7),
          ceil(COALESCE(purchase_cost, 0))
        )
    WHERE replacement_value IS NULL
  `;
  await sql`ALTER TABLE items ADD COLUMN IF NOT EXISTS cleaning_count INT NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE items ADD COLUMN IF NOT EXISTS retired_at DATE`;
  // Per-piece cleaning/turnaround buffer override (days). NULL = use the global
  // program.turnaround_days. Set to 0 to make a piece re-bookable the day after
  // its return (e.g. a one-off where the owner handles cleaning personally).
  await sql`ALTER TABLE items ADD COLUMN IF NOT EXISTS turnaround_override INT`;
  // Cross-listed on the e.closet marketplace too — drives the "Sync to e.closet"
  // checklist so a Borrow reservation reminds staff to block it there as well.
  await sql`ALTER TABLE items ADD COLUMN IF NOT EXISTS listed_on_ecloset BOOLEAN NOT NULL DEFAULT false`;
  // e.closet order id on a rental created by importing their Orders CSV (dedupe
  // so re-importing the same file never double-books or double-pays). And the
  // stamp for when a Borrow-origin reservation was blocked on e.closet.
  await sql`ALTER TABLE rentals ADD COLUMN IF NOT EXISTS ecloset_order_id TEXT`;
  await sql`ALTER TABLE rentals ADD COLUMN IF NOT EXISTS ecloset_synced_at TIMESTAMPTZ`;
  // What the owner actually made on the e.closet rental (their entered "amount").
  // Drives Finances revenue (the marked-up amount), not the consignor cut.
  await sql`ALTER TABLE rentals ADD COLUMN IF NOT EXISTS ecloset_amount NUMERIC(10,2)`;

  // Money a consignor owes back (e.g. a payout sent in error). It's withheld
  // automatically from their future payouts until `recovered` reaches `amount`.
  await sql`
    CREATE TABLE IF NOT EXISTS consignor_recoveries (
      id SERIAL PRIMARY KEY,
      consignor_id INT NOT NULL REFERENCES consignors(id) ON DELETE CASCADE,
      amount NUMERIC(10,2) NOT NULL,
      recovered NUMERIC(10,2) NOT NULL DEFAULT 0,
      note TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      resolved_at TIMESTAMPTZ
    )
  `;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS rentals_ecloset_order_uniq
    ON rentals(ecloset_order_id) WHERE ecloset_order_id IS NOT NULL`;
  await sql`ALTER TABLE items ADD COLUMN IF NOT EXISTS photos TEXT[] NOT NULL DEFAULT '{}'`;
  await sql`ALTER TABLE items ADD COLUMN IF NOT EXISTS new_with_tags BOOLEAN NOT NULL DEFAULT false`;
  await sql`ALTER TABLE items ADD COLUMN IF NOT EXISTS ambassador_id INT`;
  // Matching-set grouping: pieces sharing a non-null set_group are parts of the
  // same outfit (e.g. a top + skirt) and cross-link on the shop.
  await sql`ALTER TABLE items ADD COLUMN IF NOT EXISTS set_group TEXT`;
  // Consignor approval of the agreed replacement value. Consignment pieces start
  // 'pending' and can't go live until 'approved'; 'disputed' needs in-person review.
  await sql`ALTER TABLE items ADD COLUMN IF NOT EXISTS approval_status TEXT`;
  // Per-piece stamp of when the consignor was emailed that this piece is ready
  // for their approval. NULL = not yet notified; the batching cron sends one
  // email per consignor per window and stamps every piece it covered.
  await sql`ALTER TABLE items ADD COLUMN IF NOT EXISTS approval_notified_at TIMESTAMPTZ`;
  await sql`ALTER TABLE items ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ`;
  await sql`ALTER TABLE items ADD COLUMN IF NOT EXISTS disputed_at TIMESTAMPTZ`;
  // On a dispute the consignor suggests a value (+ optional note); dispute_outcome
  // records how the admin resolved it ('accepted' | 'rejected') for the consignor.
  await sql`ALTER TABLE items ADD COLUMN IF NOT EXISTS disputed_value NUMERIC(8,2)`;
  await sql`ALTER TABLE items ADD COLUMN IF NOT EXISTS dispute_note TEXT`;
  await sql`ALTER TABLE items ADD COLUMN IF NOT EXISTS dispute_outcome TEXT`;
  // Grandfather existing consignment pieces (predate approvals) as approved so
  // nothing currently listed goes dark. New pieces are created 'pending'.
  await sql`
    UPDATE items SET approval_status = 'approved', approved_at = COALESCE(approved_at, now())
    WHERE ownership = 'consignment' AND approval_status IS NULL
  `;

  // Allow the new tier ('high') and ownership ('ambassador') values by
  // relaxing the original CHECK constraints (Postgres default names).
  await sql`ALTER TABLE items DROP CONSTRAINT IF EXISTS items_tier_check`;
  await sql`ALTER TABLE items ADD CONSTRAINT items_tier_check
    CHECK (tier IN ('value','standard','mid','high','premium'))`;
  await sql`ALTER TABLE items DROP CONSTRAINT IF EXISTS items_ownership_check`;
  await sql`ALTER TABLE items ADD CONSTRAINT items_ownership_check
    CHECK (ownership IN ('owned','consignment','ambassador'))`;
  // Allow the 'with_consignor' hold status (consignor borrowing their own piece)
  // and 'consignor_hold' (a consignor self-hold: they've asked for the piece back
  // for a date range and it's unavailable until manually marked returned).
  await sql`ALTER TABLE items DROP CONSTRAINT IF EXISTS items_status_check`;
  await sql`ALTER TABLE items ADD CONSTRAINT items_status_check
    CHECK (status IN ('available','reserved','rented','consignor_hold','cleaning','retired','with_consignor','in_storage'))`;
  // Consignor self-hold window on the piece. hold_start = first day it's theirs
  // (blocks new bookings from here); hold_end = the return date they requested
  // (informational — the piece stays on hold until an admin marks it returned).
  await sql`ALTER TABLE items ADD COLUMN IF NOT EXISTS hold_start DATE`;
  await sql`ALTER TABLE items ADD COLUMN IF NOT EXISTS hold_end DATE`;
  // Back-fill the new range from the old single-date hold, once.
  await sql`UPDATE items SET hold_start = retrieval_hold_date
    WHERE retrieval_hold_date IS NOT NULL AND hold_start IS NULL`;
  // Underperforming-item pickup + storage lifecycle (owner-approved, two-stage).
  await sql`ALTER TABLE items ADD COLUMN IF NOT EXISTS underperf_dismissed_at TIMESTAMPTZ`;
  await sql`ALTER TABLE items ADD COLUMN IF NOT EXISTS pickup_notice_sent_at TIMESTAMPTZ`;
  await sql`ALTER TABLE items ADD COLUMN IF NOT EXISTS pickup_reminder_sent_at TIMESTAMPTZ`;
  await sql`ALTER TABLE items ADD COLUMN IF NOT EXISTS storage_started_at TIMESTAMPTZ`;
  await sql`ALTER TABLE items ADD COLUMN IF NOT EXISTS storage_decided_at TIMESTAMPTZ`;

  // Barcode is the scannable identifier — unique where present. Partial index
  // so legacy rows without a barcode don't collide on NULL.
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS items_barcode_key
    ON items(barcode) WHERE barcode IS NOT NULL`;

  await sql`
    CREATE TABLE IF NOT EXISTS customers (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT,
      email TEXT,
      instagram TEXT,
      flag TEXT CHECK (flag IN ('vip','problem')),
      notes TEXT,
      account_token TEXT UNIQUE,
      account_created_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS rentals (
      id SERIAL PRIMARY KEY,
      item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
      customer_id INT REFERENCES customers(id),
      start_date DATE NOT NULL,
      due_date DATE NOT NULL,
      returned_date DATE,
      status TEXT NOT NULL DEFAULT 'reserved'
        CHECK (status IN ('reserved','active','completed','cancelled')),
      rental_price NUMERIC(8,2) NOT NULL,
      damage_waiver BOOLEAN NOT NULL DEFAULT false,
      late_fee NUMERIC(8,2) NOT NULL DEFAULT 0,
      damaged BOOLEAN NOT NULL DEFAULT false,
      source TEXT NOT NULL DEFAULT 'studio',
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS payouts (
      id SERIAL PRIMARY KEY,
      consignor_id INT NOT NULL REFERENCES consignors(id) ON DELETE CASCADE,
      amount NUMERIC(8,2) NOT NULL,
      method TEXT,
      notes TEXT,
      paid_at DATE NOT NULL DEFAULT CURRENT_DATE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  // Automatic per-rental payouts (Stripe Connect transfers).
  //  - rental_id ties a payout to the completed rental that earned it, and is
  //    UNIQUE so a rental can only ever pay out once (idempotency).
  //  - status: 'paid' (transfer succeeded or recorded manually), 'pending'
  //    (owed but not yet sent — consignor not onboarded or funds not settled;
  //    a cron sweep retries these), or 'failed'.
  await sql`ALTER TABLE payouts ADD COLUMN IF NOT EXISTS rental_id INT REFERENCES rentals(id) ON DELETE SET NULL`;
  await sql`ALTER TABLE payouts ADD COLUMN IF NOT EXISTS stripe_transfer_id TEXT`;
  await sql`ALTER TABLE payouts ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'paid'`;
  await sql`ALTER TABLE payouts ADD COLUMN IF NOT EXISTS auto BOOLEAN NOT NULL DEFAULT false`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS payouts_rental_key ON payouts(rental_id) WHERE rental_id IS NOT NULL`;
  // Total-loss payouts: the FULL agreed replacement value owed to a consignor
  // when their piece is lost/destroyed. kind distinguishes them from normal 60%
  // rental payouts; loss_rental_id is UNIQUE so a loss pays out only once.
  await sql`ALTER TABLE payouts ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'rental'`;
  await sql`ALTER TABLE payouts ADD COLUMN IF NOT EXISTS loss_rental_id INT REFERENCES rentals(id) ON DELETE SET NULL`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS payouts_loss_rental_key ON payouts(loss_rental_id) WHERE loss_rental_id IS NOT NULL`;

  // A checkout = one transaction covering one or more pieces for a customer.
  // Each piece also gets its own rental row (below) linked back via
  // transaction_id, so the transaction is recorded against both the customer
  // and every piece.
  await sql`
    CREATE TABLE IF NOT EXISTS transactions (
      id SERIAL PRIMARY KEY,
      customer_id INT REFERENCES customers(id),
      piece_count INT NOT NULL,
      subtotal NUMERIC(10,2) NOT NULL,
      waiver_total NUMERIC(10,2) NOT NULL,
      total NUMERIC(10,2) NOT NULL,
      start_date DATE NOT NULL,
      due_date DATE NOT NULL,
      payment_method TEXT NOT NULL DEFAULT 'card_reader',
      payment_status TEXT NOT NULL DEFAULT 'collected'
        CHECK (payment_status IN ('collected','pending','void')),
      payment_ref TEXT,
      agreement_accepted BOOLEAN NOT NULL DEFAULT false,
      agreement_name TEXT,
      agreement_accepted_at TIMESTAMPTZ,
      receipt_email TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  // Refunds: allow the 'refunded' status and record the refund details.
  await sql`ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_payment_status_check`;
  await sql`ALTER TABLE transactions ADD CONSTRAINT transactions_payment_status_check
    CHECK (payment_status IN ('collected','pending','void','refunded'))`;
  await sql`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS tax_total NUMERIC(10,2) NOT NULL DEFAULT 0`;
  // Standalone authorization for automatic late/damage/non-return charges —
  // captured via its own required checkbox at checkout, separate from the
  // general rental-agreement acknowledgment. The customer + timestamp live on
  // this transaction (customer_id + charge_auth_accepted_at).
  await sql`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS charge_auth_accepted BOOLEAN NOT NULL DEFAULT false`;
  await sql`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS charge_auth_accepted_at TIMESTAMPTZ`;
  await sql`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS refund_amount NUMERIC(10,2) NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMPTZ`;
  await sql`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS stripe_refund_id TEXT`;

  // Link rentals to their checkout transaction (additive; existing rows null).
  await sql`ALTER TABLE rentals ADD COLUMN IF NOT EXISTS transaction_id INT REFERENCES transactions(id)`;
  // Actual Cleaning & Care Fee charged on this rental (the damage_waiver boolean
  // is retained as "fee charged?"). Stored so finances reflect the real amount
  // rather than a hardcoded multiplier; legacy rows fall back to $5 in queries.
  await sql`ALTER TABLE rentals ADD COLUMN IF NOT EXISTS cleaning_fee NUMERIC(8,2) NOT NULL DEFAULT 0`;
  // Pre-paid fee for booking a rental longer than the standard week ($15/day per
  // item for each extra day). Kept by Borrow (like a late fee), separate from
  // rental_price so consignor earnings aren't affected.
  await sql`ALTER TABLE rentals ADD COLUMN IF NOT EXISTS extra_days_fee NUMERIC(8,2) NOT NULL DEFAULT 0`;
  // Dedupe flags for the daily reminder job (so each reminder sends once).
  await sql`ALTER TABLE rentals ADD COLUMN IF NOT EXISTS pickup_reminded BOOLEAN NOT NULL DEFAULT false`;
  // When the owner has physically pulled a reserved piece into the holding area,
  // so the Today / Pull List can hide it and only surface NEW reservations.
  await sql`ALTER TABLE rentals ADD COLUMN IF NOT EXISTS pulled_at TIMESTAMPTZ`;
  await sql`ALTER TABLE rentals ADD COLUMN IF NOT EXISTS due_reminded BOOLEAN NOT NULL DEFAULT false`;
  // A reservation whose return date passed without ever being picked up (no-show):
  // once flagged we email the consignor (rental didn't happen, no payout) and the
  // owner (clear to put back on the rack). Set so we notify exactly once.
  await sql`ALTER TABLE rentals ADD COLUMN IF NOT EXISTS noshow_notified BOOLEAN NOT NULL DEFAULT false`;

  // Ambassadors: Curators (propose pieces) and Posters (rotate monthly). Each
  // links to their own customer record (they rent) and optionally a consignor
  // record (if they bring pieces). items.ambassador_id attributes sourced
  // pieces back to them.
  await sql`
    CREATE TABLE IF NOT EXISTS ambassadors (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      instagram TEXT,
      phone TEXT,
      sorority TEXT,
      tier TEXT NOT NULL DEFAULT 'poster' CHECK (tier IN ('curator','poster')),
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
      join_date DATE NOT NULL DEFAULT CURRENT_DATE,
      referral_code TEXT UNIQUE,
      active_months TEXT[] NOT NULL DEFAULT '{}',
      customer_id INT REFERENCES customers(id),
      consignor_id INT REFERENCES consignors(id),
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS ambassador_proposals (
      id SERIAL PRIMARY KEY,
      ambassador_id INT NOT NULL REFERENCES ambassadors(id) ON DELETE CASCADE,
      description TEXT NOT NULL,
      accepted BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;

  // Monthly perk-credit tracking per ambassador. credit_period is the YYYY-MM
  // these counters belong to; when a new month is seen the counters are reset
  // lazily (see lib/credits.ts), so no cron is needed.
  await sql`ALTER TABLE ambassadors ADD COLUMN IF NOT EXISTS credit_period TEXT`;
  await sql`ALTER TABLE ambassadors ADD COLUMN IF NOT EXISTS free_used INT NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE ambassadors ADD COLUMN IF NOT EXISTS rate_used INT NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE ambassadors ADD COLUMN IF NOT EXISTS bonus_earned INT NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE ambassadors ADD COLUMN IF NOT EXISTS bonus_used INT NOT NULL DEFAULT 0`;

  // Key/value app settings (ambassador credit config + blackout dates).
  await sql`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;

  // Ambassador posting log (counted per month against a target) and referral
  // attributions (a referral code entered at checkout links the rental +
  // customer to the ambassador whose code it is).
  await sql`
    CREATE TABLE IF NOT EXISTS ambassador_posts (
      id SERIAL PRIMARY KEY,
      ambassador_id INT NOT NULL REFERENCES ambassadors(id) ON DELETE CASCADE,
      posted_on DATE NOT NULL DEFAULT CURRENT_DATE,
      link TEXT,
      note TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS ambassador_referrals (
      id SERIAL PRIMARY KEY,
      ambassador_id INT NOT NULL REFERENCES ambassadors(id) ON DELETE CASCADE,
      customer_id INT REFERENCES customers(id),
      transaction_id INT REFERENCES transactions(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;

  // Cleaning costs BORROW absorbs (e.g. a free ambassador rental where no
  // Cleaning & Care Fee was collected) — tracked as an expense in Finances.
  await sql`
    CREATE TABLE IF NOT EXISTS cleaning_expenses (
      id SERIAL PRIMARY KEY,
      amount NUMERIC(8,2) NOT NULL,
      reason TEXT NOT NULL,
      item_id TEXT REFERENCES items(id) ON DELETE SET NULL,
      rental_id INT REFERENCES rentals(id) ON DELETE SET NULL,
      consignor_id INT REFERENCES consignors(id) ON DELETE SET NULL,
      incurred_on DATE NOT NULL DEFAULT CURRENT_DATE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;

  // Business expense log (Estimated Profit). Manual entries the owner records;
  // Cleaning Service and Stripe Fees are auto-populated from other systems
  // (cleaning_expenses + transactions.stripe_fee) and merged in the view, so
  // they are NOT stored here to avoid double-counting.
  await sql`
    CREATE TABLE IF NOT EXISTS expense_log (
      id SERIAL PRIMARY KEY,
      incurred_on DATE NOT NULL DEFAULT CURRENT_DATE,
      category TEXT NOT NULL CHECK (category IN
        ('cleaning','stripe_fees','rent','marketing','supplies','loan_interest','other')),
      amount NUMERIC(10,2) NOT NULL,
      note TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS expense_log_date ON expense_log(incurred_on)`;
  // Allow a 'donation' expense category (charitable give-back campaigns).
  await sql`ALTER TABLE expense_log DROP CONSTRAINT IF EXISTS expense_log_category_check`;
  await sql`ALTER TABLE expense_log ADD CONSTRAINT expense_log_category_check CHECK (category IN
    ('cleaning','stripe_fees','rent','marketing','supplies','loan_interest','donation','other'))`;

  // ---- Give-back / donation campaigns -------------------------------------
  // A campaign is a tag-only code (no discount, no price change). An order "paid"
  // within [starts_on, ends_on] can carry the code; a % of its rental sales is
  // owed as a charitable donation (a Borrow expense — never off consignor pay).
  await sql`
    CREATE TABLE IF NOT EXISTS campaigns (
      id SERIAL PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      label TEXT,
      organization TEXT NOT NULL DEFAULT '',
      donation_rate NUMERIC(5,2) NOT NULL DEFAULT 10,
      starts_on DATE,
      ends_on DATE,
      active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  // Seed the FIGHT one-day fundraiser (idempotent; editable afterward in Settings).
  await sql`
    INSERT INTO campaigns (code, label, organization, donation_rate, starts_on, ends_on, active)
    VALUES ('FIGHT', 'Renting for the Fight', 'The Fight Against Suicide', 10, '2026-10-30', '2026-10-30', true)
    ON CONFLICT (code) DO NOTHING
  `;
  // Which campaign a rental is tagged with (NULL = untagged). The tag is what the
  // Orders view + campaign report key off; set at checkout or added later.
  await sql`ALTER TABLE rentals ADD COLUMN IF NOT EXISTS campaign_code TEXT`;
  await sql`CREATE INDEX IF NOT EXISTS rentals_campaign_code ON rentals(campaign_code) WHERE campaign_code IS NOT NULL`;
  // Audit log: who tagged/untagged an order with a campaign, and when.
  await sql`
    CREATE TABLE IF NOT EXISTS campaign_tag_log (
      id SERIAL PRIMARY KEY,
      rental_id INT,
      transaction_id INT,
      code TEXT NOT NULL,
      action TEXT NOT NULL CHECK (action IN ('checkout','add','remove')),
      actor TEXT NOT NULL DEFAULT 'studio admin',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  // Actual Stripe processing fee deducted from a transaction's charge (fetched
  // from the balance transaction). NULL = not fetched yet.
  await sql`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS stripe_fee NUMERIC(10,2)`;

  // Opt-in cleaning charges against a consignor — only OUTSIDE the rental
  // cycle: a dry clean at retrieval, or an initial clean before first listing.
  // These deduct from the consignor's earnings.
  await sql`
    CREATE TABLE IF NOT EXISTS consignor_charges (
      id SERIAL PRIMARY KEY,
      consignor_id INT NOT NULL REFERENCES consignors(id) ON DELETE CASCADE,
      amount NUMERIC(8,2) NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('retrieval','initial')),
      item_id TEXT REFERENCES items(id) ON DELETE SET NULL,
      note TEXT,
      charged_on DATE NOT NULL DEFAULT CURRENT_DATE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;

  // Store credit (e.g. $5 for posting a rented piece) — a running balance on
  // the customer plus a ledger of grants (+) and redemptions (-). The partial
  // unique index enforces at most one post credit per rental.
  await sql`ALTER TABLE customers ADD COLUMN IF NOT EXISTS store_credit NUMERIC(10,2) NOT NULL DEFAULT 0`;
  // Marketing opt-ins from the shop popup (email list + SMS consent timestamp).
  await sql`ALTER TABLE customers ADD COLUMN IF NOT EXISTS marketing_signup_at TIMESTAMPTZ`;
  await sql`ALTER TABLE customers ADD COLUMN IF NOT EXISTS sms_consent_at TIMESTAMPTZ`;
  await sql`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS store_credit_applied NUMERIC(10,2) NOT NULL DEFAULT 0`;
  await sql`
    CREATE TABLE IF NOT EXISTS store_credit_entries (
      id SERIAL PRIMARY KEY,
      customer_id INT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      amount NUMERIC(10,2) NOT NULL,
      reason TEXT NOT NULL,
      rental_id INT REFERENCES rentals(id) ON DELETE SET NULL,
      transaction_id INT REFERENCES transactions(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS store_credit_post_once
    ON store_credit_entries(rental_id)
    WHERE reason = 'post' AND rental_id IS NOT NULL
  `;
  // Free-text label for a manual grant (e.g. "Instagram giveaway winner").
  await sql`ALTER TABLE store_credit_entries ADD COLUMN IF NOT EXISTS note TEXT`;

  // Quick Charges — standalone in-person charges via the Terminal reader, not
  // tied to any piece, order, or consignor ledger (e.g. an initial cleaning fee
  // taken before the person is catalogued). person_name/phone are for reference
  // only; customer_id is optional and never creates or affects a consignor.
  await sql`
    CREATE TABLE IF NOT EXISTS quick_charges (
      id SERIAL PRIMARY KEY,
      amount NUMERIC(10,2) NOT NULL,
      note TEXT,
      customer_id INT REFERENCES customers(id) ON DELETE SET NULL,
      person_name TEXT,
      person_phone TEXT,
      stripe_payment_intent_id TEXT,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','succeeded','failed','canceled')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;

  // Stripe: a saved card per customer (off-session charges) + per-rental
  // payment method, charge tracking, and follow-up flags for failed charges.
  await sql`ALTER TABLE customers ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT`;
  await sql`ALTER TABLE customers ADD COLUMN IF NOT EXISTS outstanding_balance NUMERIC(10,2) NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE rentals ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT`;
  await sql`ALTER TABLE rentals ADD COLUMN IF NOT EXISTS stripe_payment_method_id TEXT`;
  await sql`ALTER TABLE rentals ADD COLUMN IF NOT EXISTS late_fee_charged NUMERIC(10,2) NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE rentals ADD COLUMN IF NOT EXISTS replacement_charged BOOLEAN NOT NULL DEFAULT false`;
  await sql`ALTER TABLE rentals ADD COLUMN IF NOT EXISTS payment_followup BOOLEAN NOT NULL DEFAULT false`;
  await sql`ALTER TABLE rentals ADD COLUMN IF NOT EXISTS payment_link_url TEXT`;
  // Return-time issue handling: 'repair' (repairable, charge actual repair cost)
  // or 'loss' (total loss / not returned, charge replacement value + retire).
  await sql`ALTER TABLE rentals ADD COLUMN IF NOT EXISTS damage_kind TEXT`;
  await sql`ALTER TABLE rentals ADD COLUMN IF NOT EXISTS repair_cost NUMERIC(10,2) NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE rentals ADD COLUMN IF NOT EXISTS replacement_value NUMERIC(10,2)`;
  // Sales tax collected on this rental's rental price (not the cleaning fee).
  await sql`ALTER TABLE rentals ADD COLUMN IF NOT EXISTS sales_tax NUMERIC(10,2) NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE rentals ADD COLUMN IF NOT EXISTS paid BOOLEAN NOT NULL DEFAULT false`;
  await sql`ALTER TABLE rentals ADD COLUMN IF NOT EXISTS stripe_session_id TEXT`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS rentals_stripe_session_key ON rentals(stripe_session_id) WHERE stripe_session_id IS NOT NULL`;
  await sql`
    CREATE TABLE IF NOT EXISTS customer_charges (
      id SERIAL PRIMARY KEY,
      customer_id INT REFERENCES customers(id) ON DELETE SET NULL,
      rental_id INT REFERENCES rentals(id) ON DELETE SET NULL,
      amount NUMERIC(10,2) NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('late_fee','replacement')),
      status TEXT NOT NULL CHECK (status IN ('succeeded','failed','pending')),
      stripe_payment_intent_id TEXT,
      payment_link_url TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  // Consignor drop-off appointments — one booking per slot (unique slot).
  await sql`
    CREATE TABLE IF NOT EXISTS drop_off_appointments (
      id SERIAL PRIMARY KEY,
      slot_date DATE NOT NULL,
      slot_time TEXT NOT NULL,
      name TEXT NOT NULL,
      phone TEXT,
      email TEXT,
      item_count INT NOT NULL DEFAULT 1,
      customer_id INT REFERENCES customers(id) ON DELETE SET NULL,
      consignor_id INT REFERENCES consignors(id) ON DELETE SET NULL,
      status TEXT NOT NULL DEFAULT 'booked' CHECK (status IN ('booked','cancelled')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS dropoff_slot_key
    ON drop_off_appointments(slot_date, slot_time) WHERE status = 'booked'`;
  // Allow marking an appointment 'completed' once the person has come in.
  await sql`ALTER TABLE drop_off_appointments DROP CONSTRAINT IF EXISTS drop_off_appointments_status_check`;
  await sql`ALTER TABLE drop_off_appointments ADD CONSTRAINT drop_off_appointments_status_check
    CHECK (status IN ('booked','cancelled','completed'))`;
  // Google Calendar event id (when the calendar integration is connected).
  await sql`ALTER TABLE drop_off_appointments ADD COLUMN IF NOT EXISTS gcal_event_id TEXT`;
  // Flags a cancelled appointment that the studio cancelled (e.g. owner away) and
  // still owes the customer a new time — surfaced on /dropoff to reschedule.
  await sql`ALTER TABLE drop_off_appointments ADD COLUMN IF NOT EXISTS needs_reschedule BOOLEAN NOT NULL DEFAULT false`;
  // Secret token that lets the person who booked manage their own appointment
  // (cancel/reschedule) from a link in their confirmation email — no login.
  await sql`ALTER TABLE drop_off_appointments ADD COLUMN IF NOT EXISTS manage_token TEXT`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS dropoff_manage_token_key
    ON drop_off_appointments(manage_token) WHERE manage_token IS NOT NULL`;

  // Consignor-initiated retrieval requests ("I'd like this piece back"), raised
  // from the consignor hub. Only allowed when a piece isn't rented/reserved.
  await sql`
    CREATE TABLE IF NOT EXISTS retrieval_requests (
      id SERIAL PRIMARY KEY,
      consignor_id INT NOT NULL REFERENCES consignors(id) ON DELETE CASCADE,
      item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
      note TEXT,
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','done')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      resolved_at TIMESTAMPTZ
    )
  `;
  // One open request per piece (a second tap is a no-op, not a duplicate).
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS retrieval_open_key
    ON retrieval_requests(item_id) WHERE status = 'open'`;
  // Future-dated retrievals: the consignor may ask for a piece back on a
  // specific date (NULL = as soon as possible). The piece's calendar is blocked
  // from that date on (see items.retrieval_hold_date) so it can't be booked past
  // then, while staying rentable up until then.
  await sql`ALTER TABLE retrieval_requests ADD COLUMN IF NOT EXISTS requested_date DATE`;
  await sql`ALTER TABLE items ADD COLUMN IF NOT EXISTS retrieval_hold_date DATE`;
  // Consignor self-hold: a request now carries a real date RANGE they pick, and
  // an acknowledgement that a needs-cleaning return costs the cleaning fee.
  await sql`ALTER TABLE retrieval_requests ADD COLUMN IF NOT EXISTS hold_start DATE`;
  await sql`ALTER TABLE retrieval_requests ADD COLUMN IF NOT EXISTS hold_end DATE`;
  await sql`ALTER TABLE retrieval_requests ADD COLUMN IF NOT EXISTS cleaning_ack BOOLEAN NOT NULL DEFAULT false`;
  // Set when staff pull the piece off the rack for the consignor's hold — lets a
  // consignor retrieval share the Pull List's "pulled" tracking with rentals.
  await sql`ALTER TABLE retrieval_requests ADD COLUMN IF NOT EXISTS pulled_at TIMESTAMPTZ`;
  // Back-fill the range on any existing open request from the old single date.
  await sql`UPDATE retrieval_requests SET hold_start = COALESCE(requested_date, created_at::date)
    WHERE status = 'open' AND hold_start IS NULL`;

  // Rate (%) a consignor was promised in their drop-off confirmation email, so
  // it can be honored when they later sign in the store.
  await sql`ALTER TABLE drop_off_appointments ADD COLUMN IF NOT EXISTS promised_rate INT`;
  // One-time backfill: grandfather everyone already signed at 60%, and mark all
  // existing drop-off bookings (which were emailed 60%) as promised 60%.
  const migRate = await sql`SELECT 1 FROM app_settings WHERE key = 'mig_consignor_rate_2026_07'`;
  if (migRate.length === 0) {
    await sql`UPDATE consignors SET consignor_rate = 60, agreement_signed_rate = 60
      WHERE agreement_signed_at IS NOT NULL AND consignor_rate IS NULL`;
    await sql`UPDATE drop_off_appointments SET promised_rate = 60 WHERE promised_rate IS NULL`;
    await sql`INSERT INTO app_settings (key, value, updated_at)
      VALUES ('mig_consignor_rate_2026_07', '"done"'::jsonb, now())
      ON CONFLICT (key) DO NOTHING`;
  }

  // Consignor rate schedule: the commission rate in effect over time, so we can
  // look up "what rate was promised on any given date." A consignor locks in the
  // rate in effect on whichever came first — their first drop-off booking or
  // their signing. History (calibrated to what was actually promised): 60% from
  // launch, 50% from 2026-07-17, 40% from 2026-07-20, 30% from 2026-07-29,
  // 20% from 2026-08-04.
  await sql`
    CREATE TABLE IF NOT EXISTS consignor_rate_schedule (
      id SERIAL PRIMARY KEY,
      rate INT NOT NULL,
      effective_from DATE NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`
    INSERT INTO consignor_rate_schedule (rate, effective_from) VALUES
      (60, '2000-01-01'), (50, '2026-07-17'), (40, '2026-07-20'), (30, '2026-07-29'), (20, '2026-08-04')
    ON CONFLICT (effective_from) DO NOTHING
  `;

  // One-time backfill (item 3): lock any UNSIGNED consignor who already booked a
  // drop-off to the rate in effect on their earliest booking date — never today's
  // (lower) default, and only when their rate isn't already locked, so no
  // already-protected consignor is ever touched or reduced.
  const migSched = await sql`SELECT 1 FROM app_settings WHERE key = 'mig_rate_schedule_2026_07_20'`;
  if (migSched.length === 0) {
    await sql`
      UPDATE consignors c SET consignor_rate = (
        SELECT s.rate FROM consignor_rate_schedule s
        WHERE s.effective_from <= (
          SELECT MIN(a.created_at)::date FROM drop_off_appointments a
          WHERE a.consignor_id = c.id
             OR (COALESCE(c.email,'') <> '' AND lower(a.email) = lower(c.email))
        )
        ORDER BY s.effective_from DESC LIMIT 1
      )
      WHERE c.consignor_rate IS NULL
        AND c.agreement_signed_at IS NULL
        AND EXISTS (
          SELECT 1 FROM drop_off_appointments a
          WHERE a.consignor_id = c.id
             OR (COALESCE(c.email,'') <> '' AND lower(a.email) = lower(c.email))
        )
    `;
    await sql`INSERT INTO app_settings (key, value, updated_at)
      VALUES ('mig_rate_schedule_2026_07_20', '"done"'::jsonb, now())
      ON CONFLICT (key) DO NOTHING`;
  }

  // One-time backfill: mark every pending consignment piece that predates the
  // batched-notification cron as already notified, so turning the cron on does
  // NOT blast a batch email to consignors whose items were handled the old way.
  // We use the consignor's last approval email if we have one, else now().
  const migNotified = await sql`SELECT 1 FROM app_settings WHERE key = 'mig_approval_notified_2026_07'`;
  if (migNotified.length === 0) {
    await sql`
      UPDATE items i SET approval_notified_at =
        COALESCE((SELECT c.approval_email_sent_at FROM consignors c WHERE c.id = i.consignor_id), now())
      WHERE i.ownership = 'consignment'
        AND i.approval_status = 'pending'
        AND i.approval_notified_at IS NULL
    `;
    await sql`INSERT INTO app_settings (key, value, updated_at)
      VALUES ('mig_approval_notified_2026_07', '"done"'::jsonb, now())
      ON CONFLICT (key) DO NOTHING`;
  }

  // When the studio asks a consignor to come collect an under-performing piece
  // (see the "not renting" notification), we stamp the ask here so it stops
  // nagging and shows its status on the piece.
  await sql`ALTER TABLE items ADD COLUMN IF NOT EXISTS pickup_requested_at TIMESTAMPTZ`;
  // Popularity: how many times shoppers opened this piece on the shop. Drives
  // the default "Most loved" sort (most-clicked first), under the curated order.
  await sql`ALTER TABLE items ADD COLUMN IF NOT EXISTS click_count INT NOT NULL DEFAULT 0`;
  // Freeform descriptive style tags (e.g. sparkly, backless) for smart search.
  await sql`ALTER TABLE items ADD COLUMN IF NOT EXISTS style_tags TEXT[] NOT NULL DEFAULT '{}'`;
  // Occasion-based browsing: top-level occasions ("Vacation") + namespaced
  // sub-occasions ("Vacation:Beach"). Owner-editable occasion map lives in the
  // ambassador_program app_setting; these are the per-piece tags.
  await sql`ALTER TABLE items ADD COLUMN IF NOT EXISTS occasion_tags TEXT[] NOT NULL DEFAULT '{}'`;
  await sql`ALTER TABLE items ADD COLUMN IF NOT EXISTS sub_occasion_tags TEXT[] NOT NULL DEFAULT '{}'`;

  // Allow 'repair' charges (repairable damage — actual repair cost).
  await sql`ALTER TABLE customer_charges DROP CONSTRAINT IF EXISTS customer_charges_kind_check`;
  await sql`ALTER TABLE customer_charges ADD CONSTRAINT customer_charges_kind_check
    CHECK (kind IN ('late_fee','replacement','repair','hanger','garment_bag'))`;
  // When a renter charge (e.g. a late fee) is refunded back to their card.
  await sql`ALTER TABLE customer_charges ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMPTZ`;
  // How much of the charge has been refunded (supports partial refunds, e.g.
  // when a late fee is lowered rather than fully waived). refunded_at marks a
  // FULL refund; refunded_amount is the running total refunded either way.
  await sql`ALTER TABLE customer_charges ADD COLUMN IF NOT EXISTS refunded_amount NUMERIC(10,2) NOT NULL DEFAULT 0`;
  // Backfill: charges already marked fully refunded get their whole amount.
  await sql`UPDATE customer_charges SET refunded_amount = amount WHERE refunded_at IS NOT NULL AND refunded_amount = 0`;

  // ---- Staff logins & roles (Part 2) --------------------------------------
  // The owner authenticates with APP_PASSWORD and is always treated as 'admin'
  // (no row needed). Rows here are additional front-desk logins the owner adds.
  // password_hash is PBKDF2 (salt embedded — see lib/auth.ts). Setting
  // active=false disables a login in one click (no data access; next /api/me 401s
  // them back to the login screen).
  await sql`
    CREATE TABLE IF NOT EXISTS staff_users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      username TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('admin','staff')),
      active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_login_at TIMESTAMPTZ
    )
  `;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS staff_users_username_key
    ON staff_users (lower(username))`;

  // ---- Audit log (Part 2) --------------------------------------------------
  // Who did each checkout, return, status change, and hold action, with a name
  // + timestamp. actor_id is a staff_users.id, or NULL for the owner.
  await sql`
    CREATE TABLE IF NOT EXISTS audit_log (
      id SERIAL PRIMARY KEY,
      actor_id INT,
      actor_name TEXT NOT NULL,
      actor_role TEXT NOT NULL,
      action TEXT NOT NULL,
      entity TEXT,
      entity_id TEXT,
      detail JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS audit_log_created ON audit_log (created_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS audit_log_entity ON audit_log (entity, entity_id)`;
}

/** Lazily creates tables on first use; safe to call on every request. */
export function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = createSchema().catch((err) => {
      schemaReady = null;
      throw err;
    });
  }
  return schemaReady;
}

export async function nextItemId(): Promise<string> {
  const rows = await sql`SELECT nextval('item_id_seq') AS n`;
  const n = Number(rows[0].n);
  return `BRW-${String(n).padStart(4, "0")}`;
}
