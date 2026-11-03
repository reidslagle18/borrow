"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { upload } from "@vercel/blob/client";
import CameraScanner from "./CameraScanner";
import PhotoCropper from "./PhotoCropper";
import ConsignorAgreementModal from "./ConsignorAgreementModal";
import { beep } from "@/lib/scanSound";
import {
  Item,
  Consignor,
  Tier,
  Ownership,
  ItemStatus,
  Occasion,
  SIZES,
  EVENT_TYPES,
  STATUSES,
  OWNERSHIPS,
  SILHOUETTES,
  COLORS,
  replacementDefault,
  suggestedRentalPrice,
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
  const [name, setName] = useState(item?.name ?? "");
  const [brand, setBrand] = useState(item?.brand ?? "");
  // Description / fabric / fit notes are no longer entered at intake, but any
  // existing values are preserved untouched on save.
  const description = item?.description ?? "";
  const [size, setSize] = useState(item?.size ?? "");
  const [colors, setColors] = useState<string[]>(
    item?.color
      ? item.color.split(",").map((c) => c.trim()).filter(Boolean)
      : []
  );
  const fabric = item?.fabric ?? "";
  const fitNotes = item?.fit_notes ?? "";
  const [silhouettes, setSilhouettes] = useState<string[]>(
    item?.silhouette
      ? item.silhouette.split(",").map((s) => s.trim()).filter(Boolean)
      : []
  );
  const [styleTags, setStyleTags] = useState<string[]>(item?.style_tags ?? []);
  const [tagInput, setTagInput] = useState("");
  function addTag(raw: string) {
    const t = raw.trim().toLowerCase();
    if (t && !styleTags.includes(t)) setStyleTags((prev) => [...prev, t]);
    setTagInput("");
  }
  const [newWithTags, setNewWithTags] = useState(item?.new_with_tags ?? false);
  // Tier is retired from the UI but kept on the record for historical reference.
  // Existing pieces keep their stored tier; new pieces default to 'standard'
  // (unused for pricing — price now comes from retail value / manual entry).
  const tier: Tier = item?.tier ?? "standard";
  const [rentalPrice, setRentalPrice] = useState<string>(
    item?.rental_price != null ? String(item.rental_price) : ""
  );
  // The retail-based suggestion is dismissed once accepted or waved off, so it
  // stops nagging. Opening a piece never changes its price on its own.
  const [priceSuggestionDismissed, setPriceSuggestionDismissed] = useState(false);
  const [purchaseCost, setPurchaseCost] = useState<string>(
    item?.purchase_cost != null ? String(item.purchase_cost) : ""
  );
  const [retailValue, setRetailValue] = useState<string>(
    item?.retail_value != null ? String(item.retail_value) : ""
  );
  // Agreed replacement/loss value. Auto-follows the default (max of 70% retail,
  // acquisition cost) until hand-edited, after which it's frozen (manual).
  const [replacementValue, setReplacementValue] = useState<string>(
    item?.replacement_value != null ? String(item.replacement_value) : ""
  );
  const [replacementManual, setReplacementManual] = useState(
    item?.replacement_value_manual ?? false
  );
  const [acquisitionDate, setAcquisitionDate] = useState(
    item?.acquisition_date ?? ""
  );
  const [source, setSource] = useState(item?.source ?? "");
  // Matching-set linking.
  const [allItems, setAllItems] = useState<Item[]>([]);
  // Suggest previously-used style tags as you type, to keep tagging consistent.
  const tagSuggestions = useMemo(() => {
    const q = tagInput.trim().toLowerCase();
    const all = Array.from(
      new Set(allItems.flatMap((i) => i.style_tags ?? []))
    ).sort();
    const pool = all.filter((t) => !styleTags.includes(t));
    return (q ? pool.filter((t) => t.includes(q)) : pool).slice(0, 8);
  }, [allItems, tagInput, styleTags]);
  const [setPartnerId, setSetPartnerId] = useState<string>("");
  const [setUnlink, setSetUnlink] = useState(false);
  const [setQuery, setSetQuery] = useState("");
  const [setListOpen, setSetListOpen] = useState(false);
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
  // Occasion / sub-occasion tagging (config-driven; owner edits occasions in
  // Settings). occasionTags hold top-level names; subOccasionTags hold
  // namespaced "Occasion:Sub" values.
  const [occasions, setOccasions] = useState<Occasion[]>([]);
  const [occasionTags, setOccasionTags] = useState<string[]>(
    item?.occasion_tags ?? []
  );
  const [subOccasionTags, setSubOccasionTags] = useState<string[]>(
    item?.sub_occasion_tags ?? []
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
  // Consignor agreement signing + per-piece replacement-value confirmation.
  const [agreementOpen, setAgreementOpen] = useState(false);
  const [signedIds, setSignedIds] = useState<Set<number>>(new Set());

  // Keep replacement value following the default until it's hand-edited.
  const replDefault = replacementDefault(
    retailValue === "" ? 0 : Number(retailValue),
    purchaseCost === "" ? 0 : Number(purchaseCost)
  );
  useEffect(() => {
    if (!replacementManual) {
      setReplacementValue(replDefault > 0 ? String(replDefault) : "");
    }
  }, [replDefault, replacementManual]);

  // Focus the Barcode field as soon as the modal opens so a handheld scan
  // (keyboard wedge) lands straight in it — no need to tap the field first.
  useEffect(() => {
    const el = barcodeRef.current;
    if (el) {
      el.focus();
      el.select();
    }
  }, []);

  // Load the piece list so this one can be linked to its matching set-mate.
  useEffect(() => {
    (async () => {
      const res = await fetch("/api/items");
      if (res.ok) setAllItems(await res.json());
    })();
  }, []);

  // Load the owner-defined occasion → sub-occasion map for the tagging UI.
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/settings");
        if (!res.ok) return;
        const d = await res.json();
        if (Array.isArray(d?.program?.occasions)) setOccasions(d.program.occasions);
      } catch {
        /* non-fatal — occasion tagging just won't show */
      }
    })();
  }, []);

  const selectedConsignor =
    consignors.find((c) => c.id === consignorId) ?? null;

  // Matching set: current members (editing), the chosen partner, and search hits.
  const currentSetMembers = allItems.filter(
    (i) => !!item?.set_group && i.set_group === item.set_group && i.id !== item.id
  );
  const setPartner = allItems.find((i) => i.id === setPartnerId) ?? null;
  const setMatches = (() => {
    const q = setQuery.trim().toLowerCase();
    const base = allItems.filter(
      (i) => i.id !== item?.id && i.status !== "retired"
    );
    const hits = q
      ? base.filter(
          (i) =>
            (i.name || i.brand).toLowerCase().includes(q) ||
            (i.barcode || "").toLowerCase().includes(q)
        )
      : base;
    return hits.slice(0, 8);
  })();

  // Signed if the loaded record shows it, or they signed in this session.
  const consignorSigned =
    !!selectedConsignor?.agreement_signed_at ||
    (consignorId !== "" && signedIds.has(Number(consignorId)));

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
      name: name.trim(),
      brand: brand.trim(),
      description: description.trim(),
      size,
      color: colors.join(", "),
      fabric: fabric.trim(),
      fit_notes: fitNotes.trim(),
      silhouette: silhouettes.length ? silhouettes.join(", ") : null,
      style_tags: styleTags,
      new_with_tags: newWithTags,
      tier,
      rental_price: Number(rentalPrice),
      purchase_cost: purchaseCost === "" ? null : Number(purchaseCost),
      retail_value: retailValue === "" ? null : Number(retailValue),
      replacement_value: replacementValue === "" ? null : Number(replacementValue),
      replacement_value_manual: replacementManual,
      set_partner_id: setPartnerId || null,
      set_unlink: setUnlink,
      acquisition_date: acquisitionDate || null,
      source: source.trim(),
      initial_clean: !editing && ownership === "consignment" && initialClean,
      condition_notes: conditionNotes.trim(),
      ownership,
      consignor_id: consignorId === "" ? null : consignorId,
      event_types: eventTypes,
      occasion_tags: occasionTags,
      sub_occasion_tags: subOccasionTags,
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

  // Staff resolution of consignor approval (after an in-person dispute review).
  async function resolveApproval(
    action: "approve" | "accept_suggested" | "reject_suggested"
  ) {
    if (!editing) return;
    setSaving(true);
    setError("");
    const res = await fetch(`/api/items/${item!.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "approval", approval_action: action }),
    });
    if (res.ok) {
      const saved: Item = await res.json();
      saved.consignor_name = item!.consignor_name ?? null;
      onSaved(saved);
    } else {
      const d = await res.json().catch(() => ({}));
      setError(d.error || "Couldn't update approval.");
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

  // Toggle a top-level occasion. Un-selecting also drops all of its sub tags.
  function toggleOccasion(name: string) {
    setOccasionTags((prev) => {
      if (prev.includes(name)) {
        setSubOccasionTags((subs) => subs.filter((s) => !s.startsWith(`${name}:`)));
        return prev.filter((x) => x !== name);
      }
      return [...prev, name];
    });
  }

  // Toggle a sub-occasion ("Occasion:Sub"). Selecting a sub implies its occasion.
  function toggleSub(occasion: string, sub: string) {
    const tag = `${occasion}:${sub}`;
    setSubOccasionTags((prev) => {
      if (prev.includes(tag)) return prev.filter((x) => x !== tag);
      setOccasionTags((occ) => (occ.includes(occasion) ? occ : [...occ, occasion]));
      return [...prev, tag];
    });
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

            <div>
              <label className={labelCls}>Name</label>
              <input
                className={inputCls}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="The heading shown everywhere — e.g. The Cowl Slip"
              />
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
                <label className={labelCls}>Silhouette(s)</label>
                <select
                  className={inputCls}
                  value=""
                  onChange={(e) => {
                    const s = e.target.value;
                    if (s && !silhouettes.includes(s)) {
                      setSilhouettes((prev) => [...prev, s]);
                    }
                  }}
                >
                  <option value="">Add a silhouette…</option>
                  {SILHOUETTES.filter((s) => !silhouettes.includes(s)).map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
                {silhouettes.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {silhouettes.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() =>
                          setSilhouettes((prev) => prev.filter((x) => x !== s))
                        }
                        className="flex items-center gap-1 rounded-full bg-lavender/50 px-2.5 py-1 text-[12px]"
                      >
                        {s} <span className="text-ink/40">×</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <label className={labelCls}>Style tags</label>
                <p className="-mt-0.5 mb-1.5 text-[12px] text-ink/45">
                  Descriptive words shoppers might search — e.g. sparkly, sequin,
                  backless, flowy. Type and press Enter.
                </p>
                <input
                  className={inputCls}
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === ",") {
                      e.preventDefault();
                      addTag(tagInput);
                    } else if (e.key === "Backspace" && !tagInput && styleTags.length) {
                      setStyleTags((prev) => prev.slice(0, -1));
                    }
                  }}
                  placeholder="Add a tag…"
                />
                {tagSuggestions.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {tagSuggestions.map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => addTag(t)}
                        className="rounded-full border border-ink/15 bg-white px-2.5 py-1 text-[12px] text-ink/60 hover:border-ink/35"
                      >
                        + {t}
                      </button>
                    ))}
                  </div>
                )}
                {styleTags.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {styleTags.map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() =>
                          setStyleTags((prev) => prev.filter((x) => x !== t))
                        }
                        className="flex items-center gap-1 rounded-full bg-sage/40 px-2.5 py-1 text-[12px]"
                      >
                        {t} <span className="text-ink/40">×</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div>
              <label className={labelCls}>Matching set</label>
              {currentSetMembers.length > 0 && !setUnlink && (
                <div className="mb-2 flex flex-wrap items-center gap-1.5">
                  {currentSetMembers.map((m) => (
                    <span
                      key={m.id}
                      className="rounded-full bg-lavender/50 px-2.5 py-1 text-[12px]"
                    >
                      {m.name || m.brand}
                    </span>
                  ))}
                  <button
                    type="button"
                    onClick={() => setSetUnlink(true)}
                    className="text-[12px] text-ink/50 underline underline-offset-2"
                  >
                    Unlink this piece
                  </button>
                </div>
              )}
              {setUnlink && (
                <p className="mb-2 text-[12px] text-blush-deep">
                  This piece will be removed from its set on save.{" "}
                  <button
                    type="button"
                    onClick={() => setSetUnlink(false)}
                    className="underline underline-offset-2"
                  >
                    undo
                  </button>
                </p>
              )}
              {setPartner ? (
                <div className="flex items-center justify-between rounded-xl border border-ink/15 bg-white px-3.5 py-2.5">
                  <span className="truncate text-[15px]">
                    Pairs with: {setPartner.name || setPartner.brand}
                    <span className="text-ink/45"> · {setPartner.barcode}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setSetPartnerId("");
                      setSetQuery("");
                    }}
                    className="ml-2 shrink-0 rounded-full px-2 text-lg leading-none text-ink/40 hover:bg-ink/5"
                    aria-label="Clear matching piece"
                  >
                    ×
                  </button>
                </div>
              ) : (
                <div className="relative">
                  <input
                    className={inputCls}
                    placeholder="Search a piece it pairs with…"
                    value={setQuery}
                    onChange={(e) => {
                      setSetQuery(e.target.value);
                      setSetListOpen(true);
                    }}
                    onFocus={() => setSetListOpen(true)}
                    onBlur={() => setTimeout(() => setSetListOpen(false), 150)}
                  />
                  {setListOpen && setMatches.length > 0 && (
                    <div className="absolute z-10 mt-1.5 max-h-56 w-full overflow-y-auto rounded-xl border border-ink/10 bg-white shadow-lg">
                      {setMatches.map((m) => (
                        <button
                          key={m.id}
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => {
                            setSetPartnerId(m.id);
                            setSetUnlink(false);
                            setSetListOpen(false);
                          }}
                          className="block w-full px-3.5 py-2.5 text-left text-[15px] hover:bg-cream"
                        >
                          {m.name || m.brand}
                          <span className="text-ink/45">
                            {" "}
                            · {m.barcode} · {m.size}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              <p className="mt-1 text-[12px] text-ink/45">
                Link a top and skirt (or any pieces) so they cross-link as a
                matching set online.
              </p>
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
                  onChange={(e) => {
                    setRetailValue(e.target.value);
                    setPriceSuggestionDismissed(false); // re-offer for the new value
                  }}
                  placeholder="—"
                />
              </div>
            </div>

            {/* Retail-based price suggestion — never auto-applied; only fills the
                rental price when explicitly accepted. */}
            {(() => {
              const suggested = suggestedRentalPrice(
                retailValue === "" ? null : Number(retailValue)
              );
              if (
                suggested == null ||
                priceSuggestionDismissed ||
                Number(rentalPrice) === suggested
              ) {
                return null;
              }
              return (
                <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-sage/60 bg-sage/15 px-4 py-3 text-sm">
                  <span className="text-ink/70">
                    Suggested rental price{" "}
                    <span className="font-semibold text-ink">${suggested}</span>{" "}
                    <span className="text-ink/45">(retail ÷ 4)</span>
                  </span>
                  <span className="flex-1" />
                  <button
                    type="button"
                    onClick={() => {
                      setRentalPrice(String(suggested));
                      setPriceSuggestionDismissed(true);
                    }}
                    className="rounded-full bg-ink px-3.5 py-1.5 text-cream"
                  >
                    {item ? "Accept suggestion" : "Accept"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setPriceSuggestionDismissed(true)}
                    className="rounded-full border border-ink/20 px-3.5 py-1.5 text-ink/60"
                  >
                    {item ? "Keep current price" : "Enter manually"}
                  </button>
                </div>
              );
            })()}

            <div>
              <label className={labelCls}>
                Replacement value ($)
                {!replacementManual && (
                  <span className="ml-1 normal-case tracking-normal text-ink/35">· auto</span>
                )}
              </label>
              <input
                type="number"
                inputMode="decimal"
                className={inputCls}
                value={replacementValue}
                onChange={(e) => {
                  setReplacementValue(e.target.value);
                  setReplacementManual(true);
                }}
                placeholder="—"
              />
              <p className="mt-1 text-[12px] text-ink/45">
                {replacementManual ? (
                  <>
                    Manually set — charged if the piece is lost or damaged beyond
                    repair.{" "}
                    <button
                      type="button"
                      onClick={() => setReplacementManual(false)}
                      className="underline underline-offset-2"
                    >
                      use auto
                    </button>
                  </>
                ) : (
                  "Auto: greater of 70% of retail or acquisition cost. Charged if the piece is lost or damaged beyond repair."
                )}
              </p>
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
                {selectedConsignor && (
                  <div className="mt-3 space-y-2">
                    {/* Signed-agreement status (required before the piece goes live) */}
                    {consignorSigned ? (
                      <p className="rounded-xl bg-sage/40 px-3.5 py-2.5 text-[13px] text-ink/70">
                        Consignor Agreement signed.
                      </p>
                    ) : (
                      <div className="flex items-center justify-between gap-3 rounded-xl bg-butter/60 px-3.5 py-2.5">
                        <p className="text-[13px] text-ink/70">
                          Not signed yet. Required before this piece can go live.
                        </p>
                        <button
                          type="button"
                          onClick={() => setAgreementOpen(true)}
                          className="shrink-0 rounded-full bg-ink px-4 py-1.5 text-sm text-cream"
                        >
                          Sign agreement
                        </button>
                      </div>
                    )}
                    {/* Consignor approval of the replacement value */}
                    {!editing ? (
                      <p className="rounded-xl bg-butter/60 px-3.5 py-2.5 text-[13px] text-ink/70">
                        After you save, this piece is sent to the consignor to
                        approve its replacement value
                        {replacementValue !== "" ? ` of $${replacementValue}` : ""}.
                        It won&apos;t go live until they approve it in their hub.
                      </p>
                    ) : item?.approval_status === "approved" ? (
                      <p className="rounded-xl bg-sage/40 px-3.5 py-2.5 text-[13px] text-ink/70">
                        Consignor approved the replacement value
                        {item?.approved_at
                          ? ` on ${new Date(item.approved_at).toLocaleDateString()}`
                          : ""}
                        .
                      </p>
                    ) : item?.approval_status === "disputed" ? (
                      <div className="rounded-xl bg-blush/40 px-3.5 py-2.5 text-[13px] text-ink/80">
                        <p className="font-medium">
                          Disputed — consignor suggests $
                          {Number(item?.disputed_value ?? 0)}
                        </p>
                        <p className="mt-1">
                          Your value ${Number(item?.replacement_value ?? 0)} ·
                          their suggestion ${Number(item?.disputed_value ?? 0)}
                        </p>
                        {item?.dispute_note && (
                          <p className="mt-1 italic">“{item.dispute_note}”</p>
                        )}
                      </div>
                    ) : (
                      <>
                        <p className="rounded-xl bg-butter/60 px-3.5 py-2.5 text-[13px] text-ink/70">
                          Pending consignor approval. Keep refining the value if
                          you like; it won&apos;t go live until the consignor
                          approves it.
                        </p>
                        {item?.dispute_outcome === "accepted" && (
                          <p className="text-[12px] text-ink/45">
                            You accepted their suggested value; awaiting their
                            final sign-off.
                          </p>
                        )}
                        {item?.dispute_outcome === "rejected" && (
                          <p className="text-[12px] text-ink/45">
                            You kept your value; awaiting their sign-off.
                          </p>
                        )}
                      </>
                    )}
                    {editing && item?.approval_status === "disputed" && (
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => resolveApproval("accept_suggested")}
                          disabled={saving}
                          className="rounded-full bg-ink px-4 py-1.5 text-sm text-cream disabled:opacity-40"
                        >
                          Approve their ${Number(item?.disputed_value ?? 0)} value
                        </button>
                        <button
                          type="button"
                          onClick={() => resolveApproval("reject_suggested")}
                          disabled={saving}
                          className="rounded-full border border-ink/15 px-4 py-1.5 text-sm text-ink/60 disabled:opacity-40"
                        >
                          Reject, keep ${Number(item?.replacement_value ?? 0)}
                        </button>
                      </div>
                    )}
                    {editing && item?.approval_status === "pending" && (
                      <button
                        type="button"
                        onClick={() => resolveApproval("approve")}
                        disabled={saving}
                        className="rounded-full bg-ink px-4 py-1.5 text-sm text-cream disabled:opacity-40"
                      >
                        Approve (in person)
                      </button>
                    )}
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

            {occasions.length > 0 && (
              <div>
                <label className={labelCls}>Occasions</label>
                <p className="-mt-0.5 mb-1.5 text-[12px] text-ink/45">
                  Powers the shop&apos;s &ldquo;Shop by Occasion&rdquo; pills. Pick a
                  sub-option and its occasion is added too. Edit the list in Settings.
                </p>
                <div className="space-y-2.5">
                  {occasions.map((o) => {
                    const on = occasionTags.includes(o.name);
                    return (
                      <div key={o.name} className="rounded-2xl border border-ink/10 bg-white p-2.5">
                        <button
                          type="button"
                          onClick={() => toggleOccasion(o.name)}
                          className={`rounded-full border px-3 py-1.5 text-sm ${
                            on
                              ? "border-ink bg-ink text-cream"
                              : "border-ink/15 bg-white text-ink/60"
                          }`}
                        >
                          {o.name}
                        </button>
                        {o.subs.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {o.subs.map((s) => {
                              const subOn = subOccasionTags.includes(`${o.name}:${s}`);
                              return (
                                <button
                                  key={s}
                                  type="button"
                                  onClick={() => toggleSub(o.name, s)}
                                  className={`rounded-full border px-3 py-1 text-[13px] ${
                                    subOn
                                      ? "border-blush-deep bg-blush text-ink"
                                      : "border-ink/15 bg-white text-ink/50"
                                  }`}
                                >
                                  {s}
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

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
    {agreementOpen && consignorId !== "" && (
      <ConsignorAgreementModal
        consignorId={Number(consignorId)}
        consignorName={selectedConsignor?.name ?? ""}
        onClose={() => setAgreementOpen(false)}
        onSigned={(updated) => {
          setSignedIds((prev) => new Set(prev).add(updated.id));
          setAgreementOpen(false);
        }}
      />
    )}
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
