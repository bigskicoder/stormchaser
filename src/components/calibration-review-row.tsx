"use client";

import { useState } from "react";

export function CalibrationReviewRow({
  id,
  resortName,
  sampleCount,
  meanSignedErrorIn,
  currentMultiplier,
  recommendedMultiplier,
}: {
  id: string;
  resortName: string;
  sampleCount: number;
  meanSignedErrorIn: number;
  currentMultiplier: number;
  recommendedMultiplier: number;
}) {
  const [status, setStatus] = useState<"pending" | "submitting" | "approved" | "rejected" | "error">("pending");
  const [message, setMessage] = useState<string | null>(null);

  async function decide(decision: "approved" | "rejected") {
    setStatus("submitting");
    try {
      const res = await fetch(`/api/admin/calibration/${id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "request failed");
      setStatus(decision);
    } catch (err) {
      setStatus("error");
      setMessage((err as Error).message);
    }
  }

  if (status === "approved" || status === "rejected") {
    return (
      <tr>
        <td>{resortName}</td>
        <td colSpan={5} className="no-signal">
          {status === "approved" ? "Applied." : "Rejected."}
        </td>
      </tr>
    );
  }

  return (
    <tr>
      <td>{resortName}</td>
      <td>{sampleCount}</td>
      <td>
        {meanSignedErrorIn > 0 ? "+" : ""}
        {meanSignedErrorIn.toFixed(2)}&quot;
      </td>
      <td>{currentMultiplier.toFixed(3)}</td>
      <td>{recommendedMultiplier.toFixed(3)}</td>
      <td>
        <button
          onClick={() => decide("approved")}
          disabled={status === "submitting"}
          style={{ marginRight: 8, padding: "4px 10px", borderRadius: 6, border: "none", background: "var(--high)", color: "#06111f", fontWeight: 600, cursor: "pointer" }}
        >
          Approve
        </button>
        <button
          onClick={() => decide("rejected")}
          disabled={status === "submitting"}
          style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "transparent", color: "var(--text)", cursor: "pointer" }}
        >
          Reject
        </button>
        {status === "error" && <div style={{ color: "var(--danger)", fontSize: 12, marginTop: 4 }}>{message}</div>}
      </td>
    </tr>
  );
}
