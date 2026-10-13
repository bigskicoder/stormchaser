"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Activating a draft promotes it to live; activating an archived version
 * rolls back to it — same button, same endpoint either way (see
 * lib/model-versions/activate.ts). router.refresh() re-runs the server
 * component so every row's status/lineage updates, not just this one.
 */
export function ModelVersionActivateButton({ id, label = "Activate" }: { id: string; label?: string }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "submitting" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  async function activate() {
    setState("submitting");
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/model-versions/${id}/activate`, { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "request failed");
      router.refresh();
      setState("idle");
    } catch (err) {
      setState("error");
      setMessage((err as Error).message);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={activate}
        disabled={state === "submitting"}
        style={{
          padding: "4px 10px",
          borderRadius: 6,
          border: "none",
          background: "var(--high)",
          color: "#06111f",
          fontWeight: 600,
          cursor: state === "submitting" ? "default" : "pointer",
          opacity: state === "submitting" ? 0.6 : 1,
          whiteSpace: "nowrap",
        }}
      >
        {state === "submitting" ? "Working…" : label}
      </button>
      {state === "error" && <div style={{ color: "var(--danger)", fontSize: 12, marginTop: 4 }}>{message}</div>}
    </div>
  );
}
