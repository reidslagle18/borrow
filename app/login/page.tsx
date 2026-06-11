"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (res.ok) {
      router.push("/inventory");
      router.refresh();
    } else {
      setError("That's not it — try again.");
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-sm text-center">
        <h1 className="text-5xl italic font-medium tracking-tight">BORROW</h1>
        <p className="mt-2 text-sm uppercase tracking-[0.25em] text-ink/50">
          Studio · Private
        </p>
        <form onSubmit={submit} className="mt-10 space-y-4">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            autoFocus
            className="w-full rounded-full border border-ink/15 bg-white px-5 py-3.5 text-center text-base outline-none focus:border-ink/40"
          />
          {error && <p className="text-sm text-blush-deep">{error}</p>}
          <button
            type="submit"
            disabled={busy || !password}
            className="w-full rounded-full bg-ink px-5 py-3.5 text-base text-cream transition-opacity disabled:opacity-40"
          >
            {busy ? "One moment…" : "Enter"}
          </button>
        </form>
      </div>
    </main>
  );
}
