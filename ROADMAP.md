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
| B | Self-tuning SLR calibration | 🔶 Mechanism built, dormant | Needs Phase 0 + a season of data |
| C | Autonomous dev-iteration loop | ⬜ Designed, not activated | **You** — say go when ready |

**Test/build state as of this update**: 51/51 unit tests passing, clean
`tsc --noEmit`, clean `next build`. Single branch (`claude/autonomous-coding-5hk5wt`),
which is also this repo's default branch — no PR pending, nothing to merge.

---

## Phase 0 — Operational readiness (🔲 Owner: you)

Nothing below is a code problem. These are accounts, keys, and a few
business decisions — nothing here, no amount of "keep coding," gets this
done without you. Ordered by what actually blocks what.

### Tier 1 — do these first, in order (nothing else works without them)
1. **Create a Supabase project** (free tier is fine at this scale) → copy its URL, anon key, and service-role key.
2. **Create a Vercel project** → import `bigskicoder/stormchaser`, branch `claude/autonomous-coding-5hk5wt`.
3. **Set env vars in Vercel**: at minimum `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and a random string for `CRON_SECRET` (Vercel sends this back automatically on its own cron calls once it's set — see `.env.example` for the full list).
4. **Run the 5 migrations** (`supabase/migrations/0001` through `0005`) against that Supabase project — SQL editor or `supabase db push`.
5. **Deploy** — confirm the build goes green on Vercel with real secrets (you can deploy before step 4 to sanity-check the build itself, but the app won't do anything useful until the schema exists).
6. **Run `npm run seed:resorts`** against the real project. This is the first live contact with Open-Meteo's elevation API, NRCS's station list, and NWS's `/points` endpoint — review the console output for any resort flagged with an elevation discrepancy >150m before trusting its scores.

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
14. **Custom domain** — genuinely optional and non-blocking, confirmed earlier in this project: Vercel gives you a free `*.vercel.app` URL automatically, and a domain can be attached later without redeploying anything. Decide on a name whenever you want, not before.
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

**Status: 🔶 mechanism built this session, intentionally dormant.**
`src/lib/calibration/` (pure update rule in `recommend.ts`, DB orchestrator
in `generate.ts`, the only-approved-writes-apply path in `apply.ts`),
`calibration_recommendations` table, weekly cron
(`/api/cron/calibration-recommend`), admin review UI at `/admin/calibration`.
8 unit tests in `tests/calibration/`.

**How it works, as built:**
- Weekly, for each resort with ≥15 `accuracy_log` samples (source=`powder_alert`)
  in the trailing 120 days, computes the mean signed error and proposes a
  new `slr_calibration_multiplier` — a simple bounded proportional
  controller, not a black box: nudge opposite the mean error, scaled to
  the mean predicted amount, clamped to ±5% per update, and the multiplier
  itself is hard-bounded to [0.7, 1.4] regardless of how large an error
  would otherwise imply.
- **Recommend-only, as decided**: nothing writes to `resorts.slr_calibration_multiplier`
  automatically. Every proposal lands in `calibration_recommendations` with
  `status='pending'` and sits in `/admin/calibration` until a logged-in
  admin clicks Approve or Reject. Approve is the only code path that
  writes the new value; reject just records the decision.
- Skips generating a new recommendation for a resort while one is still
  pending, so they don't pile up unreviewed.

**Why it's dormant and should stay that way for now**: all of this is
inert without real `accuracy_log` rows, and there are zero right now —
that table only fills once Phase 0 is done and the backtest cron has run
against real SNOTEL data for a while. Building the mechanism now (rather
than waiting) was the right call because it's a pure, independently
testable piece of logic with no live-service dependency — but *using* it
needs a season, not a deploy.

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

---

## Suggested sequencing

Phase 0 (you, this week ideally) → Phase A verification happens naturally
as Phase 0 completes → Phase C activation once there's enough real signal
for a dev loop to act on (after initial deploy, not before — say the word
when you're ready) → Phase B stays dormant through a full season of real
`accuracy_log` data before you approve your first recommendation → Phase
B's broader constants (alert threshold, score weights) only after the
per-resort SLR case has run a full cycle and you're comfortable with it.
