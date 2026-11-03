"use client";

import { useEffect, useRef, useState } from "react";
import { upload } from "@vercel/blob/client";
import AppShell from "@/components/AppShell";

type Slide = { src: string; posX: number; posY: number; zoom: number };

// The shop serves the shipped photos ("/store/...") from its own origin, so the
// studio previews them by their absolute shop URL. Uploaded photos are already
// absolute blob URLs and load as-is.
const SHOP_ORIGIN = "https://borrowfayetteville.com";
const displayUrl = (src: string) => (src.startsWith("/") ? SHOP_ORIGIN + src : src);

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Downscale a photo client-side before uploading (hero shots stay large). */
async function resizeImage(file: Blob, maxDim = 3600): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = url;
    });
    const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
    if (scale === 1 && file.size < 3 * 1024 * 1024) return file;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("resize failed"))), "image/jpeg", 0.9)
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

export default function HeroEditorPage() {
  const [config, setConfig] = useState<Slide[]>([]);
  const [library, setLibrary] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  // Shop-by-Category / Shop-by-Occasion tile photos (label → src).
  const [categoryTiles, setCategoryTiles] = useState<Record<string, string>>({});
  const [occasionTiles, setOccasionTiles] = useState<Record<string, string>>({});
  const [categoryLabels, setCategoryLabels] = useState<string[]>([]);
  const [occasionLabels, setOccasionLabels] = useState<string[]>([]);
  const [tileUploading, setTileUploading] = useState<string | null>(null);
  const drag = useRef<null | { i: number; sx: number; sy: number; px: number; py: number; w: number; h: number }>(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/hero");
        const d = await r.json();
        setConfig(Array.isArray(d.config) ? d.config : []);
        setLibrary(Array.isArray(d.library) ? d.library : []);
        setCategoryTiles(d.category_tiles && typeof d.category_tiles === "object" ? d.category_tiles : {});
        setOccasionTiles(d.occasion_tiles && typeof d.occasion_tiles === "object" ? d.occasion_tiles : {});
        setCategoryLabels(Array.isArray(d.category_labels) ? d.category_labels : []);
        setOccasionLabels(Array.isArray(d.occasion_labels) ? d.occasion_labels : []);
      } catch {
        setError("Couldn't load your hero photos — refresh and try again.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const dirty = () => setSaved(false);
  function patch(i: number, p: Partial<Slide>) {
    setConfig((c) => c.map((s, j) => (j === i ? { ...s, ...p } : s)));
    dirty();
  }
  function move(i: number, dir: -1 | 1) {
    setConfig((c) => {
      const j = i + dir;
      if (j < 0 || j >= c.length) return c;
      const n = [...c];
      [n[i], n[j]] = [n[j], n[i]];
      return n;
    });
    dirty();
  }
  function remove(i: number) {
    setConfig((c) => c.filter((_, j) => j !== i));
    dirty();
  }
  function addSlide(src: string) {
    setConfig((c) => [...c, { src, posX: 50, posY: 50, zoom: 1 }]);
    dirty();
  }

  // Grab-to-pan: dragging the photo moves the crop (down reveals the top, etc.).
  function onDown(e: React.PointerEvent, i: number) {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    drag.current = { i, sx: e.clientX, sy: e.clientY, px: config[i].posX, py: config[i].posY, w: r.width, h: r.height };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onMove(e: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    const nx = clamp(d.px - ((e.clientX - d.sx) / d.w) * 100, 0, 100);
    const ny = clamp(d.py - ((e.clientY - d.sy) / d.h) * 100, 0, 100);
    patch(d.i, { posX: Math.round(nx), posY: Math.round(ny) });
  }
  function onUp() {
    drag.current = null;
  }

  async function onUpload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    setError("");
    try {
      for (const file of Array.from(files)) {
        const resized = await resizeImage(file);
        const up = await upload(
          `hero/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`,
          resized,
          { access: "public", handleUploadUrl: "/api/upload", contentType: "image/jpeg" }
        );
        setLibrary((l) => (l.includes(up.url) ? l : [...l, up.url]));
        addSlide(up.url);
      }
    } catch {
      setError("Photo upload failed — try again.");
    } finally {
      setUploading(false);
    }
  }

  // Assign/clear a tile's photo (kind = "category" | "occasion").
  function setTile(kind: "category" | "occasion", label: string, src: string) {
    const setter = kind === "category" ? setCategoryTiles : setOccasionTiles;
    setter((m) => {
      const n = { ...m };
      if (src) n[label] = src;
      else delete n[label];
      return n;
    });
    dirty();
  }
  async function uploadTile(kind: "category" | "occasion", label: string, files: FileList | null) {
    if (!files || files.length === 0) return;
    setTileUploading(`${kind}:${label}`);
    setError("");
    try {
      const resized = await resizeImage(files[0]);
      const up = await upload(
        `tiles/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`,
        resized,
        { access: "public", handleUploadUrl: "/api/upload", contentType: "image/jpeg" }
      );
      setLibrary((l) => (l.includes(up.url) ? l : [...l, up.url]));
      setTile(kind, label, up.url);
    } catch {
      setError("Photo upload failed — try again.");
    } finally {
      setTileUploading(null);
    }
  }

  async function save() {
    setSaving(true);
    setError("");
    try {
      const r = await fetch("/api/hero", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config, library, category_tiles: categoryTiles, occasion_tiles: occasionTiles }),
      });
      if (!r.ok) throw new Error();
      const d = await r.json();
      if (Array.isArray(d.library)) setLibrary(d.library);
      if (d.category_tiles && typeof d.category_tiles === "object") setCategoryTiles(d.category_tiles);
      if (d.occasion_tiles && typeof d.occasion_tiles === "object") setOccasionTiles(d.occasion_tiles);
      setSaved(true);
    } catch {
      setError("Couldn't save — try again.");
    } finally {
      setSaving(false);
    }
  }

  const unused = library.filter((src) => !config.some((s) => s.src === src));
  const basename = (u: string) => {
    const s = u.split("?")[0].split("/").pop() || u;
    return s.length > 26 ? "…" + s.slice(-24) : s;
  };
  const tileGroups = [
    { kind: "category" as const, title: "Shop by Category tiles", labels: categoryLabels, tiles: categoryTiles },
    { kind: "occasion" as const, title: "Shop by Occasion tiles", labels: occasionLabels, tiles: occasionTiles },
  ];

  return (
    <AppShell>
      <div className="mx-auto max-w-3xl px-5 py-8 md:px-10 md:py-12">
        <h1 className="font-serif text-4xl font-medium md:text-5xl">Hero photos</h1>
        <p className="mt-1.5 max-w-xl text-sm text-ink/50">
          These are the photos that rotate at the very top of your shop homepage.
          Drag a photo to reposition its crop, zoom in, reorder, add or remove —
          then Save. The frame below is the shape shoppers see.
        </p>

        {loading ? (
          <p className="mt-8 text-sm text-ink/40">Loading…</p>
        ) : (
          <>
            {/* Slides */}
            <div className="mt-6 space-y-5">
              {config.length === 0 && (
                <p className="rounded-2xl bg-butter/40 px-4 py-3 text-[13px] text-ink/70">
                  No photos up top right now — add one from your library below.
                </p>
              )}
              {config.map((s, i) => (
                <div key={`${s.src}-${i}`} className="rounded-3xl border border-ink/10 bg-white p-3 md:p-4">
                  {/* Crop frame (drag to pan) */}
                  <div
                    onPointerDown={(e) => onDown(e, i)}
                    onPointerMove={onMove}
                    onPointerUp={onUp}
                    onPointerCancel={onUp}
                    className="relative w-full cursor-grab touch-none select-none overflow-hidden rounded-2xl bg-ink/5 active:cursor-grabbing"
                    style={{ aspectRatio: "16 / 7" }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={displayUrl(s.src)}
                      alt=""
                      draggable={false}
                      className="pointer-events-none absolute inset-0 h-full w-full select-none object-cover"
                      style={{
                        objectPosition: `${s.posX}% ${s.posY}%`,
                        transform: s.zoom !== 1 ? `scale(${s.zoom})` : undefined,
                        transformOrigin: `${s.posX}% ${s.posY}%`,
                      }}
                    />
                    <span className="pointer-events-none absolute left-2 top-2 rounded-full bg-ink/55 px-2 py-0.5 text-[11px] text-cream">
                      {i + 1} · drag to reposition
                    </span>
                  </div>

                  {/* Controls */}
                  <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                    <label className="flex flex-1 items-center gap-2 text-[13px] text-ink/60">
                      Zoom
                      <input
                        type="range"
                        min={1}
                        max={2.5}
                        step={0.05}
                        value={s.zoom}
                        onChange={(e) => patch(i, { zoom: Number(e.target.value) })}
                        className="h-1 flex-1 accent-ink"
                      />
                      <span className="w-9 tabular-nums text-ink/45">{s.zoom.toFixed(2)}×</span>
                    </label>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => patch(i, { posX: 50, posY: 50, zoom: 1 })}
                        className="rounded-full px-3 py-1.5 text-[13px] text-ink/60 hover:bg-cream"
                      >
                        Reset
                      </button>
                      <button
                        onClick={() => move(i, -1)}
                        disabled={i === 0}
                        aria-label="Move up"
                        className="rounded-full px-2.5 py-1.5 text-ink/60 hover:bg-cream disabled:opacity-30"
                      >
                        ↑
                      </button>
                      <button
                        onClick={() => move(i, 1)}
                        disabled={i === config.length - 1}
                        aria-label="Move down"
                        className="rounded-full px-2.5 py-1.5 text-ink/60 hover:bg-cream disabled:opacity-30"
                      >
                        ↓
                      </button>
                      <button
                        onClick={() => remove(i)}
                        className="rounded-full px-3 py-1.5 text-[13px] text-blush-deep hover:bg-blush/20"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Add from library + upload */}
            <div className="mt-8">
              <div className="flex items-center justify-between">
                <h2 className="font-serif text-2xl font-medium">Add a photo</h2>
                <label className="cursor-pointer rounded-full bg-ink px-4 py-2 text-[14px] text-cream hover:opacity-90">
                  {uploading ? "Uploading…" : "Upload new"}
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    disabled={uploading}
                    onChange={(e) => onUpload(e.target.files)}
                  />
                </label>
              </div>
              <p className="mt-1 text-[13px] text-ink/45">
                Tap any photo to add it up top. Uploads are added automatically.
              </p>
              {unused.length > 0 ? (
                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {unused.map((src) => (
                    <button
                      key={src}
                      onClick={() => addSlide(src)}
                      className="group relative overflow-hidden rounded-xl bg-ink/5"
                      style={{ aspectRatio: "4 / 3" }}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={displayUrl(src)}
                        alt=""
                        className="absolute inset-0 h-full w-full object-cover transition group-hover:opacity-80"
                      />
                      <span className="absolute inset-0 flex items-center justify-center bg-ink/0 text-2xl text-cream opacity-0 transition group-hover:bg-ink/25 group-hover:opacity-100">
                        +
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="mt-3 text-[13px] text-ink/40">Every photo in your library is already up top.</p>
              )}
            </div>

            {/* Shop-by tile photos — a photo per homepage category/occasion tile */}
            {tileGroups.map((group) => (
              <div key={group.kind} className="mt-10">
                <h2 className="font-serif text-2xl font-medium">{group.title}</h2>
                <p className="mt-1 text-[13px] text-ink/45">
                  Set a photo for each tile on your homepage. No photo = the colored
                  block. Pick from your library or upload a new one.
                </p>
                <div className="mt-3 space-y-2.5">
                  {group.labels.map((label) => {
                    const src = group.tiles[label] || "";
                    return (
                      <div key={label} className="flex items-center gap-3 rounded-2xl border border-ink/10 bg-white p-2.5">
                        <div className="relative h-16 w-14 shrink-0 overflow-hidden rounded-lg bg-ink/5">
                          {src ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={displayUrl(src)} alt="" className="h-full w-full object-cover" />
                          ) : (
                            <span className="flex h-full w-full items-center justify-center text-[10px] text-ink/30">none</span>
                          )}
                        </div>
                        <span className="w-28 shrink-0 text-[15px] font-medium">{label}</span>
                        <select
                          value={src}
                          onChange={(e) => setTile(group.kind, label, e.target.value)}
                          className="min-w-0 flex-1 rounded-xl border border-ink/15 bg-white px-3 py-2 text-[13px] outline-none"
                        >
                          <option value="">No photo (colored block)</option>
                          {library.map((l) => (
                            <option key={l} value={l}>
                              {basename(l)}
                            </option>
                          ))}
                        </select>
                        <label className="cursor-pointer rounded-full border border-ink/15 px-3 py-2 text-[13px] text-ink/70 hover:border-ink/35">
                          {tileUploading === `${group.kind}:${label}` ? "…" : "Upload"}
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            disabled={tileUploading !== null}
                            onChange={(e) => uploadTile(group.kind, label, e.target.files)}
                          />
                        </label>
                        {src && (
                          <button
                            onClick={() => setTile(group.kind, label, "")}
                            className="shrink-0 text-[13px] text-ink/40 hover:text-blush-deep"
                          >
                            clear
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}

            {error && <p className="mt-5 text-sm text-blush-deep">{error}</p>}
          </>
        )}
      </div>

      {/* Sticky save bar */}
      {!loading && (
        <div className="sticky bottom-0 z-20 border-t border-ink/10 bg-cream/95 backdrop-blur">
          <div className="mx-auto flex max-w-3xl items-center justify-between px-5 py-3 md:px-10">
            <span className="text-[13px] text-ink/50">
              {saved ? "Saved — live on your shop." : `${config.length} photo${config.length === 1 ? "" : "s"} up top`}
            </span>
            <button
              onClick={save}
              disabled={saving}
              className="rounded-full bg-ink px-6 py-2.5 text-[15px] font-medium text-cream disabled:opacity-40"
            >
              {saving ? "Saving…" : "Save changes"}
            </button>
          </div>
        </div>
      )}
    </AppShell>
  );
}
