"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BrowserMultiFormatReader } from "@zxing/browser";
import { BarcodeFormat, DecodeHintType } from "@zxing/library";

// Container is aspect-[4/3]; a quarter-turn needs to scale up to keep covering.
const QUARTER_TURN_SCALE = 4 / 3;

// Our tags are Code 128. Pinning the decoder to just that format makes each
// scan far faster and more reliable (it isn't trying every barcode type), and
// TRY_HARDER lets it lock on from farther away / a sharper angle.
const HINTS = new Map<DecodeHintType, unknown>([
  [DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.CODE_128]],
  [DecodeHintType.TRY_HARDER, true],
]);

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
  const trackRef = useRef<MediaStreamTrack | null>(null);
  const onResultRef = useRef(onResult);
  const [error, setError] = useState("");
  // Focus-ring feedback shown where the user taps (n = increasing key to retrigger the animation).
  const [focusRing, setFocusRing] = useState<{ x: number; y: number; n: number } | null>(null);
  const focusKey = useRef(0);
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
    let timer: ReturnType<typeof setTimeout> | null = null;
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

    // Self-scheduling loop: decode one orientation per pass and immediately
    // queue the next, so we scan as fast as the device can decode instead of
    // waiting on a fixed timer. We alternate between the oriented frame and a
    // quarter turn so a horizontal/vertical mismatch still gets read, without
    // paying for two full decodes every pass.
    let turn = false;
    function loop() {
      if (cancelled || scanned) return;
      const deg = rotationRef.current + (turn ? 90 : 0);
      turn = !turn;
      if (drawFrame(deg)) {
        try {
          const result = reader.decodeFromCanvas(canvas);
          if (result) {
            scanned = true;
            onResultRef.current(result.getText());
            return;
          }
        } catch {
          // Not-found / checksum misses are expected mid-scan — keep going.
        }
      }
      timer = setTimeout(loop, 40);
    }

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: "environment" },
            // Higher resolution = more pixels on the bars, so it locks on from
            // farther away instead of needing the tag right up to the lens.
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        trackRef.current = stream.getVideoTracks()[0] ?? null;
        const v = videoRef.current;
        if (!v) return;
        v.srcObject = stream;
        v.onloadedmetadata = () => {
          autoOrient();
          v.play().catch(() => {});
        };
        await v.play().catch(() => {});
        loop();
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
      if (timer) clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [autoOrient]);

  // Tap the preview to refocus the camera on that spot. Focus control isn't
  // exposed on every device (notably some iPads), so this is best-effort — the
  // focus ring always animates so the tap feels responsive either way.
  function focusAt(e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const n = (focusKey.current += 1);
    setFocusRing({ x: px, y: py, n });
    window.setTimeout(() => {
      setFocusRing((cur) => (cur?.n === n ? null : cur));
    }, 700);

    const track = trackRef.current;
    const caps = (track?.getCapabilities?.() ?? {}) as {
      focusMode?: string[];
      pointsOfInterest?: unknown;
    };
    if (!track || !caps.focusMode?.length) return;
    const set: Record<string, unknown> = {};
    if (caps.focusMode.includes("single-shot")) set.focusMode = "single-shot";
    else if (caps.focusMode.includes("manual")) set.focusMode = "manual";
    else if (caps.focusMode.includes("continuous")) set.focusMode = "continuous";
    if ("pointsOfInterest" in caps) {
      set.pointsOfInterest = [
        {
          x: Math.min(1, Math.max(0, px / rect.width)),
          y: Math.min(1, Math.max(0, py / rect.height)),
        },
      ];
    }
    track
      .applyConstraints({ advanced: [set] as unknown as MediaTrackConstraintSet[] })
      .catch(() => {
        /* focus control unsupported here — visual ring already shown */
      });
  }

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
              Point the camera at the tag — it scans automatically. Tap the
              picture to focus; tap Rotate if it looks sideways.
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
          <div
            className="relative aspect-[4/3] cursor-pointer overflow-hidden rounded-2xl bg-ink/90"
            onClick={focusAt}
          >
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
            {/* Focus ring at the last tap point */}
            {focusRing && (
              <span
                key={focusRing.n}
                className="pointer-events-none absolute h-16 w-16 -translate-x-1/2 -translate-y-1/2 animate-ping rounded-full border-2 border-butter"
                style={{ left: focusRing.x, top: focusRing.y }}
              />
            )}
            {/* Rotate the preview (and the decoded frame) if it comes in sideways */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                setRotation((r) => (r + 90) % 360);
              }}
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
