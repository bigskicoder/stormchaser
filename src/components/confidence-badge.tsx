import type { ConfidenceLabel } from "@/lib/db/types";

export function ConfidenceBadge({ label }: { label: ConfidenceLabel }) {
  return <span className={`badge ${label}`}>{label}</span>;
}
