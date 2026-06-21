"use client";

import { useEffect, useRef, useState } from "react";
import { upload } from "@vercel/blob/client";
import CameraScanner from "./CameraScanner";
import PhotoCropper from "./PhotoCropper";
import { beep } from "@/lib/scanSound";
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
  OWNERSHIPS,
  SILHOUETTES,
  COLORS,
} from "@/lib/types";

/** Downscale a photo client-side so iPad camera shots upload fast. */
async function resizeImage(file: Blob, maxDim = 1600): Promise<Blob> {
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
  const [barcode, setBarcode] = useState(item?.barcode ?? "");
  const [brand, setBrand] = useState(item?.brand ?? "");
  const [description, setDescription] = useState(item?.description ?? "");
  const [size, setSize] = useState(item?.size ?? "");
  const [colors, setColors] = useState<string[]>(
    item?.color
      ? item.color.split(",").map((c) => c.trim()).filter(Boolean)
      : []
  );
  const [fabric, setFabric] = useState(item?.fabric ?? "");
  const [fitNotes, setFitNotes] = useState(item?.fit_notes ?? "");
  const [silhouette, setSilhouette] = useState(item?.silhouette ?? "");
  const [newWithTags, setNewWithTags] = useState(item?.new_with_tags ?? false);
  const [tier, setTier] = useState<Tier>(item?.tier ?? "standard");
  const [rentalPrice, setRentalPrice] = useState<string>(
    item ? String(item.rental_price) : String(TIERS[0].price)
  );
  const [purchaseCost, setPurchaseCost] = useState<string>(
    item?.purchase_cost != null ? String(item.purchase_cost) : ""
  );
  const [retailValue, setRetailValue] = useState<string>(
    item?.retail_value != null ? String(item.retail_value) : ""
  );
  const [acquisitionDate, setAcquisitionDate] = useState(
    item?.acquisition_date ?? ""
  );
  const [source, setSource] = useState(item?.source ?? "");
  const [ambassadorId, setAmbassadorId] = useState<number | "">(
    item?.ambassador_id ?? ""
  );
  const [ambassadors, setAmbassadors] = useState<
    { id: number; name: string }[]
  >([]);
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
  const [location, setLocation] = useState(item?.location ?? "");
  const [photos, setPhotos] = useState<string[]>(
    item?.photos?.length ? item.photos : item?.photo_url ? [item.photo_url] : []
  );
  const [uploading, setUploading] = useState(false);
  const [cropQueue, setCropQueue] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [error, setError] = useState("");
  const [showNewConsignor, setShowNewConsignor] = useState(false);
  const [ncName, setNcName] = useState("");
  const [ncPhone, setNcPhone] = useState("");
  const [ncEmail, setNcEmail] = useState("");
  const [ncVenmo, setNcVenmo] = useState("");
  const [ncBackup, setNcBackup] = useState("");
  const [ncError, setNcError] = useState("");
  const [initialClean, setInitialClean] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const barcodeRef = useRef<HTMLInputElement>(null);
  const [scanOpen, setScanOpen] = useState(false);

  // Focus the Barcode field as soon as the modal opens so a handheld scan
  // (keyboard wedge) lands straight in it — no need to tap the field first.
  useEffect(() => {
    const el = barcodeRef.current;
    if (el) {
      el.focus();
      el.select();
    }
  }, []);

  // Load ambassadors so a piece can be attributed to whoever sourced it.
  useEffect(() => {
    (async () => {
      const res = await fetch("/api/ambassadors");
      if (res.ok) {
        const data = await res.json();
        setAmbassadors(
          data.map((a: { id: number; name: string }) => ({
            id: a.id,
            name: a.name,
          }))
        );
      }
    })();
  }, []);

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

  // Newly-selected files wait here so each can be cropped before upload.
  function handlePhotos(files: FileList) {
    setCropQueue(Array.from(files));
  }

  async function uploadBlob(blob: Blob) {
    setUploading(true);
    setError("");
    try {
      const resized = await resizeImage(blob);
      const up = await upload(
        `items/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`,
        resized,
        { access: "public", handleUploadUrl: "/api/upload", contentType: "image/jpeg" }
      );
      setPhotos((prev) => [...prev, up.url]);
    } catch {
      setError("Photo upload failed — try again.");
    } finally {
      setUploading(false);
    }
  }

  function removePhoto(url: string) {
    setPhotos((prev) => prev.filter((p) => p !== url));
  }

  function makeCover(url: string) {
    setPhotos((prev) => [url, ...prev.filter((p) => p !== url)]);
  }

  async function addConsignor() {
    // Email + phone are required so the consignor can log into the portal
    // (login matches on email + phone) and be notified when a piece rents.
    if (!ncName.trim() || !ncEmail.trim() || !ncPhone.trim()) {
      setNcError("Name, email and phone are all required for a consignor.");
      return;
    }
    setNcError("");
    const res = await fetch("/api/consignors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: ncName.trim(),
        phone: ncPhone.trim(),
        email: ncEmail.trim(),
        venmo: ncVenmo.trim(),
        payout_backup: ncBackup.trim(),
      }),
    });
    if (res.ok) {
      const c: Consignor = await res.json();
      onConsignorAdded(c);
      setConsignorId(c.id);
      setShowNewConsignor(false);
      setNcName("");
      setNcPhone("");
      setNcEmail("");
      setNcVenmo("");
      setNcBackup("");
    } else {
      setNcError("Couldn't add consignor — try again.");
    }
  }

  async function save() {
    if (!barcode.trim() || !brand.trim() || !size || rentalPrice === "") {
      setError("Barcode, brand, size and rental price are required.");
      return;
    }
    if (ownership === "consignment" && consignorId === "") {
      setError("Pick a consignor for consignment pieces.");
      return;
    }
    setSaving(true);
    setError("");
    const payload = {
      barcode: barcode.trim(),
      brand: brand.trim(),
      description: description.trim(),
      size,
      color: colors.join(", "),
      fabric: fabric.trim(),
      fit_notes: fitNotes.trim(),
      silhouette: silhouette || null,
      new_with_tags: newWithTags,
      tier,
      rental_price: Number(rentalPrice),
      purchase_cost: purchaseCost === "" ? null : Number(purchaseCost),
      retail_value: retailValue === "" ? null : Number(retailValue),
      acquisition_date: acquisitionDate || null,
      source: source.trim(),
      ambassador_id: ambassadorId === "" ? null : ambassadorId,
      initial_clean: !editing && ownership === "consignment" && initialClean,
      condition_notes: conditionNotes.trim(),
      ownership,
      consignor_id: consignorId === "" ? null : consignorId,
      event_types: eventTypes,
      status,
      location: location.trim(),
      photo_url: photos[0] ?? null,
      photos,
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
    <>
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
                <span className="font-mono">{item!.barcode || item!.id}</span> ·
                rented {item!.rental_count}×
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
          {/* Photos */}
          <div>
            <span className={labelCls}>Photos</span>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="relative block aspect-[3/4] w-full overflow-hidden rounded-2xl border border-dashed border-ink/20 bg-white"
            >
              {photos[0] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={photos[0]}
                  alt="Item cover"
                  className="h-full w-full object-cover"
                />
              ) : (
                <span className="flex h-full w-full flex-col items-center justify-center gap-1 text-ink/40">
                  <span className="font-serif text-4xl italic">+</span>
                  <span className="text-xs uppercase tracking-widest">
                    {uploading ? "Uploading…" : "Add photos"}
                  </span>
                </span>
              )}
              {uploading && (
                <span className="absolute inset-0 flex items-center justify-center bg-cream/70 text-sm">
                  Uploading…
                </span>
              )}
              {photos[0] && (
                <span className="absolute left-2 top-2 rounded-full bg-ink/70 px-2 py-0.5 text-[10px] uppercase tracking-wider text-cream">
                  Cover
                </span>
              )}
            </button>
            {photos.length > 0 && (
              <div className="mt-2 grid grid-cols-3 gap-1.5">
                {photos.map((url) => (
                  <div
                    key={url}
                    className="group relative aspect-square overflow-hidden rounded-lg border border-ink/10 bg-white"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={url}
                      alt="Item"
                      className="h-full w-full object-cover"
                    />
                    <div className="absolute inset-0 flex items-end justify-between gap-1 bg-gradient-to-t from-ink/60 to-transparent p-1 opacity-0 transition-opacity group-hover:opacity-100">
                      {photos[0] !== url && (
                        <button
                          type="button"
                          onClick={() => makeCover(url)}
                          className="rounded bg-cream/90 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-ink"
                        >
                          Cover
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => removePhoto(url)}
                        className="ml-auto rounded bg-cream/90 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-blush-deep"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                const f = e.target.files;
                if (f && f.length) handlePhotos(f);
                e.target.value = "";
              }}
            />
          </div>

          {/* Fields */}
          <div className="space-y-4">
            <div>
              <label className={labelCls}>Barcode ID *</label>
              <div className="flex gap-2">
                <input
                  ref={barcodeRef}
                  className={`${inputCls} font-mono tracking-wide`}
                  value={barcode}
                  onChange={(e) => setBarcode(e.target.value)}
                  placeholder="Scan or type — e.g. 0123456789"
                />
                <button
                  type="button"
                  onClick={() => setScanOpen(true)}
                  className="shrink-0 rounded-xl border border-ink/15 bg-white px-4 text-[15px] text-ink/70"
                >
                  Camera
                </button>
              </div>
            </div>

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
                <label className={labelCls}>Color(s)</label>
                <select
                  className={inputCls}
                  value=""
                  onChange={(e) => {
                    const c = e.target.value;
                    if (c && !colors.includes(c)) {
                      setColors((prev) => [...prev, c]);
                    }
                  }}
                >
                  <option value="">Add a color…</option>
                  {COLORS.filter((c) => !colors.includes(c)).map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
                {colors.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {colors.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() =>
                          setColors((prev) => prev.filter((x) => x !== c))
                        }
                        className="flex items-center gap-1 rounded-full bg-lavender/50 px-2.5 py-1 text-[12px]"
                      >
                        {c} <span className="text-ink/40">×</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <label className={labelCls}>Silhouette</label>
                <select
                  className={inputCls}
                  value={silhouette}
                  onChange={(e) => setSilhouette(e.target.value)}
                >
                  <option value="">Select</option>
                  {SILHOUETTES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className={labelCls}>Description</label>
              <textarea
                className={`${inputCls} min-h-16 resize-y`}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Strappy silk slip with cowl neck."
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Fabric</label>
                <input
                  className={inputCls}
                  value={fabric}
                  onChange={(e) => setFabric(e.target.value)}
                  placeholder="100% silk"
                />
              </div>
              <div>
                <label className={labelCls}>Fit notes</label>
                <input
                  className={inputCls}
                  value={fitNotes}
                  onChange={(e) => setFitNotes(e.target.value)}
                  placeholder="Runs small; true XS"
                />
              </div>
            </div>

            <button
              type="button"
              onClick={() => setNewWithTags((v) => !v)}
              className={`flex w-full items-center justify-between rounded-2xl border px-4 py-3 text-left transition-colors ${
                newWithTags
                  ? "border-sage-deep bg-sage/30"
                  : "border-ink/15 bg-white"
              }`}
            >
              <span>
                <span className="block text-[15px] font-medium">
                  New with tags
                </span>
                <span className="block text-[12px] text-ink/50">
                  Brand new — original retail tags still attached.
                </span>
              </span>
              <span
                className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
                  newWithTags ? "bg-sage-deep" : "bg-ink/20"
                }`}
              >
                <span
                  className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${
                    newWithTags ? "left-[22px]" : "left-0.5"
                  }`}
                />
              </span>
            </button>

            <div>
              <label className={labelCls}>Tier</label>
              <div className="flex flex-wrap gap-2">
                {TIERS.map((t) => (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => pickTier(t.value)}
                    className={`flex-1 whitespace-nowrap rounded-full border px-3 py-2 text-sm transition-colors ${
                      tier === t.value
                        ? "border-ink bg-ink text-cream"
                        : "border-ink/15 bg-white text-ink/70"
                    }`}
                  >
                    {t.label} ${t.price.toFixed(2)}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
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
                <label className={labelCls}>Acq. cost ($)</label>
                <input
                  type="number"
                  inputMode="decimal"
                  className={inputCls}
                  value={purchaseCost}
                  onChange={(e) => setPurchaseCost(e.target.value)}
                  placeholder="—"
                />
              </div>
              <div>
                <label className={labelCls}>Retail value ($)</label>
                <input
                  type="number"
                  inputMode="decimal"
                  className={inputCls}
                  value={retailValue}
                  onChange={(e) => setRetailValue(e.target.value)}
                  placeholder="—"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Acquisition date</label>
                <input
                  type="date"
                  className={inputCls}
                  value={acquisitionDate}
                  onChange={(e) => setAcquisitionDate(e.target.value)}
                />
              </div>
              <div>
                <label className={labelCls}>Source</label>
                <input
                  className={inputCls}
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                  placeholder="Boutique, donor, sample sale…"
                />
              </div>
            </div>

            <div>
              <label className={labelCls}>Sourced by (ambassador)</label>
              <select
                className={inputCls}
                value={ambassadorId}
                onChange={(e) =>
                  setAmbassadorId(e.target.value ? Number(e.target.value) : "")
                }
              >
                <option value="">— None —</option>
                {ambassadors.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className={labelCls}>Ownership</label>
              <div className="flex gap-2">
                {OWNERSHIPS.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => setOwnership(o.value)}
                    className={`flex-1 rounded-full border px-3 py-2 text-sm ${
                      ownership === o.value
                        ? "border-ink bg-ink text-cream"
                        : "border-ink/15 bg-white text-ink/70"
                    }`}
                  >
                    {o.label}
                  </button>
                ))}
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
                      type="email"
                      className={inputCls}
                      placeholder="Email (for portal login + payouts)"
                      value={ncEmail}
                      onChange={(e) => setNcEmail(e.target.value)}
                    />
                    <input
                      className={inputCls}
                      placeholder="Phone (for portal login)"
                      value={ncPhone}
                      onChange={(e) => setNcPhone(e.target.value)}
                    />
                    <input
                      className={inputCls}
                      placeholder="Venmo (for payouts) — @handle"
                      value={ncVenmo}
                      onChange={(e) => setNcVenmo(e.target.value)}
                    />
                    <input
                      className={inputCls}
                      placeholder="Backup payout if no Venmo (Zelle, PayPal…)"
                      value={ncBackup}
                      onChange={(e) => setNcBackup(e.target.value)}
                    />
                    <p className="text-[12px] text-ink/45">
                      Consignors log into the portal with their email + phone, so
                      both are required.
                    </p>
                    {ncError && (
                      <p className="text-[13px] text-blush-deep">{ncError}</p>
                    )}
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
                {!editing && (
                  <label className="mt-3 flex items-start gap-2 text-[13px] text-ink/70">
                    <input
                      type="checkbox"
                      checked={initialClean}
                      onChange={(e) => setInitialClean(e.target.checked)}
                      className="mt-0.5 h-4 w-4 accent-ink"
                    />
                    <span>
                      Initial clean before listing — consignor opted in (deducts
                      the cleaning fee from their earnings).
                    </span>
                  </label>
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

            <div className="grid grid-cols-2 gap-3">
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
              <div className={editing ? "" : "col-span-2"}>
                <label className={labelCls}>Current location</label>
                <input
                  className={inputCls}
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="Studio rack A, with customer, cleaner…"
                />
              </div>
            </div>

            <div>
              <label className={labelCls}>Condition / damage notes</label>
              <textarea
                className={`${inputCls} min-h-20 resize-y`}
                value={conditionNotes}
                onChange={(e) => setConditionNotes(e.target.value)}
                placeholder="Tiny pull near left strap, otherwise perfect."
              />
            </div>

            {editing && (
              <p className="text-xs text-ink/40">
                Rented {item!.rental_count}× · cleaned {item!.cleaning_count}× ·
                added {new Date(item!.created_at).toLocaleDateString()}
                {item!.retired_at
                  ? ` · retired ${new Date(item!.retired_at).toLocaleDateString()}`
                  : ""}
              </p>
            )}
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
    {scanOpen && (
      <CameraScanner
        onResult={(text) => {
          const code = text.trim();
          if (!code) return;
          setBarcode(code);
          beep(true);
          setScanOpen(false);
          barcodeRef.current?.focus();
        }}
        onClose={() => setScanOpen(false)}
      />
    )}
    {cropQueue.length > 0 && (
      <PhotoCropper
        key={`${cropQueue[0].name}-${cropQueue[0].size}-${cropQueue.length}`}
        file={cropQueue[0]}
        remaining={cropQueue.length}
        busy={uploading}
        onCropped={async (blob) => {
          await uploadBlob(blob);
          setCropQueue((q) => q.slice(1));
        }}
        onUseFull={async (file) => {
          await uploadBlob(file);
          setCropQueue((q) => q.slice(1));
        }}
        onCancel={() => setCropQueue([])}
      />
    )}
    </>
  );
}
