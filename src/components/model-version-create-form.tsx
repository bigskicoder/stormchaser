"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

/**
 * A raw-JSON textarea for the full ScoringConfig, pre-filled from the
 * branch-source version, rather than ~20 individual numeric inputs for
 * every nested model-weight/threshold field. Deliberate scope call: this
 * is an admin-only internal tool (ROADMAP Phase C), and the fields here
 * are exactly the ones lib/scoring/config.ts's ScoringConfig already
 * types and the API route (api/admin/model-versions/route.ts) already
 * validates with zod before anything is persisted — a malformed edit is
 * rejected server-side, not silently accepted.
 */
export function ModelVersionCreateForm({
  defaultConfigJson,
  sourceVersionId,
  sourceVersionName,
}: {
  defaultConfigJson: string;
  sourceVersionId: string;
  sourceVersionName: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [configJson, setConfigJson] = useState(defaultConfigJson);
  const [state, setState] = useState<"idle" | "submitting" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setState("submitting");
    setMessage(null);

    let config: unknown;
    try {
      config = JSON.parse(configJson);
    } catch {
      setState("error");
      setMessage("Config isn't valid JSON.");
      return;
    }

    try {
      const res = await fetch("/api/admin/model-versions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, description: description || undefined, config, sourceVersionId }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "request failed");
      setState("idle");
      setName("");
      setDescription("");
      setOpen(false);
      router.refresh();
    } catch (err) {
      setState("error");
      setMessage((err as Error).message);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{ padding: "6px 12px", borderRadius: 6, border: "1px solid var(--border)", background: "transparent", color: "var(--text)", cursor: "pointer" }}
      >
        + New draft from &ldquo;{sourceVersionName}&rdquo;
      </button>
    );
  }

  return (
    <form onSubmit={submit} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 16, marginBottom: 24 }}>
      <div style={{ marginBottom: 10 }}>
        <label style={{ display: "block", fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>Name</label>
        <input
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={`e.g. "Heavier HRRR weight, T0_48"`}
          style={{ width: "100%", padding: "6px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)" }}
        />
      </div>
      <div style={{ marginBottom: 10 }}>
        <label style={{ display: "block", fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>Description (optional)</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          style={{ width: "100%", padding: "6px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontFamily: "inherit" }}
        />
      </div>
      <div style={{ marginBottom: 10 }}>
        <label style={{ display: "block", fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>
          Scoring config (JSON, cloned from &ldquo;{sourceVersionName}&rdquo; &mdash; edit before saving)
        </label>
        <textarea
          required
          value={configJson}
          onChange={(e) => setConfigJson(e.target.value)}
          rows={14}
          style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontFamily: "var(--font-mono, monospace)", fontSize: 12 }}
        />
      </div>
      <button
        type="submit"
        disabled={state === "submitting"}
        style={{ padding: "6px 14px", borderRadius: 6, border: "none", background: "var(--high)", color: "#06111f", fontWeight: 600, cursor: "pointer", marginRight: 8 }}
      >
        {state === "submitting" ? "Saving…" : "Save as draft"}
      </button>
      <button
        type="button"
        onClick={() => setOpen(false)}
        style={{ padding: "6px 14px", borderRadius: 6, border: "1px solid var(--border)", background: "transparent", color: "var(--text)", cursor: "pointer" }}
      >
        Cancel
      </button>
      <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 8 }}>
        Saved as a draft only &mdash; nothing changes for live scoring until you activate it below.
      </p>
      {state === "error" && <div style={{ color: "var(--danger)", fontSize: 12, marginTop: 4 }}>{message}</div>}
    </form>
  );
}
