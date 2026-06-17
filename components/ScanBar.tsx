"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import CameraScanner from "./CameraScanner";

type Flash = "success" | "error" | null;

/** Short WebAudio blip — created lazily so it works after a user gesture. */
function useBeep() {
  const ctxRef = useRef<AudioContext | null>(null);
  return useCallback((ok: boolean) => {
    try {
      if (!ctxRef.current) {
        const Ctor =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext })
            .webkitAudioContext;
        ctxRef.current = new Ctor();
      }
      const ctx = ctxRef.current;
      if (ctx.state === "suspended") void ctx.resume();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = ok ? "sine" : "square";
      osc.frequency.value = ok ? 880 : 220;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 0.01);
      gain.gain.exponentialRampToValueAtTime(
        0.0001,
        ctx.currentTime + (ok ? 0.16 : 0.32)
      );
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + (ok ? 0.18 : 0.34));
    } catch {
      /* audio not available — fail silently */
    }
  }, []);
}

export default function ScanBar() {
  const router = useRouter();
  const beep = useBeep();

  const [manual, setManual] = useState("");
  const [cameraOpen, setCameraOpen] = useState(false);
  const [flash, setFlash] = useState<Flash>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const lastScanRef = useRef<{ code: string; at: number }>({ code: "", at: 0 });
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const msgTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const doFlash = useCallback((kind: Flash) => {
    setFlash(kind);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), 280);
  }, []);

  const showMessage = useCallback((msg: string) => {
    setMessage(msg);
    if (msgTimer.current) clearTimeout(msgTimer.current);
    if (msg) msgTimer.current = setTimeout(() => setMessage(""), 4000);
  }, []);

  const handleScan = useCallback(
    async (raw: string) => {
      const code = raw.trim();
      if (!code) return;

      // Dedupe: the camera fires many decodes; ignore the same code within 1.5s.
      const now = Date.now();
      if (
        lastScanRef.current.code === code &&
        now - lastScanRef.current.at < 1500
      ) {
        return;
      }
      lastScanRef.current = { code, at: now };

      setBusy(true);
      try {
        const res = await fetch(`/api/items/${encodeURIComponent(code)}`);
        if (res.ok) {
          beep(true);
          doFlash("success");
          showMessage("");
          setManual("");
          setCameraOpen(false);
          router.push(`/inventory/${encodeURIComponent(code)}`);
        } else if (res.status === 404) {
          beep(false);
          doFlash("error");
          showMessage(`Unknown barcode: ${code}`);
        } else {
          doFlash("error");
          showMessage("Scan lookup failed — try again.");
        }
      } catch {
        doFlash("error");
        showMessage("Scan failed — check your connection.");
      } finally {
        setBusy(false);
      }
    },
    [beep, doFlash, showMessage, router]
  );

  // --- Keyboard-wedge capture (Bluetooth handheld scanner = keyboard) ---
  // Buffers fast keystrokes; an Enter ending a recent burst counts as a scan.
  // Skips when the user is typing in a real field or a modal is open, so it
  // never steals keystrokes — meeting "scan without clicking a field first".
  useEffect(() => {
    let buffer = "";
    let lastKey = 0;

    function isEditableTarget(el: EventTarget | null): boolean {
      const node = el as HTMLElement | null;
      if (!node) return false;
      const tag = node.tagName;
      return (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        node.isContentEditable
      );
    }

    function onKeyDown(e: KeyboardEvent) {
      // Don't interfere with manual typing or any open modal/dialog.
      if (isEditableTarget(e.target)) return;
      if (document.querySelector(".scanbar-modal-open")) return;

      const now = Date.now();
      // A gap longer than 50ms means a human keypress, not a scanner burst.
      if (now - lastKey > 50) buffer = "";
      lastKey = now;

      if (e.key === "Enter") {
        if (buffer.length >= 3) {
          const code = buffer;
          buffer = "";
          void handleScan(code);
        }
        return;
      }
      if (e.key.length === 1) buffer += e.key;
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [handleScan]);

  useEffect(() => {
    return () => {
      if (flashTimer.current) clearTimeout(flashTimer.current);
      if (msgTimer.current) clearTimeout(msgTimer.current);
    };
  }, []);

  return (
    <>
      {/* Success/unknown flash overlay */}
      {flash && (
        <div
          className={`pointer-events-none fixed inset-0 z-[55] ${
            flash === "success" ? "bg-sage/40" : "bg-blush/50"
          }`}
        />
      )}

      {/* Floating scan dock */}
      <div className="fixed inset-x-0 bottom-0 z-50 flex justify-center px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <div className="w-full max-w-xl rounded-2xl border border-ink/10 bg-cream/95 p-2.5 shadow-lg backdrop-blur">
          <div className="flex items-center gap-2">
            <span className="hidden shrink-0 pl-2 text-[11px] uppercase tracking-[0.18em] text-ink/45 sm:block">
              Scan
            </span>
            <form
              className="flex flex-1 items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void handleScan(manual);
              }}
            >
              <input
                value={manual}
                onChange={(e) => setManual(e.target.value)}
                placeholder="Scan or type a barcode…"
                inputMode="numeric"
                className="min-w-0 flex-1 rounded-xl border border-ink/15 bg-white px-3.5 py-2.5 font-mono text-[15px] outline-none focus:border-ink/40"
              />
              <button
                type="submit"
                disabled={busy || !manual.trim()}
                className="shrink-0 rounded-xl bg-ink px-4 py-2.5 text-[15px] text-cream transition-opacity disabled:opacity-40"
              >
                Go
              </button>
            </form>
            <button
              type="button"
              onClick={() => setCameraOpen(true)}
              className="shrink-0 rounded-xl border border-ink/15 bg-white px-4 py-2.5 text-[15px] text-ink/70"
            >
              Camera
            </button>
          </div>
          {message && (
            <p className="px-2 pt-2 text-[13px] text-blush-deep">{message}</p>
          )}
        </div>
      </div>

      {cameraOpen && (
        <>
          {/* marker so the keyboard listener pauses while the camera is open */}
          <span className="scanbar-modal-open hidden" />
          <CameraScanner
            onResult={(text) => void handleScan(text)}
            onClose={() => setCameraOpen(false)}
          />
        </>
      )}
    </>
  );
}
