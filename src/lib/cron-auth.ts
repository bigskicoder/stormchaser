import { NextRequest, NextResponse } from "next/server";

/**
 * Verifies the request came from Vercel Cron (or a caller with the shared
 * secret). Vercel automatically sends `Authorization: Bearer $CRON_SECRET`
 * on its own cron invocations when CRON_SECRET is set as an env var —
 * https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs.
 * Returns a 401 NextResponse to short-circuit with, or null if authorized.
 */
export function verifyCronRequest(req: NextRequest): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    // No secret configured (e.g. local dev) — allow through, but this
    // should never be the case in a deployed environment.
    return null;
  }
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return null;
}
