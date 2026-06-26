"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BrowserMultiFormatReader } from "@zxing/browser";
import { DecodeHintType } from "@zxing/library";

// Container is aspect-[4/3]; a quarter-turn needs to scale up to keep covering.
const QUARTER_TURN_SCALE = 4 / 3;

// TRY_HARDER + no format restriction → ZXing decodes any barcode it supports,
// scanning a little more thoroughly per frame.
const HINTS = new Map<DecodeHintType, unknown>([[DecodeHintType.TRY_HARDER, true]]);

/**
 * Rear-camera barcode scanner modal. Streams the iPad camera into a <video>
 * and decodes on a timer from a canvas we control.
 *
 * The important bit: iPad camera frames often arrive rotated, and ZXing's 1D
 * reader only scans horizontal lines — so a sideways feed makes a barcode
 * vertical and unreadable. We draw each frame into a canvas turned upright
 * (matching the preview), and if that misses we also try a quarter turn, so it
 * reads no matter how the iPad is held. Calls onResult with the decoded text.
 */
export default function CameraScanner({
  onResult,
  onClose,
}: {
  onResult: (text: string) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const onResultRef = useRef(onResult);
  const [error, setError] = useState("");
  // Quarter-turns applied to the preview AND to the frame we decode, so what
  // staff see upright is what ZXing reads. Auto-set from the device
  // orientation; the Rotate button lets staff nudge it if it's off.
  const [rotation, setRotation] = useState(0);
  const rotationRef = useRef(0);

  useEffect(() => {
    onResultRef.current = onResult;
  }, [onResult]);
  useEffect(() => {
    rotationRef.current = rotation;
  }, [rotation]);

  // Match the preview to how the iPad is held: if the camera feed and the
  // viewport disagree on landscape-vs-portrait, turn it a quarter turn.
  const autoOrient = useCallback(() => {
    const v = videoRef.current;
    if (!v || !v.videoWidth || !v.videoHeight) return;
    const feedLandscape = v.videoWidth >= v.videoHeight;
    const viewportLandscape = window.innerWidth >= window.innerHeight;
    setRotation(feedLandscape === viewportLandscape ? 0 : 90);
  }, []);

  useEffect(() => {
    window.addEventListener("resize", autoOrient);
    window.addEventListener("orientationchange", autoOrient);
    return () => {
      window.removeEventListener("resize", autoOrient);
      window.removeEventListener("orientationchange", autoOrient);
    };
  }, [autoOrient]);

  useEffect(() => {
    let cancelled = false;
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    let scanned = false;
    const reader = new BrowserMultiFormatReader(HINTS);
    const canvas = document.createElement("canvas");
    canvasRef.current = canvas;

    // Draw the current video frame into the canvas, turned by `deg` so the
    // barcode ends up horizontal for the decoder.
    function drawFrame(deg: number): boolean {
      const v = videoRef.current;
      const ctx = canvas.getContext("2d");
      if (!v || !ctx || !v.videoWidth) return false;
      const vw = v.videoWidth;
      const vh = v.videoHeight;
      const d = ((deg % 360) + 360) % 360;
      if (d === 90 || d === 270) {
        canvas.width = vh;
        canvas.height = vw;
      } else {
        canvas.width = vw;
        canvas.height = vh;
      }
      ctx.save();
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate((d * Math.PI) / 180);
      ctx.drawImage(v, -vw / 2, -vh / 2);
      ctx.restore();
      return true;
    }

    function tick() {
      if (scanned) return;
      const base = rotationRef.current;
      // Try the oriented frame first, then a quarter turn as a fallback so a
      // horizontal- vs vertical-barcode mismatch still gets read.
      for (const extra of [0, 90]) {
        if (!drawFrame(base + extra)) return;
        try {
          const result = reader.decodeFromCanvas(canvas);
          if (result) {
            scanned = true;
            onResultRef.current(result.getText());
            return;
          }
        } catch {
          // Not-found / checksum / format misses are expected mid-scan — the
          // next tick (or the quarter-turn fallback) tries again.
        }
      }
    }

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        const v = videoRef.current;
        if (!v) return;
        v.srcObject = stream;
        v.onloadedmetadata = () => {
          autoOrient();
          v.play().catch(() => {});
        };
        await v.play().catch(() => {});
        timer = setInterval(tick, 150);
      } catch (err) {
        if (cancelled) return;
        const name = (err as { name?: string }).name;
        if (name === "NotAllowedError") {
          setError(
            "Camera access was blocked. Allow camera access in Safari settings, then try again."
          );
        } else if (name === "NotFoundError") {
          setError("No camera found on this device.");
        } else {
          setError("Couldn't start the camera — try again.");
        }
      }
    })();

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [autoOrient]);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-ink/60 sm:items-center sm:p-6"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-t-3xl bg-cream p-6 sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-2xl font-medium">Scan a barcode</h2>
            <p className="mt-1 text-sm text-ink/50">
              Point the camera at the tag — it scans automatically. Tap Rotate if
              the picture looks sideways.
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-full px-3 py-1 text-2xl leading-none text-ink/40 hover:bg-ink/5"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {error ? (
          <p className="rounded-2xl bg-blush/30 px-4 py-6 text-center text-[15px] text-ink/70">
            {error}
          </p>
        ) : (
          <div className="relative aspect-[4/3] overflow-hidden rounded-2xl bg-ink/90">
            <video
              ref={videoRef}
              className="h-full w-full object-cover transition-transform duration-200"
              style={{
                transform: `rotate(${rotation}deg)${
                  rotation % 180 !== 0 ? ` scale(${QUARTER_TURN_SCALE})` : ""
                }`,
              }}
              playsInline
              muted
            />
            {/* Reticle */}
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="h-1/3 w-2/3 rounded-xl border-2 border-cream/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.25)]" />
            </div>
            {/* Rotate the preview (and the decoded frame) if it comes in sideways */}
            <button
              onClick={() => setRotation((r) => (r + 90) % 360)}
              className="absolute bottom-3 right-3 flex items-center gap-1.5 rounded-full bg-ink/70 px-3 py-1.5 text-[13px] text-cream backdrop-blur"
              aria-label="Rotate camera view"
            >
              <span className="text-base leading-none">↻</span> Rotate
            </button>
          </div>
        )}

        <button
          onClick={onClose}
          className="mt-5 w-full rounded-full border border-ink/15 py-3 text-[15px] text-ink/60"
        >
          Done
        </button>
      </div>
    </div>
  );
}
