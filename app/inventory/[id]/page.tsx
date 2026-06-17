"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import ItemForm from "@/components/ItemForm";
import {
  Item,
  Consignor,
  ItemStatus,
  tierLabel,
  statusLabel,
  ownershipLabel,
} from "@/lib/types";

const STATUS_STYLES: Record<ItemStatus, string> = {
  available: "bg-sage text-ink",
  reserved: "bg-lavender text-ink",
  rented: "bg-blush text-ink",
  cleaning: "bg-butter text-ink",
  retired: "bg-ink/10 text-ink/60",
};

function money(n: number | string | null): string {
  if (n == null || n === "") return "—";
  const v = Number(n);
  return `$${v % 1 === 0 ? v : v.toFixed(2)}`;
}

function fmtDate(d: string | null): string {
  if (!d) return "—";
  const date = new Date(d);
  return isNaN(date.getTime()) ? d : date.toLocaleDateString();
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-[0.15em] text-ink/45">
        {label}
      </dt>
      <dd className="mt-1 text-[15px] text-ink/80">
        {value === null || value === undefined || value === "" ? (
          <span className="text-ink/30">—</span>
        ) : (
          value
        )}
      </dd>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-ink/10 bg-white/60 p-5">
      <h2 className="mb-4 font-serif text-xl italic text-ink/70">{title}</h2>
      <dl className="grid grid-cols-2 gap-x-5 gap-y-4 sm:grid-cols-3">
        {children}
      </dl>
    </section>
  );
}

export default function PieceDetailPage() {
  const params = useParams<{ id: string }>();
  const key = decodeURIComponent(params.id);

  const [item, setItem] = useState<Item | null>(null);
  const [consignors, setConsignors] = useState<Consignor[]>([]);
  const [loadError, setLoadError] = useState("");
  const [activePhoto, setActivePhoto] = useState(0);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [ir, cr] = await Promise.all([
          fetch(`/api/items/${encodeURIComponent(key)}`),
          fetch("/api/consignors"),
        ]);
        if (!ir.ok) throw new Error(`item ${ir.status}`);
        setItem(await ir.json());
        if (cr.ok) setConsignors(await cr.json());
      } catch {
        setLoadError("Couldn't load this piece — it may have been removed.");
      }
    })();
  }, [key]);

  const gallery = item
    ? item.photos?.length
      ? item.photos
      : item.photo_url
        ? [item.photo_url]
        : []
    : [];

  return (
    <AppShell>
      <div className="mx-auto max-w-6xl px-5 py-8 md:px-10 md:py-12">
        <Link
          href="/inventory"
          className="text-sm text-ink/50 underline-offset-2 hover:underline"
        >
          ← Inventory
        </Link>

        {loadError ? (
          <p className="mt-20 text-center text-ink/50">{loadError}</p>
        ) : item === null ? (
          <div className="mt-8 grid gap-8 md:grid-cols-[minmax(0,2fr)_3fr]">
            <div className="aspect-[3/4] animate-pulse rounded-2xl bg-ink/5" />
            <div className="space-y-4">
              <div className="h-10 w-2/3 animate-pulse rounded bg-ink/5" />
              <div className="h-40 animate-pulse rounded-2xl bg-ink/5" />
              <div className="h-40 animate-pulse rounded-2xl bg-ink/5" />
            </div>
          </div>
        ) : (
          <>
            <div className="mt-5 flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-3">
                  <h1 className="font-serif text-4xl font-medium md:text-5xl">
                    {item.brand}
                  </h1>
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-medium ${STATUS_STYLES[item.status]}`}
                  >
                    {statusLabel(item.status)}
                  </span>
                </div>
                <p className="mt-1.5 text-sm text-ink/50">
                  <span className="font-mono">{item.barcode || item.id}</span>
                  {item.silhouette ? ` · ${item.silhouette}` : ""} · {item.size}
                  {item.color ? ` · ${item.color}` : ""}
                </p>
              </div>
              <button
                onClick={() => setEditing(true)}
                className="rounded-full bg-ink px-6 py-3 text-[15px] text-cream transition-transform active:scale-[0.98]"
              >
                Edit piece
              </button>
            </div>

            <div className="mt-8 grid gap-8 md:grid-cols-[minmax(0,2fr)_3fr]">
              {/* Gallery */}
              <div>
                <div className="aspect-[3/4] overflow-hidden rounded-2xl bg-white">
                  {gallery.length ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={gallery[activePhoto] ?? gallery[0]}
                      alt={`${item.brand} ${item.color ?? ""}`}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-lavender/40">
                      <span className="font-serif text-6xl italic text-ink/25">
                        {item.brand.charAt(0)}
                      </span>
                    </div>
                  )}
                </div>
                {gallery.length > 1 && (
                  <div className="mt-3 grid grid-cols-4 gap-2">
                    {gallery.map((url, i) => (
                      <button
                        key={url}
                        onClick={() => setActivePhoto(i)}
                        className={`aspect-square overflow-hidden rounded-lg border-2 ${
                          i === activePhoto
                            ? "border-ink"
                            : "border-transparent opacity-70"
                        }`}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={url}
                          alt={`${item.brand} ${i + 1}`}
                          className="h-full w-full object-cover"
                        />
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Fields */}
              <div className="space-y-5">
                {item.description && (
                  <p className="text-[15px] leading-relaxed text-ink/70">
                    {item.description}
                  </p>
                )}

                <Section title="Details">
                  <Field label="Silhouette" value={item.silhouette} />
                  <Field label="Size" value={item.size} />
                  <Field label="Color(s)" value={item.color} />
                  <Field label="Fabric" value={item.fabric} />
                  <Field label="Fit notes" value={item.fit_notes} />
                  <Field
                    label="Event tags"
                    value={
                      item.event_types?.length ? (
                        <span className="flex flex-wrap gap-1.5">
                          {item.event_types.map((ev) => (
                            <span
                              key={ev}
                              className="rounded-full bg-sage/60 px-2.5 py-0.5 text-[12px]"
                            >
                              {ev}
                            </span>
                          ))}
                        </span>
                      ) : null
                    }
                  />
                </Section>

                <Section title="Tier & pricing">
                  <Field label="Tier" value={tierLabel(item.tier)} />
                  <Field label="Rental price" value={money(item.rental_price)} />
                  <Field
                    label="Retail / replacement"
                    value={money(item.retail_value)}
                  />
                </Section>

                <Section title="Ownership & sourcing">
                  <Field
                    label="Ownership"
                    value={ownershipLabel(item.ownership)}
                  />
                  {item.ownership === "consignment" && (
                    <Field label="Consignor" value={item.consignor_name} />
                  )}
                  <Field label="Acquisition cost" value={money(item.purchase_cost)} />
                  <Field
                    label="Acquired"
                    value={fmtDate(item.acquisition_date)}
                  />
                  <Field label="Source" value={item.source} />
                </Section>

                <Section title="Lifecycle">
                  <Field label="Current location" value={item.location} />
                  <Field label="Rental count" value={item.rental_count} />
                  <Field label="Cleaning count" value={item.cleaning_count} />
                  <Field label="Date added" value={fmtDate(item.created_at)} />
                  <Field label="Date retired" value={fmtDate(item.retired_at)} />
                </Section>

                {item.condition_notes && (
                  <Section title="Condition / damage">
                    <div className="col-span-full">
                      <p className="whitespace-pre-line text-[15px] leading-relaxed text-ink/70">
                        {item.condition_notes}
                      </p>
                    </div>
                  </Section>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {editing && item && (
        <ItemForm
          item={item}
          consignors={consignors}
          onClose={() => setEditing(false)}
          onSaved={(saved) => {
            setItem(saved);
            setActivePhoto(0);
            setEditing(false);
          }}
          onDeleted={() => {
            window.location.href = "/inventory";
          }}
          onConsignorAdded={(c) => setConsignors((prev) => [...prev, c])}
        />
      )}
    </AppShell>
  );
}
