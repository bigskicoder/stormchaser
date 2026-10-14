"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Marks a version as shadow-scored (computed every live run alongside the
 * active version, on the same forecast data, for season-long comparison —
 * see lib/model-versions/shadow.ts) or stops it. Disabled for the active
 * version itself — shadowing it would just duplicate its own primary score.
 */
export function ModelVersionShadowToggle({ id, isShadow, isActive }: { id: string; isShadow: boolean; isActive: boolean }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "submitting" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  async function toggle() {
    setState("submitting");
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/model-versions/${id}/shadow`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ isShadow: !isShadow }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "request failed");
      router.refresh();
      setState("idle");
    } catch (err) {
      setState("error");
      setMessage((err as Error).message);
    }
  }

  if (isActive) {
    return <span className="no-signal" style={{ fontSize: 12 }}>scored live</span>;
  }

  return (
    <div>
      <button
        type="button"
        onClick={toggle}
        disabled={state === "submitting"}
        style={{
          padding: "4px 10px",
          borderRadius: 6,
          fontSize: 12.5,
          cursor: state === "submitting" ? "default" : "pointer",
          opacity: state === "submitting" ? 0.6 : 1,
          whiteSpace: "nowrap",
          border: isShadow ? "1px solid var(--accent, #5fc9ec)" : "1px solid var(--border)",
          background: isShadow ? "var(--accent-wash, rgba(95,201,236,0.14))" : "transparent",
          color: isShadow ? "var(--accent-strong, #8fe0fb)" : "var(--text)",
        }}
      >
        {state === "submitting" ? "Working…" : isShadow ? "Shadowing — stop" : "Start shadowing"}
      </button>
      {state === "error" && <div style={{ color: "var(--danger)", fontSize: 12, marginTop: 4 }}>{message}</div>}
    </div>
  );
}
