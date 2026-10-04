/**
 * Alert dispatch (BUILD_PRIMER section 7): builds the trip_opportunity
 * payload, logs alerts_fired, and sends the Resend email to subscribers
 * whose resort_prefs match. Fare enrichment is optional and must never
 * block firing — buildTripOpportunityPayload already swallows fare-lookup
 * failures (see lib/trip-opportunity.ts), so a fare outage never reaches
 * this module as an error.
 */

import { getServiceDb } from "@/lib/db/client";
import { ALERTS_FROM_EMAIL, getResendClient } from "@/lib/email/resend-client";
import { buildTripOpportunityPayload } from "@/lib/trip-opportunity";
import type { Subscriber } from "@/lib/db/types";
import type { TriggerCandidate } from "./trigger";

/** Resend's batch.send caps at 100 emails per call (verified via WebSearch). Chunk rather than assume any resort stays under that forever. */
const RESEND_BATCH_SIZE_LIMIT = 100;

export function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

/**
 * Subscribers with an empty resort_prefs array are treated as "alert me for
 * any tracked resort" (a global subscriber) rather than "alert me for
 * nothing" — the more useful default for a storm-chaser audience, and an
 * explicit product choice documented here since the primer doesn't specify
 * empty-array semantics.
 */
async function matchingSubscribers(resortId: string): Promise<Subscriber[]> {
  const db = getServiceDb();
  const { data, error } = await db.from("subscribers").select("*").eq("active", true);
  if (error) throw error;

  return ((data ?? []) as Subscriber[]).filter((s) => {
    const prefs = s.resort_prefs ?? [];
    return prefs.length === 0 || prefs.includes(resortId);
  });
}

function renderAlertEmail(params: {
  resortName: string;
  estimatedSnowfallIn: number;
  confidenceLabel: string;
  powderScore: number;
  targetDateStart: string;
}): { subject: string; html: string } {
  const { resortName, estimatedSnowfallIn, confidenceLabel, powderScore, targetDateStart } = params;
  const dateLabel = new Date(targetDateStart).toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
  const subject = `Powder alert: ${resortName} — ${estimatedSnowfallIn.toFixed(0)}" forecast (${confidenceLabel} confidence)`;
  const html = `
    <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
      <h1 style="font-size: 20px;">${resortName}</h1>
      <p style="font-size: 16px;">
        <strong>${estimatedSnowfallIn.toFixed(1)}"</strong> forecast for <strong>${dateLabel}</strong>
      </p>
      <p>Confidence: <strong>${confidenceLabel}</strong> &middot; Powder score: <strong>${(powderScore * 100).toFixed(0)}/100</strong></p>
      <p style="color: #666; font-size: 13px;">
        This is an automated forecast alert, not a guarantee. Fare figures (if shown) are recently
        seen indicative prices, not live quotes or a booking offer.
      </p>
    </div>
  `;
  return { subject, html };
}

export async function dispatchAlert(candidate: TriggerCandidate): Promise<void> {
  const db = getServiceDb();
  const { resort, snowScore } = candidate;

  const payload = await buildTripOpportunityPayload(resort, snowScore);

  const { data: alertRow, error: insertError } = await db
    .from("alerts_fired")
    .insert({
      resort_id: resort.id,
      snow_score_id: snowScore.id,
      target_date_start: snowScore.target_date,
      target_date_end: snowScore.target_date,
      powder_score_at_trigger: snowScore.powder_score,
      confidence_label: snowScore.confidence_label,
      trip_opportunity_payload: payload,
      delivery_status: "pending",
    })
    .select()
    .single();
  if (insertError) throw insertError;

  const subscribers = await matchingSubscribers(resort.id);
  if (subscribers.length === 0) {
    await db.from("alerts_fired").update({ delivery_status: "sent", recipients_count: 0 }).eq("id", alertRow.id);
    return;
  }

  const { subject, html } = renderAlertEmail({
    resortName: resort.name,
    estimatedSnowfallIn: snowScore.estimated_snowfall_in,
    confidenceLabel: snowScore.confidence_label,
    powderScore: snowScore.powder_score,
    targetDateStart: payload.target_date_start,
  });

  const resend = getResendClient();
  const batches = chunk(subscribers, RESEND_BATCH_SIZE_LIMIT);
  let sentCount = 0;
  const batchErrors: string[] = [];

  for (const batch of batches) {
    try {
      await resend.batch.send(
        batch.map((s) => ({
          from: ALERTS_FROM_EMAIL,
          to: s.email,
          subject,
          html,
        }))
      );
      sentCount += batch.length;
    } catch (err) {
      batchErrors.push((err as Error).message);
    }
  }

  await db
    .from("alerts_fired")
    .update({
      delivery_status: batchErrors.length === 0 ? "sent" : "failed",
      recipients_count: sentCount,
    })
    .eq("id", alertRow.id);

  if (batchErrors.length > 0) {
    throw new Error(`${batchErrors.length}/${batches.length} email batch(es) failed: ${batchErrors.join("; ")}`);
  }
}

export async function dispatchAllTriggeredAlerts(candidates: TriggerCandidate[]): Promise<{ fired: number; errors: string[] }> {
  let fired = 0;
  const errors: string[] = [];
  for (const candidate of candidates) {
    try {
      await dispatchAlert(candidate);
      fired += 1;
    } catch (err) {
      errors.push(`${candidate.resort.slug}: ${(err as Error).message}`);
    }
  }
  return { fired, errors };
}
