# ROADMAP

This is the single authoritative planning document for powder-alert past
PART_1. If you're picking this project back up after time away, start
here — it tells you what's done, what's not, what needs your action
specifically (not code), and what's safe to just ask Claude Code to
continue. `README.md` stays focused on setup/architecture detail and
links back here for status.

**Status legend:**
- ✅ Built and verified against a live service/response
- 🟡 Built, passes all local checks, not yet verified against a live service
- 🔶 Mechanism built, intentionally dormant (waiting on real data or your approval)
- ⬜ Not built
- 🔲 Not a code task — needs you specifically (an account, a payment, a business decision)

---

## Progress at a glance

| Phase | What | Status | Who moves it forward |
|---|---|---|---|
| 0 | Operational readiness (provisioning, deploy, seed) | 🔲 Not started | **You** — see punch list below |
| A | Autonomous pipeline (ingest → score → alert) | 🟡 Built, unverified live | You (deploy), then both |
| A.1 | Public-baseline comparison (NWS, not OpenSnow) | ✅ Built | Done |
| B | Self-tuning SLR calibration | 🔶 Mechanism + 2 historical backtest pipelines built | Needs Phase 0, then just `npm run backtest:*` |
| B.1 | Model versioning (save/compare/roll back) | ✅ Built | Done — `/admin/model-versions` |
| B.2 | Parallel model scoring ("shadow mode") | ✅ Built, dormant until a draft is shadowed | **You** — create a `kuchera-wind` draft and toggle shadowing |
| B.3 | Per-resort model precision | ✅ Built, dormant until a resort is differentiated | **You** — set a per-resort override from `/admin/model-versions` |
| C | Autonomous dev-iteration loop | ⬜ Designed, not activated | **You** — say go when ready |
| D | Visual design / UI polish | 🟡 Public site + admin panel done, pending only the product name | You (product name) |

**Test/build state as of this update**: 185/185 unit tests passing, clean
`tsc --noEmit`, clean `next build`, `npm audit` down to 0 critical
vulnerabilities reachable by this project's actual usage (1 remaining
critical is in vitest's UI-server feature, which isn't used here — see
"Known follow-ups" in README.md). Single branch (`claude/autonomous-coding-5hk5wt`),
which is also this repo's default branch — no PR pending, nothing to merge.

---

## Phase 0 — Operational readiness (🔲 Owner: you)

Nothing below is a code problem. These are accounts, keys, and a few
business decisions — nothing here, no amount of "keep coding," gets this
done without you. Ordered by what actually blocks what.

### Tier 1 — do these first, in order (nothing else works without them)
1. **Create a Supabase project** (free tier is fine at this scale) → copy its URL, anon key, and service-role key.
2. **Create a Vercel project on the Pro plan** ($20/mo) → import `bigskicoder/stormchaser`, branch `claude/autonomous-coding-5hk5wt`. **Not optional**: confirmed via WebSearch that Hobby caps at 2 active cron jobs, once-per-day each — this project's `vercel.json` has 10 jobs at hourly/6h/daily/weekly cadence and simply won't deploy as designed on Hobby.
3. **Set env vars in Vercel**: at minimum `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and a random string for `CRON_SECRET` (Vercel sends this back automatically on its own cron calls once it's set — see `.env.example` for the full list).
4. **Run the 8 migrations** (`supabase/migrations/0001` through `0008`) against that Supabase project — SQL editor or `supabase db push`.
5. **Deploy** — confirm the build goes green on Vercel with real secrets (you can deploy before step 4 to sanity-check the build itself, but the app won't do anything useful until the schema exists).
6. **Run `npm run seed:resorts`** against the real project. This is the first live contact with Open-Meteo's elevation API, NRCS's station list, and NWS's `/points` endpoint — review the console output for any resort flagged with an elevation discrepancy >150m before trusting its scores. It also seeds and activates a baseline `model_versions` row ("v1 — baseline") the first time it runs — see Phase B.1 — so live scoring and backtests have a real version to tag their output with from day one.

### Tier 2 — needed before the pipeline actually notifies anyone or admin auth works
7. **Clerk app** (free tier) → publishable + secret key. Sign in once yourself to get your Clerk user ID → set `ADMIN_USER_IDS`.
8. **Resend account** → verify a sending domain (or use their sandbox sender to start) → API key → `RESEND_API_KEY`, `ALERTS_FROM_EMAIL`.
9. **Set `PUBLIC_BASE_URL`** to your real Vercel deployment URL (`*.vercel.app` is fine — no domain needed, see below). Needed for the admin panel's Instagram graphic fetch to work at all.

### Tier 3 — only blocks specific features, fine to lag behind go-live
10. **Travelpayouts token** (optional) — fare enrichment is explicitly non-blocking by design (section 2.4); skip this indefinitely if you don't care about it.
11. **Meta Business + Instagram Business account**, dev-mode Meta app, Tester role on your own IG account, long-lived access token → `IG_USER_ID`, `IG_ACCESS_TOKEN`. This blocks only the Instagram-posting admin feature — the entire rest of the product (scoring, alerts, public site) works without it.

### Tier 4 — ongoing, after initial deploy
12. **Let ingestion run for a few days** before judging anything — the scoring engine needs real `forecast_pulls`/`ensemble_pulls` history, and the seasonal-max normalization bootstraps cold (defaults to 24" until real history exists).
13. **One end-to-end dry run**: once subscribers + Resend are wired, force a test alert and confirm the email actually lands, the admin graphic renders, and the Instagram publish actually works against your real account — every one of these is still unverified against a real service.
14. **Custom domain + product name** — both genuinely optional and non-blocking. Vercel gives you a free `*.vercel.app` URL automatically, and a domain can be attached later without redeploying anything. The primer itself left the product name as "powder-alert (rename TBD)" (BUILD_PRIMER section 0) — decide on a final name whenever you want, not before; see Phase D for where branding/naming actually gets applied once decided.
15. **Season-long accuracy burn-in** before fully trusting alerts or touching Phase B — see Phase B below.

---

## Phase A — Autonomous pipeline operation

**Status: 🟡 built, not yet proven against live services.**

Once deployed with real credentials, the product pipeline runs with zero
human input by design:

- Vercel Cron fires ingestion (`/api/cron/ingest-*`), scoring
  (`/api/cron/score`), alert dispatch (`/api/cron/alerts`), backtest
  logging (`/api/cron/backtest`), and now the NWS benchmark and
  calibration-recommendation jobs too — no one has to trigger or watch
  any of it.
- Subscribers get emailed automatically when a resort crosses threshold.
  Rate-limiting (one alert per resort per 24h) prevents spam without a
  human in the loop.

**The one deliberate exception: Instagram posting stays human-gated.**
BUILD_PRIMER section 8 is explicit that auto-publishing without a manual
click is a non-negotiable no. This isn't a limitation to engineer around —
it's cheap insurance against an autoposted mistake going out under the
account's name. Everything upstream of that one click (ingestion → scoring
→ alert → graphic generation → drafted caption) is already unattended.

**What moves this to ✅**: purely Phase 0 (provision services, let it run).
Nothing new to design here — just prove the existing design against real
traffic.

**Verification update (this session)**: this sandbox's raw network access
to `api.open-meteo.com`/`wcc.sc.egov.usda.gov`/`api.weather.gov` is fully
blocked (confirmed: WebFetch returns `EGRESS_BLOCKED` for every one of
these domains, same as direct `curl`), but WebSearch runs through separate
infrastructure and does work. Used it to cross-check the flagged
assumptions — see `README.md`'s "Flagged assumptions" section for the
full account, but the short version: **found and fixed two real bugs**
this way without needing live API access at all:
1. The Kuchera SLR coefficients had the slope magnitudes backwards
   (confirmed via two independently-converging searches against the
   primer's own named primary source, Veals et al. 2025) — fixed, with
   new tests pinning the corrected values.
2. The NRCS SNOTEL station-lookup code assumed server-side bounding-box
   filtering that the AWDB API doesn't actually support — fixed to fetch
   the full station list and filter client-side, which the code was
   already doing downstream anyway.

The Open-Meteo endpoint shapes and several hourly variable names were
independently spot-checked and held up as originally built. Everything
here is still short of a live response — Phase 0 step 6 (seeding) is the
first real one — but this closes most of the gap search-engine access
alone can close.

---

## Phase A.1 — Public-baseline comparison pipeline

**Status: ✅ built** (`src/lib/ingestion/nws.ts`, `/api/cron/ingest-nws-benchmark`, `benchmark_forecasts` table, extended `/admin/backtest` report).

You asked for "a pipeline to compare to OpenSnow." That specific request
was declined — OpenSnow is a paid, proprietary product with no public API
and a ToS that doesn't permit automated access (the BUILD_PRIMER already
drew this exact line in section 2.3). What got built instead answers the
same underlying question — "is our forecast actually good, relative to
something else" — against a source that's fully legitimate to automate
against: NWS's public-domain gridded forecasts (`api.weather.gov`). Both
our own scoring engine and the NWS baseline are now measured against the
same SNOTEL ground truth via `accuracy_log` (`source`-tagged `powder_alert`
vs `nws`), and `/admin/backtest` shows them side by side per resort.

If a literal OpenSnow comparison is still wanted later, the legitimate
version of that is a **manual, human-entered comparison log** — you read
their displayed forecast yourself (you have a subscription; that's not
automated access) and type the number in. Not built — would need one new
table and a small admin form if/when it's actually wanted.

---

## Phase B — Self-tuning SLR calibration loop

**Status: 🔶 mechanism built, no longer blocked on waiting out a live
season — only on Phase 0 (deploy, so the backtest scripts have somewhere
to write and real APIs to call).** `src/lib/calibration/` (pure update
rule in `recommend.ts`, DB orchestrator in `generate.ts`, the
only-approved-writes-apply path in `apply.ts`), `calibration_recommendations`
table, weekly cron (`/api/cron/calibration-recommend`), admin review UI
at `/admin/calibration`. 8 unit tests in `tests/calibration/`.

**How it works, as built:**
- Weekly, for each resort with ≥15 pooled `accuracy_log` samples (live
  `powder_alert` samples in the trailing 120 days, plus — new, see below —
  samples from either historical backtest pipeline, unwindowed), computes
  the mean signed error and proposes a new `slr_calibration_multiplier` —
  a simple bounded proportional controller, not a black box: nudge
  opposite the mean error, scaled to the mean predicted amount, clamped
  to ±5% per update, and the multiplier itself is hard-bounded to
  [0.7, 1.4] regardless of how large an error would otherwise imply.
- **Recommend-only, as decided**: nothing writes to `resorts.slr_calibration_multiplier`
  automatically. Every proposal lands in `calibration_recommendations` with
  `status='pending'` and sits in `/admin/calibration` until a logged-in
  admin clicks Approve or Reject. Approve is the only code path that
  writes the new value; reject just records the decision.
- Skips generating a new recommendation for a resort while one is still
  pending, so they don't pile up unreviewed.

**Why this no longer has to wait out a live season**: the operator asked
directly whether historical data could pre-train/validate the model ahead
of a live season. The honest answer worked through in conversation and
built here: there's no literal "pre-training" since this isn't an ML
model, but you don't need to already know what was predicted historically
to generate real calibration signal — run historical weather data through
the *existing* scoring logic yourself, compare the output to what actually
happened, and that comparison is exactly the same `accuracy_log` shape the
live pipeline produces. Two pipelines do this, covering different parts of
the system and different depths of history (see `lib/backtest/` for full
header-comment detail on each, including the honest limitations):

- **`lib/backtest/slr-reanalysis.ts`** — validates ONLY the SLR conversion
  (Kuchera formula) against ERA5 reanalysis data (`archive-api.open-meteo.com`,
  back to 1940). Reanalysis is retrospective truth, not a forecast made in
  advance, so it can't exercise multi-model reconciliation — but the SLR
  formula only needs temperature + precipitation, which reanalysis has in
  depth no forecast archive comes close to. Run via
  `npm run backtest:slr-reanalysis -- --years=N`.
- **`lib/backtest/reconciliation-forecast-archive.ts`** — validates the
  FULL pipeline (reconciliation + SLR) via the exact same
  `computeScoreFromInputs` pure function the live cron calls, against
  real archived model forecasts (`historical-forecast-api.open-meteo.com`),
  which do preserve genuine forecast uncertainty. Much shallower (~2021+,
  varies by model; HRRR has no archive coverage at all and is excluded).
  One real, stated limitation: the archive is a stitched continuous
  series, not the full original lead-time spectrum, so this approximates
  a short-lead regime at a documented nominal lead time rather than
  claiming to validate the T48_120/T120_PLUS weight buckets specifically.
  Run via `npm run backtest:reconciliation -- --years=N`.

Both write to `accuracy_log` under their own `source` tag
(`slr_reanalysis_backtest` / `reconciliation_forecast_backtest`, see
`AccuracyLogSource` in `lib/db/types.ts`) — visible on their own in
`/admin/backtest`'s "Pre-season historical backtest" section, kept
separate from the live powder_alert-vs-NWS comparison so backtest numbers
are never mistaken for live operational ones. `generateCalibrationRecommendations`
(`lib/calibration/generate.ts`) pools both sources in alongside live data
— see `CALIBRATION_BACKTEST_SOURCES` in `lib/config/constants.ts` for the
one acknowledged methodological wrinkle (reanalysis-backtest samples
measure SLR-only error; live and reconciliation-backtest samples measure
end-to-end error including reconciliation noise — pooled as a reasonable
approximation, not a perfectly clean blend, acceptable given Phase B stays
bounded and human-approved regardless of which source proposed a change).

**What's still genuinely gated on Phase 0**: both backtest scripts need
live Supabase (somewhere to write) and live network access to Open-Meteo's
archive hosts and the NRCS AWDB API — none of which exist in this sandbox.
Nothing left to build here; this is "run the scripts after you deploy,"
not "build more code."

**What else could self-tune later, not in scope now**:
`ALERT_POWDER_SCORE_THRESHOLD`, the `POWDER_SCORE_WEIGHTS` split, and
`ENSEMBLE_CONFIDENCE_THRESHOLDS` are also just named constants today — same
pattern would apply, but they're riskier to auto-tune than a per-resort SLR
multiplier since they affect every resort's alert-firing behavior at once.
Don't touch these until the per-resort SLR case has run a full season on
recommend-only and you're comfortable with how it behaves. Graduating
individual resorts from recommend-only to auto-apply (with a visible log)
is a future decision, not a default — nothing in this codebase does that
today.

---

## Phase B.1 — Model versioning (save, compare, roll back)

**Status: ✅ built.** `supabase/migrations/0007_model_versions.sql` +
`0008_accuracy_log_version_key.sql`, `lib/scoring/config.ts`,
`lib/model-versions/{resolve,create,activate,compare}.ts`,
`/admin/model-versions`, `/api/admin/model-versions*`. 11 new unit tests
(config-override paths on `reconcileModels`/`scoreEnsembleConfidence`/
`computePowderScore`, the `scoringConfig`/`modelVersionId` passthrough on
`computeScoreFromInputs`, and `lib/scoring/config.ts`'s round-trip).

Requested directly, after Phase B's calibration mechanism was already
live: *"include a dashboard with admin controls so it's not fully
automated — human input and rollback options as well as comparison
between model states — make the website 'save' previous model versions
which can be run and viewed from the admin dashboard."* Before this, the
scoring engine's tunable parameters (multi-model reconciliation weights,
SLR strategy choice, powder-score weights, confidence thresholds) were
hardcoded constants, and approving a calibration recommendation silently
overwrote `resorts.slr_calibration_multiplier` with nothing to undo it
with. Both are now versioned.

**What a "model version" is, precisely**: a named, timestamped,
DB-stored snapshot of `lib/scoring/config.ts`'s `ScoringConfig` shape
(model weights by lead-time bucket, model-disagreement threshold,
ensemble-confidence thresholds + spread-normalization ceiling, SLR
strategy name, powder-score weights, confidence weight by label,
actionable window, lead-time-fit decay) plus a `resort_id ->
slr_calibration_multiplier` snapshot. Deliberately **not** included:
Kuchera's own internal physics constants (threshold temperature, slopes)
— those stay fixed, literature-grounded code, not an admin-tunable
business parameter. Exactly one version has `status='active'` at a time
(DB-enforced via a partial unique index), which is what live scoring and
the backtest scripts read by default.

**How it was built to not break anything already working**: every pure
scoring function that previously read a hardcoded constant
(`reconcileModels`, `scoreEnsembleConfidence`, `computeLeadTimeFit`,
`computePowderScore`) now takes an *optional* config-override parameter
that defaults to the existing compiled-in constants when omitted. Every
one of the ~150 pre-existing tests that didn't pass this parameter kept
passing unchanged — this was additive, not a rewrite. `computeScoreFromInputs`
(the pure function both live scoring and both backtest pipelines already
shared, from an earlier refactor) now resolves `inputs.scoringConfig ??
DEFAULT_SCORING_CONFIG` once and threads the relevant piece into each
downstream call, and echoes `modelVersionId` straight onto its result as
pure bookkeeping — not read by the computation, just carried along so
callers can persist which version produced a given score without a
second round trip.

**`lib/model-versions/`** — the service layer:
- `resolve.ts` (read-only): `getActiveModelVersion`, `getModelVersionById`,
  `listModelVersions`, and `getActiveScoringConfig()` — what
  `lib/scoring/run.ts` calls on every live scoring run, falling back to
  `DEFAULT_SCORING_CONFIG` with `versionId: null` if no version has ever
  been activated yet (a fresh deploy before `seed:resorts` has run) —
  live scoring never breaks for lack of a DB row.
- `create.ts`: `createModelVersion` (always a draft unless told
  otherwise) and `createBaselineVersionIfNoneExists()` — idempotent,
  seeds+activates "v1 — baseline" from the hardcoded defaults and every
  resort's current SLR multiplier the first time anything calls it.
  Wired into `scripts/seed-resorts.ts`, and called defensively again
  wherever something needs to branch off "the current version" (calibration
  approval, the create-draft API route) so none of those paths can ever
  throw on a brand-new deploy for lack of a baseline.
- `activate.ts`: the **one** function that changes what live scoring
  actually does. Archives whichever version is currently active (if any),
  activates the target, and writes its `resort_slr_multipliers` snapshot
  back onto the live `resorts` table. Deliberately **the same code path
  for both promoting a draft and rolling back** — "activate an older
  version" *is* the rollback, there's no separate undo operation to get
  wrong. Not wrapped in a DB transaction (consistent with the rest of
  this codebase, which doesn't use them anywhere) — there's a brief
  window with zero active versions between the archive-old and
  activate-new writes, made harmless by `getActiveScoringConfig`'s
  default-config fallback if a scoring run ever landed exactly inside it.
- `compare.ts`: `compareModelVersions(versionIds[])` — a **read-only
  aggregation** over `accuracy_log` rows already tagged with
  `model_version_id` by live scoring or a backtest run. Not a live
  re-run. A version with zero samples just means it's never been active
  or backtested under — the UI says so rather than showing a misleading
  zero.

**Calibration approval now creates a rollback point instead of a silent
overwrite** (`lib/calibration/apply.ts`): approving a recommendation
still takes effect immediately, same one-click UX as before — but it now
creates a new `model_versions` row (parent = whichever version was active,
global config unchanged, just this one resort's multiplier updated) and
activates it, instead of writing directly to `resorts.slr_calibration_multiplier`
with nothing to undo. "Undo this calibration change" is now just
activating the parent version again from `/admin/model-versions`.

**Backtesting a draft before activating it live** — the actual mechanism
behind "comparison between model states": both
`npm run backtest:slr-reanalysis` and `npm run backtest:reconciliation`
now accept `--version=<model_versions.id>`. Without it, they run under
whichever version is currently active (same as live scoring); with it,
they run a historical backtest *as if that draft were already live*,
tagging every `accuracy_log` row they write with that version's id — so
its accuracy stats show up in the comparison view without ever having
touched production scoring. (This needed a schema change too — migration
`0008` widens `accuracy_log`'s uniqueness to include `model_version_id`,
since the old 4-column key would have let a second version's backtest
silently overwrite the first's rows for the same resort/date instead of
producing a second, comparable one.)

**`/admin/model-versions`**: lists every version with status (draft/
active/archived), lineage (parent), SLR strategy, and who created it.
One button does double duty as "Activate" (draft → live) and "Roll back"
(archived → live again) — same endpoint, same confirmation-free
single click, matching `activateModelVersion`'s own "one code path"
design. "Duplicate" branches a new draft off any existing row (not just
the active one). The new-draft form clones the source version's config
as pretty-printed JSON into a textarea rather than ~20 individual numeric
inputs for every nested weight/threshold — a deliberate scope call for
what's an admin-only internal tool: the API route validates the shape
with `zod` before anything is persisted, so a malformed edit is rejected
server-side, not silently accepted. Comparison is checkbox-select across
the list, submitted as a plain GET form (`?compare=id1&compare=id2`,
bookmarkable, no client JS required) rendering `compareModelVersions`'s
output — sample count, MAE, hit rate — per selected version.

**Verified**: a temporary `/preview-model-versions` fixture route (fixture
`ModelVersion` rows covering draft/active/archived and a 3-generation
parent chain, no DB/Clerk) rendered the real components, screenshotted via
`playwright-core` at desktop and mobile widths — list view, the create-
draft form open, and the compare view with a zero-sample draft rendering
`—` instead of a misleading `0%`. Found and fixed two small polish issues
this way (the "running now" status pill and the "Roll back" button both
wrapped awkwardly onto two lines in the Action column — fixed with
`white-space: nowrap` and a shorter button label). Also clicked the real
Activate button against the real (unconfigured, no live Clerk) API route
to confirm the request actually round-trips and the client component
renders the resulting 403 inline, not just that the static layout looks
right. Removed before commit, same as every other preview route this
project has used.

**What this deliberately doesn't do**: no scheduled or automatic
activation anywhere — every activation is an explicit admin click, which
is the literal "not fully automated" requirement. No side-by-side raw-
config diff between two versions (the comparison view is accuracy stats,
not a config diff) — a reasonable follow-up if it's ever wanted, flagged
here rather than silently missing. No way to edit per-resort SLR
multipliers from the new-draft form — that stays governed by the
calibration-recommendation flow specifically, so there's exactly one
place a resort's multiplier can change, not two paths that could
disagree.

---

## Phase B.2 — Parallel model scoring ("shadow mode")

**Status: ✅ built, dormant until you shadow a draft.**
`supabase/migrations/0009_shadow_scoring.sql`,
`lib/scoring/slr/kuchera-wind.ts`, `lib/model-versions/shadow.ts`,
`lib/scoring/run.ts`, `/admin/model-versions`. 13 new unit tests
(`kuchera-wind.test.ts`'s 9, one `computeScoreFromInputs` integration
test, 3 for `shadowCalibrationMultiplier`).

Requested directly: *"can you produce multiple models and in season 1 we
can run them parallel and compare? (Build in compare)"* Phase B.1 already
let you save, activate, and retrospectively compare model versions — but
only one version could ever be **live** at a time; comparing a second one
meant backtesting it separately or waiting to activate it later, never
scoring it against the exact same storm, the exact same day, as the
version actually facing the public. This phase closes that gap: any
number of draft versions can now be scored in parallel with the active
one, every cron run, all season, with zero risk to what subscribers see
or what triggers an alert.

**The core distinction: `active` vs. `is_shadow`.** A model version is
either the one production path (`status = 'active'` — public site,
alerts, the thing Phase B.1 already built) or a parallel comparison-only
run (`is_shadow = true`) — never both, enforced by a DB CHECK constraint
(`model_versions_active_not_shadow`) rather than just application logic,
so this can't drift into an unsafe state even from a direct DB edit or a
future code change that forgets to check. `activateModelVersion` now also
clears `is_shadow` on whatever it activates, so promoting a version
that's currently shadowing can't violate the constraint it's about to
satisfy a different way.

**Why this needed more than "run the scoring function twice"**: every
place that read `snow_scores` or `accuracy_log` by picking "the latest
row for this resort/date" — the public site (`lib/public/resort-scores.ts`),
the alert trigger (`lib/alerts/trigger.ts`), and the accuracy summary
(`lib/backtest/accuracy.ts`) — had no concept of "which version wrote
this row," because until now there was only ever one row per resort/date.
The instant a shadow version starts writing its own rows alongside the
active one, those three call sites would non-deterministically serve,
alert on, or average in whichever row happened to sort first — including,
in the worst case, an experimental shadow score triggering a real
subscriber notification. Fixed with one new boolean, `is_primary`, added
to both `snow_scores` and `accuracy_log` and set at write time (`true`
for the active version's row, `false` for every shadow row). All three
call sites now filter `.eq("is_primary", true)` before picking "the
latest row" — a shadow version's output literally cannot reach a
subscriber or skew the live accuracy report, by construction, not by
convention. The pure comparison logic in `lib/alerts/trigger.ts`
(`selectCurrentBestQualifyingScore`) was deliberately left untouched —
filtering happens one layer up, at the query, before shadow data ever
reaches it.

**`lib/scoring/run.ts`'s orchestrator, rewritten to share inputs instead
of duplicating ingestion reads**: `runScoringForAllResorts` now resolves
the active config and the full list of shadow versions *once* at the top
of the run (`getActiveScoringConfig()`, `listShadowModelVersions()`),
then for each resort/date fetches `modelRuns`/`ensembleMemberTotals`/
`seasonalMaxSnowfallIn` *once* and reuses that same fetched data for the
active config's score **and** every shadow version's score. A season
with, say, 3 shadow versions running does not mean 4x the Open-Meteo/
SNOTEL read volume — only 4x the (cheap, in-memory) scoring computation.
Each shadow score is computed with `computeScoreFromInputs` using that
shadow's own `toScoringConfig(shadow)` and a new exported helper,
`shadowCalibrationMultiplier(shadow, resort)`, which uses the shadow
version's own snapshotted per-resort SLR multiplier when it has one and
falls back to the resort's live multiplier otherwise — the exact same
fallback semantics `activateModelVersion` and the backtest scripts'
`--version` flag already established, not a new convention.

**`lib/backtest/accuracy.ts`'s accuracy logging, rewritten per-version**:
previously picked the single newest `snow_scores` row for a resort/date
and logged one `accuracy_log` row from it. With shadow scoring, a given
`computed_at` run can produce several rows for the same resort/date (one
per version scored that run) — the old logic would have picked one of
them at random and silently dropped the rest, defeating the entire point
of running them in parallel. `logPowderAlertAccuracy` now fetches every
`snow_scores` row sharing the latest `computed_at` for that resort/date
and logs one `accuracy_log` row per version, each tagged with its own
`model_version_id` and `is_primary`. Returns `{matched, skipped}` counts
instead of a single string so the caller's totals stay accurate across
however many versions ran.

**The second model to actually shadow: `kuchera-wind`**
(`lib/scoring/slr/kuchera-wind.ts`). The existing Kuchera SLR strategy
only looks at temperature; `kuchera-wind` applies the same base formula
and then derates the ratio with a simple linear wind-speed adjustment
(floor at 60% of the unadjusted ratio, so it bends but can't collapse the
estimate at extreme wind). **This is explicitly an engineering hypothesis,
not a reproduction of a published model.** The background research this
session confirmed real literature supports the *direction* (wind-driven
snow densification is real, and a follow-up to the paper this codebase's
Kuchera coefficients already cite found that a model using wind
outperforms a temperature-only one) — but the actual published
regression coefficients were never retrievable (WebFetch was blocked to
every candidate source all session), so rather than fabricate numbers and
attribute them to that paper, the adjustment uses small, named, clearly
documented constants (`WIND_SLR_ADJUSTMENT_PER_KMH`,
`WIND_SLR_ADJUSTMENT_FLOOR` in `lib/config/constants.ts`) with a header
comment saying plainly that they're a conservative placeholder, to be
judged on this season's own shadow-scored accuracy data, not assumed
correct in advance. If missing wind data ever reaches it, it returns the
unadjusted Kuchera ratio rather than guessing — "missing data means no
claim," the same convention the rest of this scoring engine already
follows.

**How to actually use this, this season**: from `/admin/model-versions`,
create a new draft (the existing "New draft" form from Phase B.1) with
`slrStrategyName: "kuchera-wind"` and otherwise the same config as the
active version, then click its new "Start shadowing" toggle. From the
next cron run on, it scores every resort/date alongside the active
version with zero further action needed. Check in on it anytime with the
existing compare view (checkbox-select the active version and the shadow
version, submit) — no new UI was built for this because the Phase B.1
compare view already does exactly this job once both versions have
`accuracy_log` samples tagged with their own `model_version_id`. Toggle
"Shadowing — stop" to retire a comparison without deleting its history.
You can shadow more than one draft at once if you want a 3+-way season
comparison — nothing in this design assumes exactly two.

**Verified**: the new `is_primary`/`is_shadow` plumbing was traced through
by reading `trigger.ts`, `run.ts`, and `resort-scores.ts` in full before
writing any code, specifically looking for every "pick the latest row"
read path a second row-per-date could silently break — not just the ones
already suspected. The new admin "Parallel scoring" column was verified
visually via a temporary `/preview-shadow-column` fixture route and
`playwright-core` screenshots covering all three states (shadowing, not
shadowing, and the active version's disabled "scored live" state),
removed before commit. `npx tsc --noEmit`, `npx vitest run` (176/176),
and `npx next build` all clean as of this update.

**What this deliberately doesn't do**: no automatic promotion of a shadow
version to active, however well it scores — that's still Phase B.1's
explicit, human-click activation, on purpose. No weighting or blending of
a shadow version's output into the active one's alerts — shadow scores
are comparison-only data, never a live input. No limit on how many
versions can shadow at once, but also no UI warning if you shadow so many
that `/admin/model-versions`'s compare view gets hard to read — a
reasonable follow-up if a season ever actually produces that problem.

---

## Phase B.3 — Per-resort model precision

**Status: ✅ built, dormant until you differentiate a resort.**
`supabase/migrations/0010_resort_scoring_overrides.sql`,
`resolveScoringConfigForResort` + `partialScoringConfigToResortOverride`
in `lib/scoring/config.ts`, an optional `resortId` filter on
`compareModelVersions`. 14 new unit tests (11 for
`resolveScoringConfigForResort`'s merge semantics, 3 for the camelCase ->
snake_case converter the admin API route uses).

Requested directly, immediately after a design discussion about whether
model weighting should vary by resort at all: *"I want the model to be as
precise as possible so code the individual resorts I don't mind the
additional computational load up front."* The discussion itself is worth
recording because it shaped the scope: real numerical-weather-model skill
varies by terrain/climate regime (convection-allowing models like HRRR
tend to earn their keep in complex orographic terrain and add less in
coastal/marine settings where large-scale forcing dominates), and
different snow climates ("Cascade concrete" vs. Utah's low-density powder
vs. Northeast coastal snow) are plausibly different enough that even SLR
strategy choice shouldn't be forced identical across the whole roster —
but the honest answer on "how advantageous" also flagged a real cost:
granularity fights sample size, and 51 independently-tunable resorts
divides `accuracy_log` history 51 ways. The user's call, explicitly: go
all the way to per-resort anyway, computational cost accepted. (In
practice the computational cost turned out to be close to zero — see
below — so this wasn't actually a tradeoff, just a correct call either
way.)

**What was already per-resort vs. what wasn't, precisely** (this was
checked against the actual code before building anything, not assumed):
exactly one field was already per-resort — `resorts.slr_calibration_multiplier`,
a single scalar (Phase B/B.1). Every other field in a model version's
`ScoringConfig` — `modelWeightsByBucket` (which weather models to trust
at which lead time), `slrStrategyName`, confidence thresholds,
powder-score weights — applied uniformly to all ~51 resorts under that
version. This phase generalizes the existing per-resort-multiplier
*pattern* to the rest of the config, rather than inventing a new one.

**The mechanism**: `model_versions.resort_scoring_overrides` is a
`resort_id -> PARTIAL ScoringConfig` map (`ResortScoringOverride` in
`lib/db/types.ts` — every field optional). `resolveScoringConfigForResort(version,
resortId)` starts from that version's own global config
(`toScoringConfig(version)`, NOT `DEFAULT_SCORING_CONFIG`) and overlays
only the fields the resort's override actually sets, field by field — a
resort that overrides just `slrStrategyName` still gets that version's
own `modelWeightsByBucket`, not a reset to compiled-in defaults. A resort
absent from the map (the default state for every resort on every new
version, including the baseline) resolves to exactly that version's
global config — this function is a pure superset of `toScoringConfig`,
never a behavior change until a human deliberately differentiates a
resort.

**Wired into every place a version's config gets used, not just live
scoring** — this was the main implementation risk, since the project
already has four separate call sites that each independently resolve "the
config for this version," and missing one would have made per-resort
precision silently partial:
- `lib/scoring/run.ts`: `runScoringForAllResorts` (the live cron) now
  resolves the active `ModelVersion` row once, then calls
  `resolveScoringConfigForResort` INSIDE the per-resort loop for both the
  primary score and every shadow version's score — same "fetch shared
  inputs once, resolve config per resort" shape the Phase B.2 work
  already established, just one more axis of per-resort resolution
  layered on top. `computeScoreForResortDay` (the single-resort wrapper)
  got the identical fix for consistency, even though nothing currently
  calls it over the batch path.
- Both historical backtest scripts (`scripts/backtest-slr-reanalysis.ts`,
  `scripts/backtest-reconciliation-forecast-archive.ts`) resolve the
  target `ModelVersion` once (active or `--version=<id>`), then compute
  each resort's effective `slrStrategyName`/`scoringConfig` INSIDE their
  own existing per-resort loops — so backtesting a draft under
  `--version` now honors that draft's per-resort overrides too, not just
  its global config.
- `getActiveScoringConfig()` (the old global-only resolver) is deleted,
  not deprecated — once every caller needed per-resort resolution, a
  resort-oblivious version of the same lookup had no remaining callers
  and no reason to keep existing as a trap for a future caller to use by
  mistake. `getActiveModelVersion()` (already existed) plus
  `resolveScoringConfigForResort` replace it everywhere.

**On "additional computational load"**: resolving a config per resort
turned out to be a cheap in-memory object merge, not a new source of
ingestion reads or DB round trips — `resolveScoringConfigForResort` takes
the already-fetched `ModelVersion` row (fetched once per run, same as
before this phase) and a resort id, and returns a plain object. The real
cost of parallel per-resort precision was already paid by Phase B.2's
shared-inputs design (fetch each resort/date's forecast data once, reuse
across every version scored against it) — this phase rides on top of
that for free. The only thing that scales with how many resorts get
differentiated is how many *distinct* config shapes exist in memory
briefly during a run, not how much work gets done.

**Admin UI** (`/admin/model-versions`): the new-draft form gained a
second, optional JSON textarea — "Per-resort overrides" — pre-filled from
the source version's own snapshot (empty object = the common case), same
deliberate "raw JSON, not N resorts' worth of individual inputs" scope
call already made for the main config textarea (Phase B.1). Validated
server-side with the same `scoringConfigSchema` made `.partial()`, so a
malformed per-resort edit is rejected, not silently accepted. Unlike
`resort_slr_multipliers` (always cloned server-side, never request-
settable — that field stays governed by the calibration-recommendation
flow), `resort_scoring_overrides` CAN be set directly from this form:
there's no competing dedicated approval flow for it yet, so this form is
the one place to set it. The comparison view gained an optional resort
filter (a `<select>`, GET param, bookmarkable like the rest of that
view) backed by a new optional `resortId` parameter on
`compareModelVersions` — lets you check whether an override is actually
helping the resort it targets, not just the all-resorts blend, which is
the whole point of being able to set one.

**Verified**: a temporary `/preview-model-version-overrides` fixture
route (two fixture versions, one with a populated `resort_scoring_overrides`
map, three fixture resorts) rendered the real components —
`ModelVersionCreateForm` with the new textarea pre-filled, the resort
filter `<select>`, and the comparison table actually swapping between a
fixture "all resorts" summary and a fixture "Alta only" summary when the
`resortId` query param changed — screenshotted via Playwright at both
states. Confirmed the filter mechanism end-to-end at the UI layer before
trusting the real DB-backed query to do the same. Removed before commit,
`git status` confirmed clean, same discipline as every other preview
route this project has used.

**What this deliberately doesn't do**: ships zero fabricated per-resort
differentiation — every version's `resort_scoring_overrides` defaults to
`{}` for every resort, including retroactively for every version that
existed before this migration. This is a capability, not 51 invented
configs; the project's standing rule against presenting a guess as a
verified figure applies here exactly as it did to `kuchera-wind`'s
constants. No bulk/guided way to set many resorts' overrides at once
(e.g. "cluster the roster into climate regions and set them together") —
each resort's override is edited individually in the raw-JSON textarea;
a clustering UI is a reasonable follow-up if the roster's real accuracy
data ever suggests specific regional groupings worth codifying, but
inventing those groupings now, without evidence, is exactly the kind of
guess this project avoids.

---

## Phase C — Autonomous dev-iteration loop (Claude Code)

**Status: ⬜ designed, not activated. Opt-in — tell me when you want this turned on.**

Separate from the product itself: a recurring Routine that wakes a Claude
Code session on a schedule with standing instructions to keep pushing this
codebase toward operational readiness and, later, toward Phase B — without
you prompting each time.

**What it would plausibly do each run:**
- Run `npm run typecheck`, `npm run test`, `npm run build` — fix anything broken.
- Check `/admin/backtest` (once live data exists) for accuracy regressions
  or data gaps (e.g. a resort's SNOTEL ingestion silently failing).
- Pick up the next unchecked *code* item from Phase 0/A — never an
  account-provisioning step only you can do.
- Push commits directly to this branch (no PR review loop exists on this
  repo currently — same as this session has been doing).

**What it should NOT do without asking first** — same bar this session
already follows:
- Touch `calibration_recommendations` approval — that's Phase B's human
  gate, not something a dev loop should route around.
- Change the Instagram-posting human-gate in Phase A.
- Any destructive git operation, force-push, or schema migration that
  drops/renames a column with existing data.

**Cost note, since this came up before in this project**: a recurring
Routine firing into a fresh session every run consumes usage each time.
Before activating this, worth deciding a cadence (daily check-in vs.
weekly) rather than defaulting to something aggressive — say go and a
cadence and I'll set it up.

---

## Phase D — Visual design / UI polish

**Status: 🟡 first pass done** (public site + social graphic + resort map). Admin panel got a light consistency pass (new color tokens, branding), not a full redesign — still the lower priority per the plan below. Verified in an actual headless browser, not just "looks right in code" — see Session log.

Added after the operator asked "is interface/UI on our roadmap?" and the
honest answer was no — PART_1 built a functionally complete public site
(`src/app/page.tsx`, `src/app/resorts/[slug]/page.tsx`) and admin panel
(`src/app/admin/*`), but both were placeholder-grade: one hand-written dark
CSS file, no component library, no responsive testing, no branding, never
looked at in an actual browser with real data. That was a real gap for a
product whose own positioning (BUILD_PRIMER section 10.5) leans on public
transparency as a trust-building feature — "no paywall" doesn't land if
the page people see first looks unfinished.

**What's done:**
- A real design system — CSS custom-property tokens in `globals.css`
  ("alpine night" palette: deep navy background, icy-blue accent,
  green/amber/slate confidence colors), Inter via `next/font/google`.
- The public homepage (`src/app/page.tsx`): hero section with live
  stats (resorts tracked / with signal / top score), redesigned resort
  cards (`src/components/resort-card.tsx`, now a reusable presentational
  component), restyled subscribe form.
- The resort detail page (`src/app/resorts/[slug]/page.tsx`): redesigned
  score table (`src/components/score-table.tsx`), including a mobile
  layout that transforms the table into stacked cards via CSS
  `data-label` attributes rather than just shrinking an unreadable table.
- The auto-generated social graphic
  (`src/app/api/admin/graphic/[alertId]/route.tsx`) — matches the same
  palette, confidence-colored glow, a brand mark drawn in pure CSS
  (tried a snowflake emoji/glyph first; Satori's default font silently
  drops it — confirmed by rendering in isolation before committing to
  the CSS-drawn approach instead).
- Admin panel: hardcoded hex colors swapped for the new design tokens
  (`src/components/post-approval-panel.tsx`,
  `src/components/calibration-review-row.tsx`, and the backtest/
  calibration/alert-detail admin pages) so it doesn't look visually
  inconsistent with the redesigned public site, plus branding in the
  admin layout header. Not a full redesign — still lower priority, per
  the original plan.
- **Interactive US resort map** (`src/components/resort-map.tsx`),
  requested directly: "We need a map UI of the US w the resorts we have
  overlayed on there it should be scrollable/scalable/zoomable." Renders
  on the homepage above the resort grid — pan (drag), zoom (scroll wheel
  or +/−/reset buttons, 1x-8x), one marker per tracked resort color-coded
  by that resort's best-upcoming-day confidence label, click-through to
  the resort's detail page, hover/tap side panel with the resort's
  current best score. Built with `react-simple-maps` + `us-atlas` +
  `d3-geo`'s `geoAlbersUsa` projection instead of the primer's named
  Mapbox (section 3, listed as optional/low-priority): Mapbox needs an
  API key that was never provisioned (Phase 0), and its tile servers
  aren't reachable from this sandbox's egress proxy regardless, so a
  Mapbox integration couldn't have been verified working at all. The
  chosen stack renders from a local topology file
  (`public/us-states-10m.json`, copied from the installed `us-atlas`
  package) — zero API key, zero runtime network call, $0 forever, fully
  testable in-sandbox, and correctly places Alaska/Hawaii via the same
  shared projection used for both the state outlines and the resort
  markers. Documented in the component's own header comment; swappable
  later if a provisioned Mapbox key ever makes richer basemap imagery
  worth the cost — nothing else in the codebase depends on this specific
  map implementation.
- **Resort detail page — snowfall chart, conditions visuals, webcam**,
  requested directly: "we need to go deeper on the individual resorts...
  visuals (charts, etc, not just numbers)." Four additions to
  `src/app/resorts/[slug]/page.tsx`:
  - A custom SVG bar chart (`src/components/snowfall-chart.tsx`, no
    charting library — same judgment call as the map, simple enough to
    hand-roll on the existing design tokens) spanning past week
    (observed) + today + next 5 days (predicted), each bar labeled with
    its value, today visually highlighted. The past/future split is a
    genuinely different data source on each side — observed SNOTEL snow
    depth for the past, our own reconciled forecast for the future —
    unified into one chart by a pure assembly function
    (`src/lib/public/snowfall-timeline.ts`) so the component itself
    doesn't need to know where any bar's number came from.
  - A "Conditions" strip (`src/components/conditions-strip.tsx`) —
    glanceable per-day cards for temp, a cloud-cover bar, wind
    speed/gust, SLR, and a wind-hold badge — plus the same fields added
    as columns to the existing `ScoreTable` for full numeric detail.
  - A **wind-hold-probability estimate** (`src/lib/scoring/wind-hold.ts`),
    requested directly: "if we can factor in some kind of wind hold
    probability calculation as well that would be good." This codebase
    has no per-resort/per-lift wind-hold policy data — nothing publishes
    that — so it's a documented, generic logistic curve over forecast
    wind gust (constants + full rationale in
    `src/lib/config/constants.ts`), labeled as an estimate in the UI,
    never a guarantee.
  - A **webcam embed** (`src/components/webcam-embed.tsx`), requested
    directly: "putting the resort webcams embedded into each page, pull
    from resort pages." Same judgment call as Mapbox: automated scraping
    of ~40+ different resort sites' webcam pages is exactly the
    scraping-at-scale tradeoff already declined once this session for
    OpenSnow (see "On OpenSnow" below) — not a one-time build, an
    ongoing maintenance burden against sites this project doesn't
    control. Instead `resorts.webcam_url` is an operator-curated field
    (same pattern as `elevation_base_m`), iframed directly when present
    — most resorts already publish an embeddable webcam page or player,
    so this respects their existing infrastructure rather than
    re-hosting it. An "Open directly ↗" link covers the case where a
    site's frame policy blocks iframing. Every resort currently has
    `webcam_url = null` until an operator populates it.

  Building this surfaced two more real bugs, same class as the
  UTC-vs-local one already fixed this session: `lib/scoring/run.ts`'s
  `nextNDates` generated the scoring orchestrator's entire target-date
  list from UTC "today" (once, shared across every resort regardless of
  timezone) rather than each resort's own local "today" — for roughly
  6-7 hours of every single day (the window after UTC midnight but
  before a US resort's own local midnight), it silently skipped
  generating *today's* score entirely. `lib/public/resort-scores.ts`'s
  `getUpcomingScoresForResort` had the identical root cause on the read
  side. Both fixed by resolving "today" from the resort's own timezone
  (`localTodayIso`) instead of `new Date().toISOString()` — see
  README.md's "Real bugs found by code review" for the full writeup and
  a test that reproduces the exact Eastern/Pacific/UTC discrepancy.

**How it was actually verified**: there's still no live Supabase, so
temporary preview routes (`/design-preview` for the cards/table work,
`/map-preview` for the map, `/resort-preview` for the detail-page
visuals) rendered the same presentational components
against realistic fixture data — all three removed once verification was
done, never shipped. Screenshotted via `playwright-core` against the
pre-installed Chromium at desktop (1440px) and mobile (390px) widths,
actually looked at the images, found and fixed four real problems that
way: the glow effect looked like a hard-edged flat circle, not a soft
glow — fixed with a radial-gradient instead of solid-color + opacity;
the social graphic's snowflake glyph silently failed to render —
switched to a pure-CSS mark; the map's markers triggered a React
hydration-mismatch warning from sub-pixel floating-point differences
between the server's and client's `geoAlbersUsa` projection math (same
math, different last couple of digits) — fixed by disabling SSR for
just that component (`src/components/resort-map-loader.tsx`, a
`next/dynamic(..., { ssr: false })` wrapper), which also shrank the
homepage's own JS bundle since the map library now code-splits into a
separate lazy-loaded chunk instead of shipping in the main bundle; the
webcam embed's "Open directly ↗" link rendered as the literal text
`&nearr;` instead of an arrow — not every named HTML entity is
decoded in JSX text content (the common ones used elsewhere on the
site, `&larr;`/`&middot;`/`&rsquo;`, are; this less-common one wasn't)
— fixed by using the literal Unicode arrow character directly instead
of relying on entity decoding. (The webcam iframe itself renders blank
in this sandbox — confirmed separately that the sandbox's headless
browser has no outbound route to youtube.com at all, same egress
restriction as every other external domain this session, not a bug in
the component; it'll render normally once deployed somewhere with real
outbound internet.) This is the same "verify in a real browser before
calling it done" standard the project's own instructions ask for, not
just "the code looks plausible" — none of these four would have
surfaced from reading the component source alone.

- **Admin panel full pass** (not just the earlier color-consistency
  swap): a persistent nav (`src/app/admin/layout.tsx`, tabs for
  Dashboard/Forecast accuracy/SLR calibration — there was none before,
  every page required typing a URL directly), a dashboard stat row
  (active resorts, alerts fired in the last 30 days, pending calibration
  reviews, `src/app/admin/page.tsx`), a reusable `StatusBadge`
  (`src/components/status-badge.tsx`) replacing raw status strings for
  delivery/social-post status everywhere, `ConfidenceBadge` applied to
  the alert detail page, and a "beating NWS / even / behind" comparison
  badge on the backtest table (`src/app/admin/backtest/page.tsx`) so the
  public-baseline comparison reads as a visual signal, not just two
  columns of numbers to mentally subtract. This was the one item Phase D
  had explicitly deprioritized earlier ("lower priority, one operator
  not a public audience") — picked up once the public-facing work was
  done, since it was the only remaining non-blocked, non-opt-in item
  left in the whole roadmap. Same verification discipline as the rest of
  Phase D: a temporary `/admin-preview` fixture route (bypassing the
  Clerk gate with fixture data, since there's no live Clerk/Supabase
  either) rendered every new piece, screenshotted via `playwright-core`
  at desktop and mobile widths, then removed — no new bugs found this
  pass.

**Still open**: the product name itself (BUILD_PRIMER section 0,
"rename TBD") — the current design uses "powder-alert" as a working
brand, which is low-cost to swap for a real name/logo later since
nothing about the visual system depends on this specific name.

- **"Less AI-generated" pass**, requested directly — the operator's own
  words: the first-pass design was functional and consistent, but had
  accumulated several tells that read as generic AI-SaaS-template rather
  than a considered product, mostly from leaning on the single most
  common default choice at each decision point rather than one actually
  suited to this subject. Fixed, each with a specific reason tied to
  what this product is:
  - **Inter for everything** (headings, body, numbers alike) — probably
    the single most recognizable "AI-generated site" font signal at this
    point, since it's the path-of-least-resistance default. Replaced
    with a 3-tier system instead of one do-everything font: body text
    now rides the OS's own UI font (`-apple-system`/`Segoe UI`/etc, see
    `--font-sans` in `globals.css`) rather than importing a webfont for
    it at all; headings get Space Grotesk, a distinct display face
    (`src/app/layout.tsx`); numeric readouts — scores, snowfall, wind,
    temps — get JetBrains Mono (the `.font-mono` utility and a handful
    of specific selectors in `globals.css`), a deliberate choice, not a
    decorative one: this is a forecast-data product, so figures reading
    like instrument-panel numerals (fixed-width, tabular) fits the
    subject rather than just being styled body text.
  - **The radial-glow-from-top-center hero background** — close to a
    template signature of its own at this point (nearly every
    AI-generated SaaS landing page has one). Replaced with a faint
    topographic contour-line texture tiled across the whole page
    (`body`'s `background-image` in `globals.css`, a hand-built seamless
    SVG tile, no new asset file) — ties to the actual subject (terrain,
    mountains) instead of being generic "product launch page" chrome.
  - **An emoji-in-a-rounded-square brand mark** (❄ on a tinted
    background) — a recognizable "placeholder logo" pattern. Replaced
    with a small drawn geometric mark (`src/components/brand-row.tsx`,
    six lines of inline SVG: an angular peak with a storm-line through
    it) — simple enough to have taken two minutes, but it's a considered
    shape instead of a stock emoji in a box.
  - **Badges as filled pill chips with a bullet dot and uppercase
    tracked-out text** — confidence/status/wind-hold labels all used
    this exact combination, which reads as a template dashboard
    component because it is one, nearly verbatim, on most generated
    dashboards. Restyled as a left-accent-bordered tag instead (`.badge`
    in `globals.css`): still color-coded and scannable (the actual
    functional point of a badge), just no longer the specific chip
    shape that signals "here is a UI library's default Badge
    component."
  - **Soft blurred "floating card" shadows at rest on every panel** —
    restyled `--shadow-card` to a near-flat 1px inset highlight, with
    the soft blurred lift (`--shadow-card-hover`) now appearing only on
    hover, where it actually communicates something (interactivity)
    rather than existing as ambient decoration on every card whether or
    not it does anything.
  - Also tightened `--radius-lg/md/sm` down a few px across the board —
    a smaller, less exaggerated rounding scale reads as more considered
    than the larger, very-rounded-everywhere scale common to AI-
    generated component libraries.

  Deliberately **not** touched in this pass: page structure/layout
  (hero → content → table), the color palette itself (the "alpine
  night" navy/ice-blue/confidence-color system), and copy — those
  weren't flagged as the problem, and changing them too would make it
  harder to isolate which change actually helped if something needs
  reverting. The operator said UI refinement is ongoing ("we will need
  to refine ui later on") — this is a first pass at the most
  recognizable tells, not a claim that every generic-feeling surface is
  now fixed.

  Verified via a temporary `/design-check` fixture route (combining the
  homepage hero, badge tiers, the resort map, the snowfall chart,
  conditions strip, and the forecast table in one page — since there's
  still no live Supabase/Clerk to check the real routes against) and
  `playwright-core` screenshots at desktop and mobile widths, plus a
  direct `getComputedStyle` check confirming Space Grotesk and
  JetBrains Mono actually loaded and applied (not silently falling back
  to the system stack) rather than trusting the CSS looked right.
  Removed before commit. No regressions found — 118 tests still pass,
  clean build.

---

## Primer scope audit — full BUILD_PRIMER coverage check

Requested directly: confirm every item in the primer is reflected
somewhere in this roadmap, not just the parts that got built. Cross-
checked section by section against the live codebase.

**PART_1 in-scope items (primer section 1)**: all ten are covered by
Phases A/A.1/B above plus the README's "What's built" list — ingestion,
reconciliation/confidence, SLR, powder_score, alerting, public site,
trip_opportunity contract, fare enrichment, admin+social, backtest.
Nothing missing there.

**PART_1 out-of-scope items (primer section 1) — intentionally not
built, now explicitly tracked here so they stay visible instead of only
living in the original primer doc**:
- Booking integration (Fora, Travelpayouts booking, Booking.com, VRBO,
  Airbnb), payment processing, affiliate link generation — all PART_2
  scope. Nothing in this codebase touches any of them; the
  `trip_opportunity` payload (section 6) remains the only surface a
  future PART_2 would plug into, per non-negotiable principle 1.
- Wind-loading / aspect-specific microclimate modeling — Tier 3,
  "deferred indefinitely" per the primer's own wording. No stub exists
  for this one (the primer didn't ask for one, unlike the seasonal-
  pattern item below) — if this ever gets built, it's a new scoring
  input entirely (aspect/slope data this pipeline doesn't have), not a
  tweak to something existing.
- Long-range seasonal pattern modeling (ENSO/La Niña-El Niño) — the
  primer explicitly asked for a stub even though the logic itself is
  out of scope. **This one was actually missing until this audit caught
  it** — `src/lib/scoring/slr/cobb-waldstreicher.stub.ts`'s own header
  comment referenced "the deferred seasonal-pattern module" as if it
  already existed, but it didn't. Added:
  `src/lib/scoring/seasonal-pattern.stub.ts`.
- Multi-sport expansion (surf/foliage/etc) — no code needed, just "don't
  preclude it architecturally." Confirmed: nothing in the schema or
  scoring engine hardcodes skiing in a way that would block this later.
- Full user-account/profile system beyond optional email capture —
  correctly minimal (Clerk for the admin owner, a bare `subscribers`
  table for email capture, no profile management).

**Explicitly rejected data sources (primer section 2.3) — confirmed
never touched**: OpenSnow (addressed at length via the NWS public-
baseline pipeline instead of scraping — see Phase A.1), Airbnb/VRBO
scraping, Amadeus Self-Service API (noted dead/shut down in the primer
itself).

**Tech stack items not built (primer section 3)**: Mapbox, listed as
"optional, low priority, if resort map visualization is implemented."
The resort map itself *is* now implemented (Phase D, homepage) — just
not with Mapbox specifically. Built with `react-simple-maps` instead,
since Mapbox needs an unprovisioned API key and unreachable tile
servers from this sandbox; see Phase D for the full rationale. Revisit
Mapbox only if a key gets provisioned and richer basemap imagery
becomes worth the integration cost — not required for anything else to
function.

**Meteorological literature (primer section 11) — reference-only, not
data sources, cross-checked for where each one actually matters**:
- Veals et al. 2025 — primary source for the Kuchera coefficients,
  verified this session (see README's "Flagged assumptions"); also the
  source for the fixed-ratio 12:1 baseline already implemented as the
  backtest sanity-check strategy.
- Kuchera, Cobb & Waldstreicher — both represented as swappable SLR
  strategies (one live, one a documented stub).
- **Alcott & Steenburgh 2010** (Wasatch-specific SLR variability) — the
  primer flags this as "worth reviewing for resort-specific calibration
  constants once backtesting is underway," which is a direct pointer at
  **Phase B**. Not actioned yet since Phase B itself is dormant pending
  real data — but worth remembering specifically for the Utah resorts
  (Alta/Snowbird/Solitude/Brighton) when a human eventually reviews
  their calibration recommendations, rather than treating every
  resort's review identically.
- Roebber et al. 2003 — academic reference only, explicitly not
  implemented per the primer. Nothing to do.
- NWS/COMET training materials — background reading, not a data
  source. Nothing to do.
- **Avalanche center forecaster discussions** — same "human reading
  habit, not a data source" category as the OpenSnow manual-comparison-
  log idea already noted in Phase A.1. Not built, same reasoning: no
  ToS/scraping issue because there's no automated access involved, and
  it's genuinely a qualitative sense-check rather than a system input.

**AGENT_DIRECTIVE build order (primer section 12)**: all 8 steps
completed in the original build session, in order.

**Non-negotiable principles (primer section 10)**: all 5 confirmed
honored — no booking-partner coupling anywhere, SLR/reconciliation both
swappable interfaces, all thresholds named constants, trip_opportunity
is the only forward-facing surface, public transparency has no auth
wall.

**Net result of this audit**: one real gap found and closed (the
seasonal-pattern stub). Everything else in the primer was either
already built, already correctly deferred, or is now newly visible in
*this* document for the first time (the out-of-scope list, the
literature cross-references, Mapbox) — a future reader shouldn't need
to re-read the original primer to know what's accounted for.

---

## Session log

- **2026-08-22** — PART_1 built end-to-end (schema, ingestion, scoring
  engine, alerts, public site, admin panel), pushed. 29 tests.
- **2026-08-22** — NWS public-baseline comparison pipeline added (Phase
  A.1) in place of a declined OpenSnow integration. 38 tests.
- **2026-10-04** — Phase B calibration-recommendation mechanism built
  (recommend-only). WebSearch-verified two previously-flagged assumptions
  and found+fixed two real bugs in the process (Kuchera slope coefficients
  were backwards; NRCS SNOTEL station lookup assumed a non-existent
  server-side spatial filter). This ROADMAP rewritten into the guidance
  format you're reading. 51 tests.
- **2026-10-04** — Continued working the roadmap: added test coverage for
  `open-meteo.ts`'s URL-building logic (previously untested), and
  WebSearch-verified two more flagged integrations — found and fixed a
  real bug in the Travelpayouts fare response parsing (wrong shape and
  field names entirely) and a stale/ambiguous API version + base-domain
  issue in the Instagram Graph API client. 62 tests.
- **2026-10-04** — Fixed a real scalability bug (Resend's `batch.send`
  caps at 100 emails; the original dispatch code sent one unchunked
  batch for all matching subscribers — now chunks and tracks partial
  failures). Confirmed and fixed an AWDB `/data` param casing issue
  (`"DAILY"` → `"daily"`). Resolved Vercel's Hobby-plan cron limit from
  a hedge ("confirm current limits") to a confirmed fact (2 jobs max,
  once-per-day — Pro is required, now called out explicitly in Phase
  0). Ran `npm audit fix`: patched two **critical** unauthenticated-RCE
  advisories that had landed against Next.js itself since the original
  build (non-breaking, `next` moved within its existing `^15.1.4` range
  to `15.5.27`) — verified clean build/typecheck/tests after. 66 tests.
- **2026-10-04** — Found (by re-reading the scoring pipeline, not a
  WebSearch result this time) and fixed a real correctness bug that
  predates and is independent of every API-shape issue above: day
  boundaries throughout `lib/scoring/aggregate.ts` and
  `lib/ingestion/nws.ts` were computed in UTC rather than each resort's
  own local timezone. Every seeded resort sits 5-8 hours behind UTC, so
  this silently shifted which hours counted toward "today" for every
  resort, every score, all along. Fixed with a new dependency-free
  `Intl`-based timezone utility and threaded through the scoring
  orchestrator and the NWS benchmark pipeline (which had the identical
  bug — relevant since A.1 only makes sense if both sides mean the same
  day). 9 new tests, including both US DST transition days specifically.
  75 tests.
- **2026-10-04** — Found and fixed the most severe bug of this session:
  `lib/alerts/trigger.ts` queried a resort's entire `snow_scores`
  history ordered by `powder_score` DESC first (no `target_date` filter
  at all), so it would find whichever single row ever scored highest —
  including a date long past and including a forecast later corrected
  downward. Combined with the 24h rate limit resetting on its own, this
  would have re-sent an alert for the same resolved storm forever, every
  24 hours, indefinitely. The identical pattern existed in the public
  homepage's "best upcoming score" query, lower stakes but still real
  (a stale score could outrank its own correction). Both fixed: filter
  to upcoming dates, dedupe to the latest `computed_at` per date, then
  pick the best among current assessments. Extracted as a pure function
  with 7 new tests, including the exact bug-reproduction scenario. 82
  tests.
- **2026-10-04** — Added Phase D (visual design/UI polish, not started)
  and a full BUILD_PRIMER coverage audit after the operator asked
  whether interface/UI was tracked (it wasn't) and whether every primer
  item was represented in this roadmap. The audit found one genuine
  gap — the primer's required seasonal-pattern (ENSO) placeholder stub
  had never actually been built, despite another file's own comment
  referencing it as if it existed — and closed it
  (`src/lib/scoring/seasonal-pattern.stub.ts`). Everything else in the
  primer was already built, already correctly deferred, or is now
  documented here for the first time (out-of-scope PART_2 items,
  literature cross-references, Mapbox).
- **2026-10-04** — Phase D first pass: redesigned the public homepage,
  resort detail page, and the Instagram social graphic into a cohesive
  "alpine night" visual system (new design tokens in `globals.css`,
  Inter font, extracted presentational components). Verified in an
  actual headless browser against realistic fixture data via a
  temporary preview route (since removed) — found and fixed two real
  visual bugs this way (a flat hard-edged "glow" that needed to be a
  radial gradient instead; a snowflake glyph that silently failed to
  render in the social graphic's Satori-based image generator, replaced
  with a pure-CSS mark). Admin panel got a color-consistency pass, not
  a full redesign. No new tests (pure UI work) — 82 tests still passing,
  clean build.
- **2026-10-04** — Built the interactive US resort map requested
  directly: "We need a map UI of the US w the resorts we have overlayed
  on there it should be scrollable/scalable/zoomable"
  (`src/components/resort-map.tsx`, wired into the homepage above the
  resort grid). Used `react-simple-maps` + `us-atlas` + `geoAlbersUsa`
  instead of the primer's named Mapbox (section 3, optional) since
  Mapbox needs an unprovisioned API key and unreachable tile servers
  from this sandbox — this stack needs neither, rendering from a bundled
  local topology file. Verified via a temporary `/map-preview` fixture
  route (since removed) and `playwright-core` screenshots at desktop and
  mobile widths: pan/zoom/reset controls, marker positions (including
  correct Alaska placement), hover/click behavior, and the confidence-
  color legend all confirmed working. Found and fixed one real bug this
  way — a React hydration-mismatch warning from sub-pixel floating-point
  differences in the server vs. client `geoAlbersUsa` projection math —
  by disabling SSR for just this component
  (`src/components/resort-map-loader.tsx`), which also cut the
  homepage's First Load JS from 34.3kB to 1.87kB since the map library
  now ships as a separate lazy-loaded chunk. 82 tests still passing,
  clean build.
- **2026-10-04** — Built out the resort detail page per a direct request
  to "go deeper on the individual resorts" with "visuals (charts, etc,
  not just numbers)": a past-week/today/next-5-days snowfall bar chart
  (`src/components/snowfall-chart.tsx`, custom SVG, no new dependency),
  a per-day conditions strip (temp/cloud/wind/SLR/wind-hold,
  `src/components/conditions-strip.tsx`), a generic wind-hold-probability
  estimate (`src/lib/scoring/wind-hold.ts`, explicitly requested, clearly
  documented as not resort-specific), and an operator-curated webcam
  embed (`resorts.webcam_url` + `src/components/webcam-embed.tsx`, not
  scraped — same reasoning as the Mapbox decision above, applied to
  "pull from resort pages"). New migration (`0006_resort_detail.sql`):
  `webcam_url`, `forecast_pulls.wind_gust_kmh`, five new `snow_scores`
  weather/wind/hold columns computed once at scoring time, SNOTEL snow
  depth (not just SWE) for depth-delta-based past snowfall, and a public
  RLS read policy on `snotel_actuals`. Found and fixed two more
  UTC-vs-local-timezone bugs of the same class already fixed earlier
  this session (`run.ts`'s `nextNDates` and `resort-scores.ts`'s
  `getUpcomingScoresForResort` both built their date lists/filters from
  UTC "today" instead of each resort's own local "today" — see
  README.md for the full writeup) and one HTML-entity rendering bug
  (`&nearr;` not decoding in JSX text, unlike the handful of other
  entities already in use elsewhere on the site) — all caught by the
  same "verify in a real browser, not just read the code" discipline via
  a temporary `/resort-preview` fixture route (since removed) and
  `playwright-core` screenshots. 36 new tests (118 total), clean
  typecheck, clean build.
- **2026-10-04** — Finished Phase D with a full admin panel visual pass
  (nav across the three admin sections, dashboard stat row, a reusable
  `StatusBadge`, a "beating NWS / even / behind" comparison badge on the
  backtest table) — the one remaining codeable, non-opt-in item left on
  the whole roadmap once the public site and resort detail pages were
  done, picked up autonomously per the standing "keep working toward
  roadmap completion" instruction. Verified via a temporary
  `/admin-preview` fixture route (bypassing the Clerk gate with fixture
  data) and `playwright-core` screenshots — no new bugs found. 118 tests
  unchanged, clean build.
- **2026-10-04** — "Make it look less AI-generated" pass, the operator's
  own direct request. Identified and fixed five specific template tells
  rather than a vague aesthetic pass: the single do-everything Inter
  font (split into a 3-tier system — OS system font for body, Space
  Grotesk for headings, JetBrains Mono for numeric readouts), the
  radial-glow hero background (replaced with a hand-built topographic
  contour-line texture tied to the actual subject), the emoji-in-a-box
  brand mark (replaced with a drawn geometric peak mark), filled pill
  badges with a bullet dot and uppercase tracked-out text (restyled as
  left-accent-bordered tags), and soft blurred shadows at rest on every
  card (flattened to near-zero, with a lift only on hover where it
  signals something). Deliberately left the layout, color palette, and
  copy untouched — this pass targeted specific recognizable tells, not
  everything that could conceivably change, and the operator flagged
  this as ongoing work ("refine later on"), not a one-shot fix. Verified
  via a temporary `/design-check` fixture route combining every touched
  surface (hero, badges, map, chart, conditions, table) plus a direct
  `getComputedStyle` check confirming both new fonts actually loaded
  rather than silently falling back. 118 tests unchanged, clean build.
- **2026-10-13** — Built two historical backtest pipelines for Phase B,
  after a conversation that started with "is historical data accessible,
  can we pre-train ahead of the season?" and converged (through a real
  back-and-forth, not a one-shot answer) on: there's no literal
  pre-training since this isn't an ML model, but running historical
  weather data through the *existing* scoring logic and comparing the
  output to what actually happened produces the exact same `accuracy_log`
  signal the live pipeline does — you don't need to already know what was
  historically predicted to generate that. Two pipelines, covering
  different depths and different parts of the system (see Phase B above
  for the full writeup, `lib/backtest/*.ts` header comments for complete
  detail including stated limitations):
  `lib/backtest/slr-reanalysis.ts` (SLR formula only, ERA5 reanalysis
  back to 1940) and `lib/backtest/reconciliation-forecast-archive.ts`
  (full reconciliation + SLR pipeline, archived real model forecasts,
  ~2021+). Required refactoring `lib/scoring/run.ts` to extract a pure
  `computeScoreFromInputs` function first, so the backtest runs the
  *exact same* scoring code the live cron does rather than a
  reimplementation that could quietly drift from it — a good refactor
  independent of the backtest work, and it closed a real test-coverage
  gap (the full pipeline had zero direct tests before this; it does now).
  Two new operator-run scripts (`npm run backtest:slr-reanalysis`,
  `npm run backtest:reconciliation`, both accepting `--years=N`
  `--resort=<slug>`), a new `/admin/backtest` section showing results
  separately from live accuracy so they're never confused, and
  `generateCalibrationRecommendations` now pools both backtest sources
  alongside live data (documented methodological wrinkle: reanalysis
  samples measure SLR-only error, not end-to-end — acceptable given
  Phase B stays bounded and human-approved either way). None of the two
  new Open-Meteo hosts used here (`archive-api.open-meteo.com`,
  `historical-forecast-api.open-meteo.com`) could be verified against a
  live response in this sandbox (same WebFetch EGRESS_BLOCKED result as
  every other Open-Meteo host all session) — built to WebSearch-verified
  documented convention with the same "one place to fix it" discipline
  used everywhere else in this codebase for exactly this situation (see
  `lib/ingestion/open-meteo-historical.ts`'s header for the full
  verification-status account). 34 new tests (152 total), clean
  typecheck, clean build.
- **2026-10-13** — Built model versioning (Phase B.1), requested directly
  after Phase B shipped: *"include a dashboard with admin controls so
  it's not fully automated — human input and rollback options as well as
  comparison between model states — make the website 'save' previous
  model versions which can be run and viewed from the admin dashboard."*
  Made every scoring pure function's tunable constants accept an optional
  config override (defaulting to the existing hardcoded values — additive,
  zero breaking changes to the ~150 tests already exercising the default
  path), added a `model_versions` table (migration `0007`) with exactly
  one `active` row enforced by a partial unique index, and a service layer
  (`lib/model-versions/`) to resolve/create/activate/compare them. Wired
  the active version into live scoring (`lib/scoring/run.ts`), added
  `--version=<id>` to both historical backtest scripts so a draft can be
  evaluated *before* activating it (required widening `accuracy_log`'s
  uniqueness to include `model_version_id` — migration `0008` — so two
  versions' backtests over the same resort/date don't collide), and
  changed calibration approval to create+activate a new version (parent =
  previous active) instead of silently overwriting
  `resorts.slr_calibration_multiplier` with nothing to undo. Built
  `/admin/model-versions`: list with status/lineage, one button serving
  both "activate a draft" and "roll back to an older version" (same code
  path, deliberately), a JSON-textarea draft-creation form (documented
  scope call for an admin-only tool), and a GET-param-driven comparison
  view needing no client JS. Verified via a temporary
  `/preview-model-versions` fixture route and `playwright-core`
  screenshots at desktop/mobile widths — found and fixed two small text-
  wrapping issues, and confirmed the Activate button's error path
  end-to-end against the real (unconfigured) API route, not just the
  static layout. Removed before commit. 11 new tests (163 total), clean
  typecheck, clean build.
- **2026-10-14** — Built parallel model scoring / "shadow mode" (Phase
  B.2), requested directly: *"can you produce multiple models and in
  season 1 we can run them parallel and compare? (Build in compare)"*.
  Added `is_shadow` to `model_versions` (DB CHECK: never both `active`
  and `is_shadow`) and `is_primary` to `snow_scores`/`accuracy_log`
  (migration `0009`), so any number of draft versions can now be scored
  on the exact same live inputs as the active version every cron run,
  without risk to the public site or alerts. Found, by reading
  `trigger.ts`/`run.ts`/`resort-scores.ts` in full before writing code,
  that three separate "pick the latest row" read paths (public site,
  alert trigger, accuracy summary) would have non-deterministically
  served or alerted on a shadow version's score the moment a second row
  per resort/date existed — fixed all three with `.eq("is_primary", true)`
  filters. Rewrote `runScoringForAllResorts` to fetch each resort/date's
  model/ensemble inputs once and reuse them across the active config and
  every shadow config, so N parallel shadow versions cost N× the (cheap)
  scoring math, not N× the ingestion reads. Rewrote
  `logPowderAlertAccuracy` to log one `accuracy_log` row per version
  sharing a `computed_at` instead of picking one at random and dropping
  the rest. Built a second real SLR strategy to actually shadow,
  `kuchera-wind` — a wind-derated variant of the existing Kuchera
  strategy, explicitly documented as an engineering hypothesis (literature
  supports the *direction*; the cited paper's own follow-up coefficients
  were never retrievable this session, WebFetch having been blocked to
  every candidate source, so small conservative named constants are used
  instead of fabricated figures attributed to that paper) to be judged on
  this season's own shadow-scored data. Added a shadow-toggle API route
  and an `/admin/model-versions` UI column — the existing Phase B.1
  compare view does the rest, no new comparison UI needed. Verified the
  new UI column via a temporary `/preview-shadow-column` fixture route
  and `playwright-core` screenshots of all three toggle states, removed
  before commit. 13 new tests (176 total), clean typecheck, clean build.
- **2026-10-15** — Built per-resort model precision (Phase B.3), after a
  design discussion on whether model weighting should vary by resort:
  *"I want the model to be as precise as possible so code the individual
  resorts I don't mind the additional computational load up front."*
  Added `model_versions.resort_scoring_overrides` (migration `0010`), a
  `resort_id -> partial ScoringConfig` map generalizing the existing
  per-resort SLR-multiplier pattern to the rest of the scoring config
  (model weights by lead-time bucket, SLR strategy, thresholds, weights —
  everything that was previously uniform across all ~51 resorts under a
  version). `resolveScoringConfigForResort` merges a resort's override
  onto that SAME version's own global config field-by-field, never onto
  the compiled-in defaults, so an un-differentiated resort (the default
  for every resort on every version) is behaviorally identical to before
  this phase. Wired into every call site that resolves a version's config
  — the live cron, both historical backtest scripts, and shadow scoring —
  not just the obvious one, since missing any would have made precision
  silently partial; deleted the now-callerless `getActiveScoringConfig()`
  rather than leave it as a resort-oblivious trap. The "additional
  computational load" the user explicitly accepted turned out to be
  close to zero in practice — resolving a config per resort is a cheap
  in-memory merge over an already-fetched row, riding for free on Phase
  B.2's existing shared-inputs design. Added a second, optional JSON
  textarea to the admin create-draft form (same deliberate raw-JSON scope
  call as the main config) and a resort filter on the comparison view, so
  an override's actual effect on its target resort is checkable, not just
  the all-resorts blend. Ships zero fabricated differentiation — every
  resort defaults to inheriting the global config until a human sets an
  override, consistent with this project's standing rule against
  presenting a guess as a verified figure. Verified the new UI via a
  temporary `/preview-model-version-overrides` fixture route and
  `playwright-core` screenshots (default state, create-form open, and the
  resort filter actually swapping comparison numbers), removed before
  commit. 14 new tests (185 total), clean typecheck, clean build.

---

## Suggested sequencing

Phase 0 (you, this week ideally) → Phase A verification happens naturally
as Phase 0 completes → Phase C activation once there's enough real signal
for a dev loop to act on (after initial deploy, not before — say the word
when you're ready) → Phase B's two backtest scripts can run right after
Phase 0 (no season wait required anymore — see Phase B above), but still
treat your first *approval* of a recommendation as a real decision worth
taking slowly: skim a few resorts' backtest numbers in `/admin/backtest`
before approving anything, same caution as if it came from live data. →
Phase B.1 is already built and needs nothing further from you — every
calibration approval now creates its own rollback point automatically;
`/admin/model-versions` is just there for when you want to look at
lineage, compare a draft's backtest numbers before activating it, or roll
back. → Phase B.2 needs exactly one action from you, whenever you want to
start the season-long comparison: create a `kuchera-wind` draft from
`/admin/model-versions` and toggle "Start shadowing" — everything else
(parallel scoring every cron run, per-version accuracy logging, the
compare view) is already live and needs nothing further. → Phase B.3 is
best left alone until Phase B.2's comparison data gives you a real reason
to differentiate a specific resort — the engine is ready whenever that
day comes (a per-resort override on any draft, via the same new-draft
form's second textarea), but setting one before you have resort-specific
accuracy data to act on would be exactly the kind of unevidenced guess
this project has avoided everywhere else. → Phase B's broader constants
(alert threshold, score weights) only after the per-resort SLR case has
run a full cycle and you're comfortable with it — if you do eventually
want to tune one of those, do it as a draft model version first and
backtest under it before activating, same discipline as everything else
in Phase B. Phase D ran independently of all of this and its first pass
is done — a decided product name is the only real blocker left for a
final polish pass (swapping "powder-alert" for the real name/logo).
