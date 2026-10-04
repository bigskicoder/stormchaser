/**
 * Displays lib/scoring/wind-hold.ts's estimate. Tier cutoffs here are purely
 * presentational (which badge color to show), not scoring thresholds — see
 * that module and lib/config/constants.ts for the underlying generic,
 * documented-as-an-estimate wind-hold model.
 */
function tierFor(probability: number): { label: string; className: string } {
  if (probability < 0.15) return { label: "unlikely", className: "low" };
  if (probability < 0.5) return { label: "possible", className: "medium" };
  return { label: "likely", className: "danger" };
}

export function WindHoldBadge({ probability }: { probability: number | null }) {
  if (probability == null) return <span className="no-signal">n/a</span>;
  const tier = tierFor(probability);
  return (
    <span className={`badge ${tier.className}`}>
      {Math.round(probability * 100)}% {tier.label}
    </span>
  );
}
