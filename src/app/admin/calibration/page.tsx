import { getServiceDb } from "@/lib/db/client";
import { CalibrationReview } from "@/components/calibration-review";
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
  // Biggest changes first, so the ones worth a second look are at the top.
  const items = recommendations
    .map((r) => ({
      id: r.id,
      resortName: r.resorts?.name ?? r.resort_id,
      phaseLabel: r.enso_phase === "el_nino" ? "El Niño winters" : r.enso_phase === "la_nina" ? "La Niña winters" : null,
      sampleCount: r.sample_count,
      meanSignedErrorIn: Number(r.mean_signed_error_in),
      currentMultiplier: Number(r.current_multiplier),
      recommendedMultiplier: Number(r.recommended_multiplier),
    }))
    .sort((a, b) => Math.abs(Math.log(b.recommendedMultiplier / b.currentMultiplier)) - Math.abs(Math.log(a.recommendedMultiplier / a.currentMultiplier)));

  return (
    <>
      <h2 style={{ fontSize: 18 }}>
        Snow-ratio calibration {items.length > 0 && <span className="badge medium">{items.length} pending</span>}
      </h2>
      <p style={{ color: "var(--text-muted)" }}>
        Each proposal changes one resort&rsquo;s snow-to-liquid multiplier (between 0.5 and 2.0) so its forecasts match
        measured snowfall. Nothing changes until you approve. Approving the ticked ones makes them live together as one
        new entry under <a href="/admin/model-versions">Model versions</a>, and activating the previous entry there undoes
        it. A row marked El Niño or La Niña applies only in winters of that phase. Changes of 25% or more are in orange.
      </p>
      {items.length === 0 ? (
        <p className="no-signal">No pending proposals.</p>
      ) : (
        <CalibrationReview items={items} />
      )}
    </>
  );
}
