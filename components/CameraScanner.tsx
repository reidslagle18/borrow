"use client";

import { useEffect, useRef, useState } from "react";
import { BrowserMultiFormatReader, IScannerControls } from "@zxing/browser";
import { DecodeHintType, BarcodeFormat } from "@zxing/library";

// Our labels are Code 128. Pinning the decoder to it makes 1D scanning on the
// iPad camera noticeably faster and more reliable than trying every format.
const SCAN_HINTS = new Map([
  [DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.CODE_128]],
]);

/**
 * Rear-camera barcode scanner modal. Streams the iPad camera into a <video>
 * and decodes continuously with ZXing (iPad Safari has no native
 * BarcodeDetector). Calls onResult for each decoded code; the parent decides
 * what to do and may keep the scanner open to retry unknown codes.
 */
export default function CameraScanner({
  onResult,
  onClose,
}: {
  onResult: (text: string) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const onResultRef = useRef(onResult);
  const [error, setError] = useState("");

  useEffect(() => {
    onResultRef.current = onResult;
  }, [onResult]);

  useEffect(() => {
    let cancelled = false;
    const reader = new BrowserMultiFormatReader(SCAN_HINTS);

    (async () => {
      try {
        const controls = await reader.decodeFromConstraints(
          { video: { facingMode: { ideal: "environment" } } },
          videoRef.current!,
          (result) => {
            if (result) onResultRef.current(result.getText());
          }
        );
        if (cancelled) {
          controls.stop();
          return;
        }
        controlsRef.current = controls;
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
      controlsRef.current?.stop();
    };
  }, []);

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
              Point the camera at the tag — it scans automatically.
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
              className="h-full w-full object-cover"
              playsInline
              muted
            />
            {/* Reticle */}
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="h-1/3 w-2/3 rounded-xl border-2 border-cream/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.25)]" />
            </div>
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
