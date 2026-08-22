/**
 * Express 5 app (BUILD_PRIMER section 3: "backend/compute: Node.js +
 * Express 5, reuse pattern from NexusGxP"). Vercel Cron jobs must target
 * plain HTTP GET endpoints, so the cron-triggered ingestion/scoring jobs
 * live as Next.js Route Handlers under src/app/api/cron/* (see
 * lib/cron-auth.ts) — those aren't naturally Express's job. This app
 * carries the request/response-shaped backend surface that /does/ fit the
 * Express middleware pattern: subscriber email capture and the read-only
 * trip-opportunities lookup. Mounted into Next.js via
 * src/server/node-adapter.ts + src/app/api/express/[[...slug]]/route.ts.
 */

import express, { type Request, type Response } from "express";
import { z } from "zod";
import { getServiceDb } from "@/lib/db/client";
import type { AlertFired, Resort } from "@/lib/db/types";

export const expressApp = express();
// No express.json() middleware: the node-adapter (src/server/node-adapter.ts)
// already parses the Web Request body and hands node-mocks-http a
// pre-populated req.body directly — body-parser middleware reads from a
// real stream, which the mock request doesn't provide, so it would just
// clobber req.body back to {} if it ran.

const router = express.Router();

router.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", service: "powder-alert-express", time: new Date().toISOString() });
});

const subscribeSchema = z.object({
  email: z.string().email(),
  resortIds: z.array(z.string().uuid()).optional().default([]),
});

router.post("/subscribe", async (req: Request, res: Response) => {
  const parsed = subscribeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_request", details: parsed.error.flatten() });
    return;
  }

  const db = getServiceDb();
  const { error } = await db.from("subscribers").upsert(
    {
      email: parsed.data.email,
      resort_prefs: parsed.data.resortIds,
      active: true,
    },
    { onConflict: "email" }
  );

  if (error) {
    res.status(500).json({ error: "subscribe_failed", message: error.message });
    return;
  }

  res.status(201).json({ status: "subscribed" });
});

/**
 * Public read of the most recent fired alert's trip_opportunity payload for
 * a resort (section 6 contract — read-only exposure, future booking-layer
 * consumers hit this same shape without touching the scoring engine).
 */
router.get("/trip-opportunities/:resortSlug", async (req: Request, res: Response) => {
  const db = getServiceDb();
  const { data: resort, error: resortError } = await db
    .from("resorts")
    .select("*")
    .eq("slug", req.params.resortSlug)
    .maybeSingle();

  if (resortError) {
    res.status(500).json({ error: "lookup_failed", message: resortError.message });
    return;
  }
  if (!resort) {
    res.status(404).json({ error: "resort_not_found" });
    return;
  }

  const { data: alert, error: alertError } = await db
    .from("alerts_fired")
    .select("*")
    .eq("resort_id", (resort as Resort).id)
    .order("fired_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (alertError) {
    res.status(500).json({ error: "lookup_failed", message: alertError.message });
    return;
  }
  if (!alert) {
    res.status(404).json({ error: "no_active_trip_opportunity" });
    return;
  }

  res.json((alert as AlertFired).trip_opportunity_payload);
});

expressApp.use("/api/express", router);

/**
 * Custom error-handling middleware, registered last. Without this, an
 * uncaught/rejected route error falls through to Express's built-in
 * `finalhandler`, whose default error path calls `req.unpipe()` —
 * `Readable.prototype.unpipe` reads `this._readableState.pipes`, which
 * throws ("Cannot read properties of undefined (reading 'pipes')") because
 * node-mocks-http's mock request (src/server/node-adapter.ts) isn't a real
 * stream.Readable and has no `_readableState`. That uncaught TypeError never
 * calls res.end(), so the adapter's Promise never resolves and the request
 * just hangs until Next's own request handling eventually gives up. This
 * middleware sends the error response directly instead, so `finalhandler`
 * is never reached.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
expressApp.use((err: unknown, _req: Request, res: Response, _next: express.NextFunction) => {
  const message = err instanceof Error ? err.message : "internal_error";
  res.status(500).json({ error: "internal_error", message });
});

export default expressApp;
