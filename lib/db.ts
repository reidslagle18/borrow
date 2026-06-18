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
  await sql`CREATE SEQUENCE IF NOT EXISTS item_id_seq START 1`;
  await sql`
    CREATE TABLE IF NOT EXISTS items (
      id TEXT PRIMARY KEY,
      barcode TEXT,
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
        CHECK (status IN ('available','reserved','rented','cleaning','retired')),
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

  // Allow the new tier ('high') and ownership ('ambassador') values by
  // relaxing the original CHECK constraints (Postgres default names).
  await sql`ALTER TABLE items DROP CONSTRAINT IF EXISTS items_tier_check`;
  await sql`ALTER TABLE items ADD CONSTRAINT items_tier_check
    CHECK (tier IN ('standard','mid','high','premium'))`;
  await sql`ALTER TABLE items DROP CONSTRAINT IF EXISTS items_ownership_check`;
  await sql`ALTER TABLE items ADD CONSTRAINT items_ownership_check
    CHECK (ownership IN ('owned','consignment','ambassador'))`;

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
