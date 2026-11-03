import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { getProgram } from "@/lib/credits";
import { AmbassadorProgram, DEFAULT_PROGRAM, cleanOccasions } from "@/lib/types";
import { getDropoffConfig, DEFAULT_DROPOFF, DropoffConfig } from "@/lib/dropoff";

export async function GET() {
  await ensureSchema();
  const [program, dropoff] = await Promise.all([getProgram(), getDropoffConfig()]);
  return NextResponse.json({ program, dropoff });
}

export async function PUT(request: Request) {
  if (!(await requireAdmin()))
    return NextResponse.json({ error: "Admins only" }, { status: 403 });
  await ensureSchema();
  const b = await request.json();
  const p = (b.program ?? {}) as Partial<AmbassadorProgram>;

  // Validate/normalize before persisting.
  const num = (v: unknown, fallback: number) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
  };
  // Decimals allowed (e.g. a 9.75% tax rate), clamped to a sane range.
  const dec = (v: unknown, fallback: number) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 && n <= 100 ? Math.round(n * 1000) / 1000 : fallback;
  };
  const cleanDates = (arr: unknown): string[] =>
    Array.isArray(arr)
      ? Array.from(
          new Set(
            arr
              .map((d) => String(d).trim())
              .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
          )
        ).sort()
      : [];
  const dates = cleanDates(p.blackout_dates);
  const storeClosed = cleanDates(p.store_closed_dates);
  // Recurring closed weekdays (0=Sun … 6=Sat), de-duped and sorted.
  const storeClosedWeekdays = Array.isArray(p.store_closed_weekdays)
    ? Array.from(
        new Set(
          p.store_closed_weekdays
            .map((n: unknown) => Number(n))
            .filter((n: number) => Number.isInteger(n) && n >= 0 && n <= 6)
        )
      ).sort((a, b) => a - b)
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
    retrieval_cleaning_fee: num(
      p.retrieval_cleaning_fee,
      DEFAULT_PROGRAM.retrieval_cleaning_fee
    ),
    blackout_dates: dates,
    store_closed_dates: storeClosed,
    store_closed_weekdays: storeClosedWeekdays,
    posting_target: num(p.posting_target, DEFAULT_PROGRAM.posting_target),
    post_credit: num(p.post_credit, DEFAULT_PROGRAM.post_credit),
    terminal_reader_id:
      typeof p.terminal_reader_id === "string" ? p.terminal_reader_id.trim() : "",
    hanger_fee: num(p.hanger_fee, DEFAULT_PROGRAM.hanger_fee),
    garment_bag_fee: num(p.garment_bag_fee, DEFAULT_PROGRAM.garment_bag_fee),
    turnaround_days: num(p.turnaround_days, DEFAULT_PROGRAM.turnaround_days),
    reservation_protect_days: Math.max(
      1,
      num(p.reservation_protect_days, DEFAULT_PROGRAM.reservation_protect_days)
    ),
    hold_notice_lead_days: Math.max(
      0,
      num(p.hold_notice_lead_days, DEFAULT_PROGRAM.hold_notice_lead_days)
    ),
    sales_tax_rate: dec(p.sales_tax_rate, DEFAULT_PROGRAM.sales_tax_rate),
    reservations_open: /^\d{4}-\d{2}-\d{2}$/.test(String(p.reservations_open))
      ? String(p.reservations_open)
      : "",
    underperformance_days: Math.max(
      1,
      num(p.underperformance_days, DEFAULT_PROGRAM.underperformance_days)
    ),
    storage_window_days: Math.max(
      1,
      num(p.storage_window_days, DEFAULT_PROGRAM.storage_window_days)
    ),
    approval_batch_window_min: Math.max(
      1,
      num(p.approval_batch_window_min, DEFAULT_PROGRAM.approval_batch_window_min)
    ),
    color_swatches: (() => {
      const out: Record<string, string> = {};
      const src =
        p.color_swatches && typeof p.color_swatches === "object" && !Array.isArray(p.color_swatches)
          ? (p.color_swatches as Record<string, unknown>)
          : DEFAULT_PROGRAM.color_swatches;
      for (const [k, val] of Object.entries(src)) {
        const name = String(k).trim().toLowerCase();
        const hex = String(val).trim().toLowerCase();
        if (name && /^#[0-9a-f]{6}$/.test(hex)) out[name] = hex;
      }
      return out;
    })(),
    // Occasion → sub-occasion map (owner-editable). Only overwrite when the save
    // actually includes it, so other settings saves don't wipe it.
    occasions:
      p.occasions === undefined
        ? (await getProgram()).occasions
        : cleanOccasions(p.occasions),
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
    // Per-weekday hour overrides: keep valid weekday keys with valid times.
    const rawHours = (d.day_hours && typeof d.day_hours === "object"
      ? d.day_hours
      : {}) as Record<string, { open?: string; close?: string }>;
    const day_hours: Record<string, { open: string; close: string }> = {};
    for (const k of Object.keys(rawHours)) {
      const n = Number(k);
      if (n >= 0 && n <= 6 && rawHours[k]) {
        day_hours[String(n)] = {
          open: time(rawHours[k].open, DEFAULT_DROPOFF.open_time),
          close: time(rawHours[k].close, DEFAULT_DROPOFF.close_time),
        };
      }
    }
    dropoff = {
      open_days: Array.isArray(d.open_days)
        ? Array.from(new Set(d.open_days.map(Number).filter((n) => n >= 0 && n <= 6)))
        : DEFAULT_DROPOFF.open_days,
      open_time: time(d.open_time, DEFAULT_DROPOFF.open_time),
      close_time: time(d.close_time, DEFAULT_DROPOFF.close_time),
      slot_minutes: [10, 15, 20, 30, 45, 60].includes(Number(d.slot_minutes))
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
      start_date:
        typeof d.start_date === "string" &&
        (d.start_date === "" || /^\d{4}-\d{2}-\d{2}$/.test(d.start_date))
          ? d.start_date
          : "",
      day_hours,
    };
    await sql`
      INSERT INTO app_settings (key, value, updated_at)
      VALUES ('dropoff', ${JSON.stringify(dropoff)}::jsonb, now())
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
    `;
  }

  return NextResponse.json({ program, dropoff });
}
