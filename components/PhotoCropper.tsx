"use client";

import { useEffect, useMemo, useState } from "react";
import Cropper, { Area } from "react-easy-crop";

/** Crop a freshly-selected photo to the 3:4 card shape before upload. */
async function getCroppedBlob(src: string, area: Area): Promise<Blob> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = reject;
    i.src = src;
  });
  const maxDim = 1600;
  const scale = Math.min(1, maxDim / Math.max(area.width, area.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(area.width * scale);
  canvas.height = Math.round(area.height * scale);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(
    img,
    area.x,
    area.y,
    area.width,
    area.height,
    0,
    0,
    canvas.width,
    canvas.height
  );
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("crop failed"))),
      "image/jpeg",
      0.85
    )
  );
}

export default function PhotoCropper({
  file,
  remaining,
  busy,
  onCropped,
  onUseFull,
  onCancel,
}: {
  file: File;
  remaining: number;
  busy: boolean;
  onCropped: (blob: Blob) => void;
  onUseFull: (file: File) => void;
  onCancel: () => void;
}) {
  const src = useMemo(() => URL.createObjectURL(file), [file]);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [area, setArea] = useState<Area | null>(null);
  const [working, setWorking] = useState(false);

  // The parent remounts this per file (via key), so state starts fresh each time.
  useEffect(() => () => URL.revokeObjectURL(src), [src]);

  async function confirm() {
    if (!area) return;
    setWorking(true);
    const blob = await getCroppedBlob(src, area);
    onCropped(blob);
    setWorking(false);
  }

  const disabled = busy || working;

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-ink/60 sm:items-center sm:p-6">
      <div className="w-full max-w-lg overflow-hidden rounded-t-3xl bg-cream p-6 sm:rounded-3xl">
        <div className="mb-3 flex items-start justify-between">
          <div>
            <h2 className="text-2xl font-medium">Crop photo</h2>
            <p className="mt-1 text-sm text-ink/50">
              Drag to position, pinch/slider to zoom.
              {remaining > 1 ? ` ${remaining - 1} more after this.` : ""}
            </p>
          </div>
          <button
            onClick={onCancel}
            className="rounded-full px-3 py-1 text-2xl leading-none text-ink/40 hover:bg-ink/5"
            aria-label="Cancel"
          >
            ×
          </button>
        </div>

        <div className="relative aspect-[3/4] w-full overflow-hidden rounded-2xl bg-ink/90">
          <Cropper
            image={src}
            crop={crop}
            zoom={zoom}
            aspect={3 / 4}
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onCropComplete={(_, areaPixels) => setArea(areaPixels)}
          />
        </div>

        <input
          type="range"
          min={1}
          max={3}
          step={0.01}
          value={zoom}
          onChange={(e) => setZoom(Number(e.target.value))}
          className="mt-4 w-full accent-ink"
          aria-label="Zoom"
        />

        <div className="mt-4 flex items-center gap-2">
          <button
            onClick={confirm}
            disabled={disabled || !area}
            className="flex-1 rounded-full bg-ink px-6 py-3 text-[15px] text-cream transition-opacity disabled:opacity-40"
          >
            {disabled ? "Adding…" : "Crop & add"}
          </button>
          <button
            onClick={() => onUseFull(file)}
            disabled={disabled}
            className="rounded-full border border-ink/15 px-5 py-3 text-[15px] text-ink/60 disabled:opacity-40"
          >
            Use full photo
          </button>
        </div>
      </div>
    </div>
  );
}
