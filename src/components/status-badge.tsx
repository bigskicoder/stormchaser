const STATUS_TIER: Record<string, "high" | "medium" | "low" | "danger"> = {
  sent: "high",
  posted: "high",
  approved: "high",
  pending: "medium",
  publishing: "medium",
  draft: "medium",
  failed: "danger",
  skipped_rate_limited: "low",
  "not started": "low",
  rejected: "low",
};

/** Generic status pill for admin tables (delivery_status, social_posts.status, etc) — reuses the same badge CSS as ConfidenceBadge, mapped to an appropriate tier per known status string. Unknown statuses fall back to the neutral "low" tier rather than guessing. */
export function StatusBadge({ status }: { status: string }) {
  const tier = STATUS_TIER[status] ?? "low";
  return <span className={`badge ${tier}`}>{status.replace(/_/g, " ")}</span>;
}
