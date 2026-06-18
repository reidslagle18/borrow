import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { getProgram } from "@/lib/credits";
import { AmbassadorProgram, DEFAULT_PROGRAM } from "@/lib/types";

export async function GET() {
  await ensureSchema();
  const program = await getProgram();
  return NextResponse.json({ program });
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
    blackout_dates: dates,
    posting_target: num(p.posting_target, DEFAULT_PROGRAM.posting_target),
  };

  await sql`
    INSERT INTO app_settings (key, value, updated_at)
    VALUES ('ambassador_program', ${JSON.stringify(program)}::jsonb, now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
  `;
  return NextResponse.json({ program });
}
