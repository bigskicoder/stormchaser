import type { AlertFired, Resort } from "@/lib/db/types";

/** Auto-drafted caption (BUILD_PRIMER section 8) — admin reviews/edits before approving, never auto-posted. */
export function draftCaption(resort: Resort, alert: AlertFired): string {
  const payload = alert.trip_opportunity_payload;
  const dateLabel = new Date(payload.target_date_start).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  const inches = payload.estimated_snowfall_in.toFixed(0);
  const confidenceLine =
    payload.confidence_label === "high"
      ? "Confidence is high on this one."
      : payload.confidence_label === "medium"
        ? "Moderate confidence — worth watching closely."
        : "Early signal, lower confidence — keep an eye on updates.";

  return [
    `Storm signal: ${resort.name} 🚨`,
    `${inches}" forecast for ${dateLabel}. ${confidenceLine}`,
    `Powder score: ${(payload.powder_score * 100).toFixed(0)}/100.`,
    `Full breakdown + live scores for every resort we track: link in bio.`,
    `#powderalert #${resort.slug.replace(/-/g, "")} #skiing #snowboarding #powderday`,
  ].join("\n\n");
}
