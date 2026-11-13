"use client";

import { useState } from "react";

export type PendingCalibration = {
  id: string;
  resortName: string;
  phaseLabel: string | null;
  sampleCount: number;
  meanSignedErrorIn: number;
  currentMultiplier: number;
  recommendedMultiplier: number;
};

/** Reads a JSON error body, or says what the server returned when it isn't JSON (e.g. a timeout page). */
async function errorOf(res: Response): Promise<string> {
  const text = await res.text();
  try {
    return (JSON.parse(text) as { error?: string }).error ?? `request failed (${res.status})`;
  } catch {
    return `request failed (${res.status})`;
  }
}

/**
 * Pending calibration proposals as cards that work on a phone: tick the
 * ones to keep (all ticked to start), approve them together as one model
 * version, or reject single ones.
 */
export function CalibrationReview({ items }: { items: PendingCalibration[] }) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(items.map((i) => i.id)));
  const [done, setDone] = useState<Record<string, "approved" | "rejected">>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const open = items.filter((i) => !done[i.id]);
  const chosen = open.filter((i) => selected.has(i.id));

  function toggle(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function approveSelected() {
    if (chosen.length === 0) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/calibration/approve-batch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids: chosen.map((i) => i.id) }),
      });
      if (!res.ok) throw new Error(await errorOf(res));
      const body = (await res.json()) as { approved: number; versionName: string | null };
      setDone((d) => ({ ...d, ...Object.fromEntries(chosen.map((i) => [i.id, "approved" as const])) }));
      setMessage({ ok: true, text: `Approved ${body.approved} and made them live as “${body.versionName}”. Undo by activating the previous version under Model versions.` });
    } catch (err) {
      setMessage({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function reject(id: string) {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/calibration/${id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision: "rejected" }),
      });
      if (!res.ok) throw new Error(await errorOf(res));
      setDone((d) => ({ ...d, [id]: "rejected" }));
    } catch (err) {
      setMessage({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="calib-review">
      {open.length > 0 && (
        <div className="calib-actions">
          <button type="button" className="calib-approve" onClick={approveSelected} disabled={busy || chosen.length === 0}>
            {busy ? "Working…" : `Approve ${chosen.length} selected`}
          </button>
          <button type="button" className="calib-link" onClick={() => setSelected(new Set(open.map((i) => i.id)))} disabled={busy}>
            Select all
          </button>
          <button type="button" className="calib-link" onClick={() => setSelected(new Set())} disabled={busy}>
            Select none
          </button>
        </div>
      )}
      {message && <p className={message.ok ? "calib-msg ok" : "calib-msg err"}>{message.text}</p>}

      {items.map((i) => {
        const state = done[i.id];
        const change = i.recommendedMultiplier / i.currentMultiplier - 1;
        return (
          <div key={i.id} className={`calib-card${state ? " done" : ""}`}>
            <label className="calib-head">
              {!state && <input type="checkbox" checked={selected.has(i.id)} onChange={() => toggle(i.id)} disabled={busy} />}
              <span className="calib-name">
                {i.resortName}
                {i.phaseLabel && <span className="calib-phase"> · {i.phaseLabel}</span>}
              </span>
            </label>
            <div className="calib-nums">
              <span>
                {i.currentMultiplier.toFixed(2)} → <strong>{i.recommendedMultiplier.toFixed(2)}</strong>{" "}
                <span className={Math.abs(change) >= 0.25 ? "calib-big" : "calib-small"}>
                  ({change >= 0 ? "+" : ""}
                  {(change * 100).toFixed(0)}%)
                </span>
              </span>
              <span className="calib-meta">
                {i.sampleCount.toLocaleString()} days · forecast {i.meanSignedErrorIn >= 0 ? "too high" : "too low"} by {Math.abs(i.meanSignedErrorIn).toFixed(2)}&quot; on average
              </span>
            </div>
            {state ? (
              <span className="calib-state">{state === "approved" ? "Approved" : "Rejected"}</span>
            ) : (
              <button type="button" className="calib-reject" onClick={() => reject(i.id)} disabled={busy}>
                Reject
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
