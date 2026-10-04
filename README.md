# powder-alert (PART_1)

Storm-signal detection + confidence-scored trip-opportunity alert engine for storm-chasing skiers. Built from `BUILD_PRIMER: powder-alert-platform :: PART_1`.

This is a working, from-scratch implementation — schema, ingestion, scoring engine, alerting, public site, and admin panel — built against **placeholder env vars**. No live Supabase/Clerk/Resend/Vercel/Instagram/Travelpayouts credentials were provisioned in this build session, and outbound network to `api.open-meteo.com` / NRCS's `wcc.sc.egov.usda.gov` was unreachable from the sandbox, so several integration surfaces are built to documented API conventions rather than live-validated. Everything is flagged below and in code comments — search for `ASSUMPTION FLAG` and `VERIFICATION FLAG` in `src/lib`.

## Get running

```bash
npm install
cp .env.example .env.local   # fill in real Supabase/Clerk/Resend/etc keys
```

1. Create a Supabase project, then run the migrations in `supabase/migrations/` in order (`0001_init.sql` through `0004_nws_benchmark.sql`) via the SQL editor or `supabase db push`.
2. `npm run seed:resorts` — upserts the full US Epic + Ikon resort roster (`src/lib/config/resorts-seed.ts`), then runs the elevation onboarding check, SNOTEL station resolution, and NWS gridpoint resolution against live Open-Meteo/NRCS/NWS APIs.
3. `npm run dev` for local dev, or deploy to Vercel and let `vercel.json`'s cron schedule drive ingestion/scoring/alerts.
4. `npm run test` (vitest — scoring engine unit tests) and `npm run typecheck` before shipping changes.

## What's built (AGENT_DIRECTIVE order)

1. **Schema** — `supabase/migrations/`. Matches BUILD_PRIMER section 4 with RLS added (section 10.5: public read on `resorts`/`snow_scores`/`alerts_fired`, service-role-only writes) and a couple of refinements: `resorts.slr_calibration_multiplier` (section 5.3 calibration hook), `resorts.elevation_check_*` + `snotel_station_*` + `nws_grid_*` (onboarding checks), `accuracy_log` for the backtest loop, and `benchmark_forecasts` for the public-baseline comparison pipeline (section 9 below).
2. **Ingestion** — `src/lib/ingestion/`. Open-Meteo per-model, per-elevation-band pulls (`open-meteo.ts`, `ingest-models.ts`), the elevation onboarding sanity check (`elevation.ts`), SNOTEL ground truth (`snotel.ts`), and Travelpayouts indicative fares (`fares.ts`). Wired to Vercel Cron via `src/app/api/cron/*` + `vercel.json`.
3. **Scoring engine** — `src/lib/scoring/`. Multi-model reconciliation with lead-time-bucketed weights (`reconciliation.ts`), ensemble confidence with the cross-check downgrade (`ensemble-confidence.ts`), swappable SLR strategies (`slr/` — Kuchera default, fixed-ratio baseline, Cobb-Waldstreicher stub), composite powder_score (`powder-score.ts`), and the orchestrator (`run.ts`). All thresholds/weights are named constants in `src/lib/config/constants.ts` — nothing inline. 29 unit tests in `tests/scoring/`.
4. **trip_opportunity contract** — `src/lib/trip-opportunity.ts`, matches section 6 exactly, no internal scoring details leaked.
5. **Alerting** — `src/lib/alerts/` (trigger + 24h rate limit + Resend dispatch), `src/lib/email/`.
6. **Public site** — `src/app/page.tsx`, `src/app/resorts/[slug]/page.tsx`. No auth wall, per-request rendered (scores change hourly).
7. **Admin panel** — `src/app/admin/`, Clerk-gated + `ADMIN_USER_IDS` owner allowlist. Generates a social graphic via `@vercel/og` (`src/app/api/admin/graphic/[alertId]/route.tsx`), drafts a caption (`src/lib/social/caption.ts`), and posts to Instagram via the two-call Graph API flow (`src/lib/social/instagram.ts`) only after manual approval (`src/app/api/admin/post/[alertId]/route.ts`).
8. **Backtest/accuracy logging** — `src/lib/backtest/accuracy.ts`, daily cron + a minimal `/admin/backtest` report.
9. **Public-baseline comparison pipeline** — `src/lib/ingestion/nws.ts`. Compares our scoring engine against NWS (`api.weather.gov`) gridded forecasts, both measured against SNOTEL ground truth via the same backtest/accuracy_log pipeline. This is deliberately **not** an OpenSnow integration — see "On OpenSnow" below.

## Flagged assumptions — verify before trusting in production

- **Open-Meteo request shape** (`src/lib/ingestion/open-meteo.ts`): endpoint paths, hourly variable names, and the ensemble `models=` selector are built from documented API conventions, not a live-validated response (outbound network to `api.open-meteo.com` was blocked in this sandbox). Centralized in one file by design — check against https://open-meteo.com/en/docs on first deploy.
- **Kuchera SLR coefficients** (`src/lib/scoring/slr/kuchera.ts`): the primer explicitly requires verifying coefficients against a primary source (Veals et al. 2025 or an NWS technical writeup) before hardcoding. That verification could not happen in this session (no network access to fetch the paper) — the coefficients used (anchor 12:1 at 271.16 K, slopes -1.0/-2.6) are transcribed from memory of the widely-cited operational formulation. **Do this verification before relying on alerts for real trip decisions.**
- **NRCS AWDB REST API shape** (`src/lib/ingestion/snotel.ts`): same network constraint — station search and data-pull endpoints built from documented conventions, not live-validated.
- **NWS gridded forecast shape** (`src/lib/ingestion/nws.ts`): endpoint shapes (`/points/{lat},{lng}`, `/gridpoints/{gridId}/{gridX},{gridY}`, the `snowfallAmount` structured time-series) are built from documented, long-stable NWS API conventions — higher confidence than the Open-Meteo/SNOTEL assumptions, but still unverified against a live response in this sandbox.

## On OpenSnow

The operator asked about comparing against OpenSnow directly. We're not doing that — see `ROADMAP.md` for the full reasoning, but short version: OpenSnow is a paid, proprietary consumer product with no public API and a ToS that doesn't permit automated access, even for paying subscribers. The BUILD_PRIMER already drew this line in section 2.3 ("do not scrape, do not reference their scoring methodology"). Instead, section 9 above (`src/lib/ingestion/nws.ts`) builds the same *kind* of comparison — "is our forecast better than a baseline" — against NWS's public-domain gridded data, which answers a more defensible question (are we beating a plain public forecast) without touching anyone's proprietary product. A manual, human-entered comparison log against OpenSnow (you read their number yourself, we store it) remains a legitimate option if wanted later — not built yet, no ToS issue since there's no automated access involved.
- **Resort seed data** (`src/lib/config/resorts-seed.ts`): lat/lng/elevation for the full US Epic + Ikon roster (51 resorts) compiled from training knowledge, not a live source. `npm run seed:resorts` runs each one through the Open-Meteo Elevation API onboarding check (section 2.1a) and flags >150m discrepancies — review flagged resorts before trusting their scores. `mid` elevation is a base/summit midpoint interpolation, not a measured mid-mountain figure.
- **SNOTEL station mapping**: resolved via a bounding-box nearest-station search at seed time, not hardcoded — many Northeast/Midwest resorts will legitimately resolve to no station (SNOTEL is a western-US network), so those resorts have no backtest ground truth by design.
- **Column-Tmax simplification** for Kuchera: uses precip-weighted mean of (surface temp, sub-500hPa pressure-level temps) across a day's hourly rows as a single representative Tmax, rather than a full per-timestep SLR-then-sum. Documented in `src/lib/scoring/aggregate.ts` and `run.ts`.

## Known follow-ups (not blocking, not built)

- **Cron cadence vs. Vercel plan tier**: `vercel.json` schedules hourly/6h/daily jobs. Vercel's Hobby (free) tier restricts cron frequency more than this — confirm current limits and budget for Pro ($20/mo) if needed, per the primer's own cost-envelope flag in section 2.1.
- **Open-Meteo commercial tier**: currently on the free non-commercial tier per section 2.1. Required once the product is monetized — `OPEN_METEO_API_KEY` is already wired as an env var for when that switch happens.
- **`npm audit`**: 3 high-severity advisories in `postcss`/`sharp`, both transitive through Next.js's own build tooling. Fixing requires bumping to Next 16 (breaking change) — left alone this session since the primer pins "Next.js on Vercel" without specifying a major version and this wasn't part of PART_1 scope; revisit before going to production.
- **Admin 403 status code**: an unauthorized `/admin` visitor sees a 403 message but the HTTP response is a 200 (Next.js Server Components don't set a custom status without the `forbidden()`/`unauthorized()` APIs). Access is genuinely blocked either way; only the status code is cosmetically wrong.
- **Cobb-Waldstreicher SLR strategy**: documented stub only (`src/lib/scoring/slr/cobb-waldstreicher.stub.ts`), per section 5.3 — needs vertical-motion/RH ingestion this pipeline doesn't pull yet.
- **Section 9 resort shortlist**: seeded with the full US Epic + Ikon roster per operator direction (superseding the primer's own SLC-placeholder fallback). Resort list is fully DB-editable — see section 9 / `resorts` table, never hardcoded elsewhere.

## Architecture notes

- Single Next.js app (App Router) rather than a separate Express service: Vercel Cron needs plain HTTP GET targets, which Next Route Handlers serve directly (`src/app/api/cron/*`). The Express 5 reuse the primer calls for (section 3) lives at `src/server/express-app.ts`, mounted into Next via a `node-mocks-http`-based adapter (`src/server/node-adapter.ts`) at `/api/express/*` — used for the subscribe endpoint and the read-only trip-opportunities lookup, the two places that genuinely fit Express's middleware-and-router shape. Local dev + curl end-to-end tested; see comments in `node-adapter.ts` and `express-app.ts` for two real bugs hit and fixed along the way (node-mocks-http's default no-op EventEmitter stub, and `finalhandler`'s `req.unpipe()` crash on a non-stream mock request).
- Both SLR strategy and multi-model reconciliation are swappable via clean interfaces (`src/lib/scoring/slr/types.ts`, `src/lib/scoring/reconciliation.ts`) per section 10, non-negotiable principle 2.
- No booking-partner SDK, auth, or data model anywhere in the codebase — the `trip_opportunity` payload (section 6) is the only surface a future PART_2 booking layer would touch.
