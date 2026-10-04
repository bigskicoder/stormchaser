import { getServiceDb } from "@/lib/db/client";
import { CalibrationReviewRow } from "@/components/calibration-review-row";
import type { CalibrationRecommendation, Resort } from "@/lib/db/types";

export const dynamic = "force-dynamic";

async function getPendingRecommendations() {
  const db = getServiceDb();
  const { data, error } = await db
    .from("calibration_recommendations")
    .select("*, resorts(name)")
    .eq("status", "pending")
    .order("computed_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Array<CalibrationRecommendation & { resorts: Pick<Resort, "name"> }>;
}

export default async function AdminCalibrationPage() {
  const recommendations = await getPendingRecommendations();

  return (
    <>
      <h2 style={{ fontSize: 18 }}>SLR calibration recommendations</h2>
      <p style={{ color: "#94a3b8" }}>
        ROADMAP Phase B — recommend-only. Generated weekly from accuracy_log history (minimum 15 samples per resort),
        bounded to &plusmn;5% per update. Nothing here is applied until approved below; approving writes directly to
        the resort&rsquo;s <code>slr_calibration_multiplier</code>.
      </p>
      <table>
        <thead>
          <tr>
            <th>Resort</th>
            <th>Samples</th>
            <th>Mean signed error</th>
            <th>Current</th>
            <th>Recommended</th>
            <th>Decision</th>
          </tr>
        </thead>
        <tbody>
          {recommendations.map((r) => (
            <CalibrationReviewRow
              key={r.id}
              id={r.id}
              resortName={r.resorts?.name ?? r.resort_id}
              sampleCount={r.sample_count}
              meanSignedErrorIn={r.mean_signed_error_in}
              currentMultiplier={r.current_multiplier}
              recommendedMultiplier={r.recommended_multiplier}
            />
          ))}
          {recommendations.length === 0 && (
            <tr>
              <td colSpan={6} className="no-signal">
                No pending recommendations — accumulates once resorts have 15+ accuracy_log samples.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </>
  );
}
