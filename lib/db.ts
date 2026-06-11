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
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`CREATE SEQUENCE IF NOT EXISTS item_id_seq START 1`;
  await sql`
    CREATE TABLE IF NOT EXISTS items (
      id TEXT PRIMARY KEY,
      brand TEXT NOT NULL,
      size TEXT NOT NULL,
      color TEXT,
      tier TEXT NOT NULL CHECK (tier IN ('standard','mid','premium')),
      rental_price NUMERIC(8,2) NOT NULL,
      purchase_cost NUMERIC(8,2),
      condition_notes TEXT,
      ownership TEXT NOT NULL CHECK (ownership IN ('owned','consignment')),
      consignor_id INT REFERENCES consignors(id),
      event_types TEXT[] NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'available'
        CHECK (status IN ('available','reserved','rented','cleaning','retired')),
      photo_url TEXT,
      rental_count INT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS customers (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT,
      email TEXT,
      instagram TEXT,
      flag TEXT CHECK (flag IN ('vip','problem')),
      notes TEXT,
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
