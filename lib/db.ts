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
      tier TEXT NOT NULL CHECK (tier IN ('standard','mid','high','premium')),
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
        CHECK (status IN ('available','reserved','rented','cleaning','retired','with_consignor')),
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
  await sql`ALTER TABLE items ADD COLUMN IF NOT EXISTS cleaning_count INT NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE items ADD COLUMN IF NOT EXISTS retired_at DATE`;
  await sql`ALTER TABLE items ADD COLUMN IF NOT EXISTS photos TEXT[] NOT NULL DEFAULT '{}'`;
  await sql`ALTER TABLE items ADD COLUMN IF NOT EXISTS new_with_tags BOOLEAN NOT NULL DEFAULT false`;
  await sql`ALTER TABLE items ADD COLUMN IF NOT EXISTS ambassador_id INT`;

  // Allow the new tier ('high') and ownership ('ambassador') values by
  // relaxing the original CHECK constraints (Postgres default names).
  await sql`ALTER TABLE items DROP CONSTRAINT IF EXISTS items_tier_check`;
  await sql`ALTER TABLE items ADD CONSTRAINT items_tier_check
    CHECK (tier IN ('standard','mid','high','premium'))`;
  await sql`ALTER TABLE items DROP CONSTRAINT IF EXISTS items_ownership_check`;
  await sql`ALTER TABLE items ADD CONSTRAINT items_ownership_check
    CHECK (ownership IN ('owned','consignment','ambassador'))`;
  // Allow the 'with_consignor' hold status (consignor borrowing their own piece).
  await sql`ALTER TABLE items DROP CONSTRAINT IF EXISTS items_status_check`;
  await sql`ALTER TABLE items ADD CONSTRAINT items_status_check
    CHECK (status IN ('available','reserved','rented','cleaning','retired','with_consignor'))`;

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
  // Link rentals to their checkout transaction (additive; existing rows null).
  await sql`ALTER TABLE rentals ADD COLUMN IF NOT EXISTS transaction_id INT REFERENCES transactions(id)`;
  // Actual Cleaning & Care Fee charged on this rental (the damage_waiver boolean
  // is retained as "fee charged?"). Stored so finances reflect the real amount
  // rather than a hardcoded multiplier; legacy rows fall back to $5 in queries.
  await sql`ALTER TABLE rentals ADD COLUMN IF NOT EXISTS cleaning_fee NUMERIC(8,2) NOT NULL DEFAULT 0`;
  // Dedupe flags for the daily reminder job (so each reminder sends once).
  await sql`ALTER TABLE rentals ADD COLUMN IF NOT EXISTS pickup_reminded BOOLEAN NOT NULL DEFAULT false`;
  await sql`ALTER TABLE rentals ADD COLUMN IF NOT EXISTS due_reminded BOOLEAN NOT NULL DEFAULT false`;

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
