"use client";

import { useState } from "react";

export function PostApprovalPanel({ alertId, graphicUrl, initialCaption }: { alertId: string; graphicUrl: string; initialCaption: string }) {
  const [caption, setCaption] = useState(initialCaption);
  const [status, setStatus] = useState<"idle" | "posting" | "posted" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  async function onApprovePost() {
    setStatus("posting");
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/post/${alertId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ caption }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "post failed");
      setStatus("posted");
      setMessage(`Posted — Instagram media id ${body.mediaId}`);
    } catch (err) {
      setStatus("error");
      setMessage((err as Error).message);
    }
  }

  return (
    <div style={{ display: "flex", gap: 24, marginTop: 16, flexWrap: "wrap" }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={graphicUrl} alt="Generated social graphic" width={360} height={360} style={{ borderRadius: 12 }} />
      <div style={{ flex: 1, minWidth: 280 }}>
        <textarea
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          rows={8}
          style={{ width: "100%", background: "var(--bg-elevated)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 8, padding: 12 }}
        />
        <button
          onClick={onApprovePost}
          disabled={status === "posting" || status === "posted"}
          style={{ marginTop: 12, padding: "10px 16px", borderRadius: 8, border: "none", background: "var(--accent)", color: "#06111f", fontWeight: 600, cursor: "pointer" }}
        >
          {status === "posting" ? "Posting..." : status === "posted" ? "Posted" : "Approve & post to Instagram"}
        </button>
        {message && <p style={{ marginTop: 8, color: status === "error" ? "#f87171" : "var(--high)" }}>{message}</p>}
      </div>
    </div>
  );
}
