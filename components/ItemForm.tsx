"use client";

import { useRef, useState } from "react";
import { upload } from "@vercel/blob/client";
import {
  Item,
  Consignor,
  Tier,
  Ownership,
  ItemStatus,
  TIERS,
  SIZES,
  EVENT_TYPES,
  STATUSES,
} from "@/lib/types";

/** Downscale a photo client-side so iPad camera shots upload fast. */
async function resizeImage(file: File, maxDim = 1600): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = url;
    });
    const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
    if (scale === 1 && file.size < 2 * 1024 * 1024) return file;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("resize failed"))),
        "image/jpeg",
        0.85
      )
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

const inputCls =
  "w-full rounded-xl border border-ink/15 bg-white px-3.5 py-2.5 text-[15px] outline-none focus:border-ink/40";
const labelCls = "mb-1.5 block text-xs uppercase tracking-[0.15em] text-ink/50";

export default function ItemForm({
  item,
  consignors,
  onClose,
  onSaved,
  onDeleted,
  onConsignorAdded,
}: {
  item: Item | null;
  consignors: Consignor[];
  onClose: () => void;
  onSaved: (item: Item) => void;
  onDeleted: (id: string) => void;
  onConsignorAdded: (c: Consignor) => void;
}) {
  const editing = !!item;
  const [brand, setBrand] = useState(item?.brand ?? "");
  const [size, setSize] = useState(item?.size ?? "");
  const [color, setColor] = useState(item?.color ?? "");
  const [tier, setTier] = useState<Tier>(item?.tier ?? "standard");
  const [rentalPrice, setRentalPrice] = useState<string>(
    item ? String(item.rental_price) : "45"
  );
  const [purchaseCost, setPurchaseCost] = useState<string>(
    item?.purchase_cost != null ? String(item.purchase_cost) : ""
  );
  const [conditionNotes, setConditionNotes] = useState(
    item?.condition_notes ?? ""
  );
  const [ownership, setOwnership] = useState<Ownership>(
    item?.ownership ?? "owned"
  );
  const [consignorId, setConsignorId] = useState<number | "">(
    item?.consignor_id ?? ""
  );
  const [consignorQuery, setConsignorQuery] = useState("");
  const [consignorListOpen, setConsignorListOpen] = useState(false);
  const [eventTypes, setEventTypes] = useState<string[]>(
    item?.event_types ?? []
  );
  const [status, setStatus] = useState<ItemStatus>(item?.status ?? "available");
  const [photoUrl, setPhotoUrl] = useState<string | null>(
    item?.photo_url ?? null
  );
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [error, setError] = useState("");
  const [showNewConsignor, setShowNewConsignor] = useState(false);
  const [ncName, setNcName] = useState("");
  const [ncPhone, setNcPhone] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const selectedConsignor =
    consignors.find((c) => c.id === consignorId) ?? null;

  const consignorMatches = (() => {
    const q = consignorQuery.trim().toLowerCase();
    if (!q) return consignors.slice(0, 8);
    return consignors
      .filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          (c.phone ?? "")
            .replace(/\D/g, "")
            .includes(q.replace(/\D/g, "") || " ") ||
          (c.email ?? "").toLowerCase().includes(q)
      )
      .slice(0, 8);
  })();

  function pickTier(t: Tier) {
    const prevDefault = TIERS.find((x) => x.value === tier)?.price;
    setTier(t);
    const next = TIERS.find((x) => x.value === t)!.price;
    // keep a custom price the owner typed; follow the tier otherwise
    if (rentalPrice === "" || Number(rentalPrice) === prevDefault) {
      setRentalPrice(String(next));
    }
  }

  async function handlePhoto(file: File) {
    setUploading(true);
    setError("");
    try {
      const resized = await resizeImage(file);
      const blob = await upload(
        `items/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.-]/g, "_")}`,
        resized,
        { access: "public", handleUploadUrl: "/api/upload", contentType: "image/jpeg" }
      );
      setPhotoUrl(blob.url);
    } catch {
      setError("Photo upload failed — try again.");
    } finally {
      setUploading(false);
    }
  }

  async function addConsignor() {
    if (!ncName.trim()) return;
    const res = await fetch("/api/consignors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: ncName.trim(), phone: ncPhone.trim() }),
    });
    if (res.ok) {
      const c: Consignor = await res.json();
      onConsignorAdded(c);
      setConsignorId(c.id);
      setShowNewConsignor(false);
      setNcName("");
      setNcPhone("");
    }
  }

  async function save() {
    if (!brand.trim() || !size || rentalPrice === "") {
      setError("Brand, size and rental price are required.");
      return;
    }
    if (ownership === "consignment" && consignorId === "") {
      setError("Pick a consignor for consignment pieces.");
      return;
    }
    setSaving(true);
    setError("");
    const payload = {
      brand: brand.trim(),
      size,
      color: color.trim(),
      tier,
      rental_price: Number(rentalPrice),
      purchase_cost: purchaseCost === "" ? null : Number(purchaseCost),
      condition_notes: conditionNotes.trim(),
      ownership,
      consignor_id: consignorId === "" ? null : consignorId,
      event_types: eventTypes,
      status,
      photo_url: photoUrl,
    };
    const res = await fetch(editing ? `/api/items/${item!.id}` : "/api/items", {
      method: editing ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      const saved: Item = await res.json();
      saved.consignor_name =
        consignors.find((c) => c.id === saved.consignor_id)?.name ?? null;
      onSaved(saved);
    } else {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Couldn't save — try again.");
      setSaving(false);
    }
  }

  async function remove() {
    setSaving(true);
    const res = await fetch(`/api/items/${item!.id}`, { method: "DELETE" });
    if (res.ok) {
      onDeleted(item!.id);
    } else {
      setError("Couldn't delete — try again.");
      setSaving(false);
    }
  }

  function toggleEvent(ev: string) {
    setEventTypes((prev) =>
      prev.includes(ev) ? prev.filter((x) => x !== ev) : [...prev, ev]
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 sm:items-center sm:p-6"
      onClick={onClose}
    >
      <div
        className="max-h-[94vh] w-full max-w-2xl overflow-y-auto rounded-t-3xl bg-cream p-6 sm:rounded-3xl sm:p-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-6 flex items-start justify-between">
          <div>
            <h2 className="text-3xl font-medium">
              {editing ? "Edit piece" : "New piece"}
            </h2>
            {editing && (
              <p className="mt-1 text-sm tracking-wide text-ink/50">
                {item!.id} · rented {item!.rental_count}×
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="rounded-full px-3 py-1 text-2xl leading-none text-ink/40 hover:bg-ink/5"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="grid gap-5 sm:grid-cols-[200px_1fr]">
          {/* Photo */}
          <div>
            <span className={labelCls}>Photo</span>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="relative block aspect-[3/4] w-full overflow-hidden rounded-2xl border border-dashed border-ink/20 bg-white"
            >
              {photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={photoUrl}
                  alt="Item"
                  className="h-full w-full object-cover"
                />
              ) : (
                <span className="flex h-full w-full flex-col items-center justify-center gap-1 text-ink/40">
                  <span className="font-serif text-4xl italic">+</span>
                  <span className="text-xs uppercase tracking-widest">
                    {uploading ? "Uploading…" : "Add photo"}
                  </span>
                </span>
              )}
              {uploading && photoUrl && (
                <span className="absolute inset-0 flex items-center justify-center bg-cream/70 text-sm">
                  Uploading…
                </span>
              )}
            </button>
            {photoUrl && (
              <button
                type="button"
                onClick={() => setPhotoUrl(null)}
                className="mt-2 text-xs uppercase tracking-widest text-ink/40 underline-offset-2 hover:underline"
              >
                Remove photo
              </button>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handlePhoto(f);
                e.target.value = "";
              }}
            />
          </div>

          {/* Fields */}
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2 sm:col-span-1">
                <label className={labelCls}>Brand *</label>
                <input
                  className={inputCls}
                  value={brand}
                  onChange={(e) => setBrand(e.target.value)}
                  placeholder="Réalisation Par"
                />
              </div>
              <div>
                <label className={labelCls}>Size *</label>
                <select
                  className={inputCls}
                  value={size}
                  onChange={(e) => setSize(e.target.value)}
                >
                  <option value="">Select</option>
                  {SIZES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelCls}>Color</label>
                <input
                  className={inputCls}
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  placeholder="Dusty pink"
                />
              </div>
            </div>

            <div>
              <label className={labelCls}>Tier</label>
              <div className="flex gap-2">
                {TIERS.map((t) => (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => pickTier(t.value)}
                    className={`flex-1 rounded-full border px-3 py-2 text-sm transition-colors ${
                      tier === t.value
                        ? "border-ink bg-ink text-cream"
                        : "border-ink/15 bg-white text-ink/70"
                    }`}
                  >
                    {t.label} ${t.price}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Rental price ($) *</label>
                <input
                  type="number"
                  inputMode="decimal"
                  className={inputCls}
                  value={rentalPrice}
                  onChange={(e) => setRentalPrice(e.target.value)}
                />
              </div>
              <div>
                <label className={labelCls}>Purchase cost ($)</label>
                <input
                  type="number"
                  inputMode="decimal"
                  className={inputCls}
                  value={purchaseCost}
                  onChange={(e) => setPurchaseCost(e.target.value)}
                  placeholder="—"
                />
              </div>
            </div>

            <div>
              <label className={labelCls}>Ownership</label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setOwnership("owned")}
                  className={`flex-1 rounded-full border px-3 py-2 text-sm ${
                    ownership === "owned"
                      ? "border-ink bg-ink text-cream"
                      : "border-ink/15 bg-white text-ink/70"
                  }`}
                >
                  BORROW owns it
                </button>
                <button
                  type="button"
                  onClick={() => setOwnership("consignment")}
                  className={`flex-1 rounded-full border px-3 py-2 text-sm ${
                    ownership === "consignment"
                      ? "border-ink bg-ink text-cream"
                      : "border-ink/15 bg-white text-ink/70"
                  }`}
                >
                  Consignment
                </button>
              </div>
            </div>

            {ownership === "consignment" && (
              <div className="rounded-2xl bg-blush/20 p-3.5">
                <label className={labelCls}>Consignor *</label>
                {selectedConsignor ? (
                  <div className="flex items-center justify-between rounded-xl border border-ink/15 bg-white px-3.5 py-2.5">
                    <span className="truncate text-[15px]">
                      {selectedConsignor.name}
                      {selectedConsignor.phone && (
                        <span className="text-ink/50">
                          {" "}
                          · {selectedConsignor.phone}
                        </span>
                      )}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setConsignorId("");
                        setConsignorQuery("");
                      }}
                      className="ml-2 shrink-0 rounded-full px-2 text-lg leading-none text-ink/40 hover:bg-ink/5"
                      aria-label="Clear consignor"
                    >
                      ×
                    </button>
                  </div>
                ) : (
                  <div className="relative">
                    <input
                      className={inputCls}
                      placeholder="Search name or phone…"
                      value={consignorQuery}
                      onChange={(e) => {
                        setConsignorQuery(e.target.value);
                        setConsignorListOpen(true);
                      }}
                      onFocus={() => setConsignorListOpen(true)}
                      onBlur={() =>
                        setTimeout(() => setConsignorListOpen(false), 150)
                      }
                    />
                    {consignorListOpen && (
                      <div className="absolute z-10 mt-1.5 max-h-56 w-full overflow-y-auto rounded-xl border border-ink/10 bg-white shadow-lg">
                        {consignorMatches.map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => {
                              setConsignorId(c.id);
                              setConsignorListOpen(false);
                            }}
                            className="block w-full px-3.5 py-2.5 text-left text-[15px] hover:bg-cream"
                          >
                            {c.name}
                            {c.phone && (
                              <span className="text-ink/45"> · {c.phone}</span>
                            )}
                          </button>
                        ))}
                        <button
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => {
                            setNcName(consignorQuery.trim());
                            setShowNewConsignor(true);
                            setConsignorListOpen(false);
                          }}
                          className="block w-full border-t border-ink/10 px-3.5 py-2.5 text-left text-[15px] text-ink/60 hover:bg-cream"
                        >
                          + New consignor
                          {consignorQuery.trim()
                            ? ` “${consignorQuery.trim()}”`
                            : ""}
                        </button>
                        {consignorMatches.length === 0 &&
                          consignorQuery.trim() && (
                            <p className="px-3.5 pb-2.5 pt-1 text-[13px] text-ink/40">
                              No one matches “{consignorQuery.trim()}”.
                            </p>
                          )}
                      </div>
                    )}
                  </div>
                )}
                {showNewConsignor && (
                  <div className="mt-3 space-y-2">
                    <input
                      className={inputCls}
                      placeholder="Name"
                      value={ncName}
                      onChange={(e) => setNcName(e.target.value)}
                    />
                    <input
                      className={inputCls}
                      placeholder="Phone (optional)"
                      value={ncPhone}
                      onChange={(e) => setNcPhone(e.target.value)}
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={addConsignor}
                        className="rounded-full bg-ink px-4 py-1.5 text-sm text-cream"
                      >
                        Add
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowNewConsignor(false)}
                        className="rounded-full px-4 py-1.5 text-sm text-ink/50"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            <div>
              <label className={labelCls}>Event types</label>
              <div className="flex flex-wrap gap-1.5">
                {EVENT_TYPES.map((ev) => (
                  <button
                    key={ev}
                    type="button"
                    onClick={() => toggleEvent(ev)}
                    className={`rounded-full border px-3 py-1.5 text-sm ${
                      eventTypes.includes(ev)
                        ? "border-sage-deep bg-sage text-ink"
                        : "border-ink/15 bg-white text-ink/60"
                    }`}
                  >
                    {ev}
                  </button>
                ))}
              </div>
            </div>

            {editing && (
              <div>
                <label className={labelCls}>Status</label>
                <select
                  className={inputCls}
                  value={status}
                  onChange={(e) => setStatus(e.target.value as ItemStatus)}
                >
                  {STATUSES.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label className={labelCls}>Condition notes</label>
              <textarea
                className={`${inputCls} min-h-20 resize-y`}
                value={conditionNotes}
                onChange={(e) => setConditionNotes(e.target.value)}
                placeholder="Tiny pull near left strap, otherwise perfect."
              />
            </div>
          </div>
        </div>

        {error && <p className="mt-4 text-sm text-blush-deep">{error}</p>}

        <div className="mt-6 flex items-center gap-3">
          <button
            onClick={save}
            disabled={saving || uploading}
            className="flex-1 rounded-full bg-ink px-6 py-3.5 text-base text-cream transition-opacity disabled:opacity-40"
          >
            {saving ? "Saving…" : editing ? "Save changes" : "Add to inventory"}
          </button>
          {editing &&
            (confirmingDelete ? (
              <button
                onClick={remove}
                disabled={saving}
                className="rounded-full border border-blush-deep px-5 py-3.5 text-base text-blush-deep"
              >
                Really delete?
              </button>
            ) : (
              <button
                onClick={() => setConfirmingDelete(true)}
                className="rounded-full border border-ink/15 px-5 py-3.5 text-base text-ink/50"
              >
                Delete
              </button>
            ))}
        </div>
      </div>
    </div>
  );
}
