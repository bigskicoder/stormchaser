"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** PIN prompt shown by the admin layout while Clerk isn't set up. */
export function AdminPinForm() {
  const router = useRouter();
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin-pin", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pin }) });
      if (res.ok) {
        router.refresh();
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? "Couldn't sign in.");
      setPin("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ display: "grid", gap: 12, maxWidth: 280 }}>
      <label htmlFor="admin-pin" style={{ fontWeight: 600 }}>
        Admin PIN
      </label>
      <input
        id="admin-pin"
        type="password"
        inputMode="numeric"
        autoComplete="current-password"
        autoFocus
        value={pin}
        onChange={(e) => setPin(e.target.value)}
        style={{ fontSize: 20, padding: "10px 12px", letterSpacing: "0.2em" }}
      />
      <button type="submit" disabled={busy || !pin} style={{ padding: "10px 12px", fontSize: 16 }}>
        {busy ? "Checking…" : "Unlock"}
      </button>
      {error ? <p style={{ color: "var(--danger, #c0392b)", margin: 0 }}>{error}</p> : null}
    </form>
  );
}

export function AdminPinSignOut() {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={async () => {
        await fetch("/api/admin-pin", { method: "DELETE" });
        router.refresh();
      }}
      style={{ fontSize: 13 }}
    >
      Lock
    </button>
  );
}
