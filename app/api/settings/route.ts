import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { getProgram } from "@/lib/credits";
import { AmbassadorProgram, DEFAULT_PROGRAM } from "@/lib/types";
import { getDropoffConfig, DEFAULT_DROPOFF, DropoffConfig } from "@/lib/dropoff";

export async function GET() {
  await ensureSchema();
  const [program, dropoff] = await Promise.all([getProgram(), getDropoffConfig()]);
  return NextResponse.json({ program, dropoff });
}

export async function PUT(request: Request) {
  await ensureSchema();
  const b = await request.json();
  const p = (b.program ?? {}) as Partial<AmbassadorProgram>;

  // Validate/normalize before persisting.
  const num = (v: unknown, fallback: number) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
  };
  const dates = Array.isArray(p.blackout_dates)
    ? Array.from(
        new Set(
          p.blackout_dates
            .map((d) => String(d).trim())
            .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
        )
      ).sort()
    : [];

  const program: AmbassadorProgram = {
    credits: {
      curator: {
        free: num(p.credits?.curator?.free, DEFAULT_PROGRAM.credits.curator.free),
        rate: num(p.credits?.curator?.rate, DEFAULT_PROGRAM.credits.curator.rate),
      },
      poster: {
        free: num(p.credits?.poster?.free, DEFAULT_PROGRAM.credits.poster.free),
        rate: num(p.credits?.poster?.rate, DEFAULT_PROGRAM.credits.poster.rate),
      },
    },
    cleaning_rate: num(p.cleaning_rate, DEFAULT_PROGRAM.cleaning_rate),
    cleaning_fee: num(p.cleaning_fee, DEFAULT_PROGRAM.cleaning_fee),
    blackout_dates: dates,
    posting_target: num(p.posting_target, DEFAULT_PROGRAM.posting_target),
    post_credit: num(p.post_credit, DEFAULT_PROGRAM.post_credit),
    terminal_reader_id:
      typeof p.terminal_reader_id === "string" ? p.terminal_reader_id.trim() : "",
    hanger_fee: num(p.hanger_fee, DEFAULT_PROGRAM.hanger_fee),
    garment_bag_fee: num(p.garment_bag_fee, DEFAULT_PROGRAM.garment_bag_fee),
  };

  await sql`
    INSERT INTO app_settings (key, value, updated_at)
    VALUES ('ambassador_program', ${JSON.stringify(program)}::jsonb, now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
  `;

  // Drop-off booking window (optional in the same save).
  let dropoff = await getDropoffConfig();
  if (b.dropoff) {
    const d = b.dropoff as Partial<DropoffConfig>;
    const time = (v: unknown, fb: string) =>
      typeof v === "string" && /^\d{1,2}:\d{2}$/.test(v) ? v : fb;
    dropoff = {
      open_days: Array.isArray(d.open_days)
        ? Array.from(new Set(d.open_days.map(Number).filter((n) => n >= 0 && n <= 6)))
        : DEFAULT_DROPOFF.open_days,
      open_time: time(d.open_time, DEFAULT_DROPOFF.open_time),
      close_time: time(d.close_time, DEFAULT_DROPOFF.close_time),
      slot_minutes: [10, 15, 20, 30, 60].includes(Number(d.slot_minutes))
        ? Number(d.slot_minutes)
        : DEFAULT_DROPOFF.slot_minutes,
      closed_dates: Array.isArray(d.closed_dates)
        ? Array.from(
            new Set(
              d.closed_dates
                .map((x) => String(x).trim())
                .filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x))
            )
          ).sort()
        : [],
    };
    await sql`
      INSERT INTO app_settings (key, value, updated_at)
      VALUES ('dropoff', ${JSON.stringify(dropoff)}::jsonb, now())
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
    `;
  }

  return NextResponse.json({ program, dropoff });
}
