"use client";

import { useEffect, useState } from "react";
import {
  Consignor,
  CONSIGNOR_AGREEMENT_TITLE,
  CONSIGNOR_AGREEMENT_INTRO,
  CONSIGNOR_AGREEMENT_BODY,
  CONSIGNOR_AGREEMENT_VERSION,
} from "@/lib/types";

/**
 * Digital signing of the Consignor Agreement. The consignor (or staff on their
 * behalf at drop-off) reviews the agreement, types their full legal name, and
 * checks the agree box; the server records the name, a timestamp, and their IP.
 */
export default function ConsignorAgreementModal({
  consignorId,
  consignorName,
  onClose,
  onSigned,
}: {
  consignorId: number;
  consignorName: string;
  onClose: () => void;
  onSigned: (updated: Consignor) => void;
}) {
  const [name, setName] = useState(consignorName || "");
  const [agreed, setAgreed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  // The exact text (at this consignor's locked rate) comes from the server so
  // the displayed agreement always matches what they'll sign (60% grandfathered
  // / promised, else the new default).
  const [body, setBody] = useState<string[]>(CONSIGNOR_AGREEMENT_BODY);
  const [intro, setIntro] = useState(CONSIGNOR_AGREEMENT_INTRO);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/consignors/${consignorId}/agreement`);
        if (res.ok) {
          const d = await res.json();
          if (Array.isArray(d.body) && d.body.length) setBody(d.body);
          if (d.intro) setIntro(d.intro);
        }
      } catch {
        /* fall back to the default text already in state */
      }
    })();
  }, [consignorId]);

  async function sign() {
    if (!name.trim() || !agreed) return;
    setSaving(true);
    setError("");
    const res = await fetch(`/api/consignors/${consignorId}/agreement`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name.trim(),
        agreed: true,
        version: CONSIGNOR_AGREEMENT_VERSION,
      }),
    });
    if (res.ok) {
      onSigned(await res.json());
    } else {
      const d = await res.json().catch(() => ({}));
      setError(d.error || "Couldn't record the signature. Try again.");
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-ink/40 sm:items-center sm:p-6"
      onClick={onClose}
    >
      <div
        className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-cream p-6 sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-serif text-2xl font-semibold">
          {CONSIGNOR_AGREEMENT_TITLE}
        </h2>
        <p className="mt-2 text-[14px] leading-relaxed text-ink/70">
          {intro}
        </p>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-[13px] leading-relaxed text-ink/70">
          {body.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>

        <div className="mt-5 space-y-3">
          <div>
            <label className="mb-1.5 block text-xs uppercase tracking-[0.15em] text-ink/50">
              Full legal name
            </label>
            <input
              className="w-full rounded-xl border border-ink/15 bg-white px-3.5 py-3 text-base outline-none focus:border-ink/40"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Type your full legal name"
              autoComplete="name"
            />
          </div>
          <label className="flex items-start gap-2.5 text-[14px]">
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              className="mt-1 h-4 w-4 shrink-0 accent-ink"
            />
            <span>I have read and agree to this agreement.</span>
          </label>
          {error && <p className="text-sm text-blush-deep">{error}</p>}
          <div className="flex gap-2 pt-1">
            <button
              onClick={sign}
              disabled={saving || !name.trim() || !agreed}
              className="flex-1 rounded-full bg-ink px-6 py-3.5 text-base text-cream transition-opacity disabled:opacity-40"
            >
              {saving ? "Recording…" : "Sign & record"}
            </button>
            <button
              onClick={onClose}
              className="rounded-full border border-ink/15 px-5 py-3.5 text-[15px] text-ink/60"
            >
              Cancel
            </button>
          </div>
          <p className="text-[11px] leading-relaxed text-ink/40">
            Signing records your name, the date and time, and your IP address as
            your electronic signature.
          </p>
        </div>
      </div>
    </div>
  );
}
