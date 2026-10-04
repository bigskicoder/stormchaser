# ROADMAP

Three phases beyond PART_1 (see `README.md` for what's already built and the
near-term operational-readiness steps — provisioning Supabase/Clerk/Resend/
Vercel/etc., verifying the flagged assumptions, seeding resorts). This doc
covers what comes after that: running unattended, tuning itself, and
iterating on its own codebase.

---

## Phase A — Autonomous pipeline operation

**Status: already built, not yet proven against live services.**

Once deployed with real credentials, the product pipeline runs with zero
human input by design:

- Vercel Cron fires ingestion (`/api/cron/ingest-*`), scoring
  (`/api/cron/score`), alert dispatch (`/api/cron/alerts`), and backtest
  logging (`/api/cron/backtest`) on their own schedules — no one has to
  trigger or watch any of it.
- Subscribers get emailed automatically when a resort crosses threshold.
  Rate-limiting (one alert per resort per 24h) prevents spam without a
  human in the loop.

**The one deliberate exception: Instagram posting stays human-gated.**
BUILD_PRIMER section 8 is explicit that auto-publishing without a manual
click is a non-negotiable no. This isn't a limitation to engineer around —
it's cheap insurance against an autoposted mistake going out under the
account's name. Everything upstream of that one click (ingestion → scoring
→ alert → graphic generation → drafted caption) is already unattended.

**Remaining work**: purely the operational-readiness steps in the README
(provision services, verify the flagged Open-Meteo/NRCS/Kuchera
assumptions, seed resorts, let ingestion run long enough to accumulate
real history). Nothing new to design here — just prove the existing
design against real traffic.

---

## Phase A.1 — Public-baseline comparison pipeline

**Status: built** (`src/lib/ingestion/nws.ts`, `/api/cron/ingest-nws-benchmark`, `benchmark_forecasts` table, extended `/admin/backtest` report).

The operator asked for "a pipeline to compare to OpenSnow." That specific
request was declined — OpenSnow is a paid, proprietary product with no
public API and a ToS that doesn't permit automated access (the
BUILD_PRIMER already drew this exact line in section 2.3). What got built
instead answers the same underlying question — "is our forecast actually
good, relative to something else" — against a source that's fully
legitimate to automate against: NWS's public-domain gridded forecasts
(`api.weather.gov`). Both our own scoring engine and the NWS baseline are
now measured against the same SNOTEL ground truth via `accuracy_log`
(now `source`-tagged `powder_alert` vs `nws`), and `/admin/backtest` shows
them side by side per resort.

If a literal OpenSnow comparison is still wanted later, the legitimate
version of that is a **manual, human-entered comparison log** — you read
their displayed forecast yourself (you have a subscription; that's not
automated access) and type the number in. No ToS issue, because there's
no scraping. Not built — would need one new table and a small admin form
if/when it's actually wanted. Phase B below could eventually treat "gap
vs. NWS" as a second tuning signal alongside raw SNOTEL error, once both
have enough history to be meaningful.

---

## Phase B — Self-tuning calibration loop

**Status: not built. Needs a real update rule + guardrails before any code is written — and needs real accuracy data before it's useful at all.**

The schema already has the hooks this would need:
- `resorts.slr_calibration_multiplier` — per-resort SLR adjustment, currently manual-only (section 5.3)
- `accuracy_log` — predicted vs. SNOTEL-observed snowfall, with `accuracy_error_in` per resort/date/lead-time (section 5.5)

What self-tuning means concretely: periodically (e.g. weekly, or after N new
accuracy_log rows for a resort) compute that resort's recent mean error and
nudge `slr_calibration_multiplier` toward reducing it, rather than waiting
for a human to eyeball the `/admin/backtest` report and edit the DB by hand.

**Design decisions to make before building this** (not yet decided):

1. **Minimum sample size.** Tuning on 2-3 storms is just fitting noise.
   Needs a floor (e.g. 15-20 accuracy_log rows for that resort) before the
   multiplier is allowed to move at all.
2. **Bounded step size.** Each adjustment should be small (e.g. ±5% per
   update, hard-capped total drift from 1.0, say [0.7, 1.4]) — a
   self-tuning loop that can swing a resort's multiplier wildly after one
   bad storm is worse than no tuning.
3. **Apply vs. recommend.** Two real options:
   - *Recommend-only*: the loop computes a suggested new multiplier and
     surfaces it in `/admin/backtest` for a human to approve — same spirit
     as the Instagram gate in Phase A.
   - *Auto-apply with a visible log*: the loop writes the new value
     directly but every change is logged (new table, `calibration_adjustments`,
     or just richer `accuracy_log` rows) so it's auditable and reversible.
   - Recommendation: start **recommend-only** for at least one full season
     per resort, then graduate individual resorts to auto-apply once their
     sample size and stability justify it. Don't flip the whole system to
     auto-apply on day one.
4. **What else could self-tune, later**: `ALERT_POWDER_SCORE_THRESHOLD`,
   the `POWDER_SCORE_WEIGHTS` split, and `ENSEMBLE_CONFIDENCE_THRESHOLDS`
   are also just named constants today — same pattern would apply, but
   they're riskier to auto-tune than a per-resort SLR multiplier since they
   affect every resort's alert-firing behavior at once. Not in scope until
   the per-resort case is proven out.

**Blocking dependency**: this cannot start until Phase A has been live
through enough real storms to populate `accuracy_log` meaningfully — likely
most of a season. Building the tuning logic now, against zero data, would
just be guessing at an update rule with nothing to validate it against.

---

## Phase C — Autonomous dev-iteration loop (Claude Code)

**Status: not activated. Opt-in — tell me when you want this turned on.**

Separate from the product itself: a recurring Routine that wakes a Claude
Code session on a schedule with standing instructions to keep pushing this
codebase toward operational readiness and, later, toward Phase B — without
you prompting each time.

**What it would plausibly do each run:**
- Run `npm run typecheck`, `npm run test`, `npm run build` — fix anything broken.
- Check `/admin/backtest` (once live data exists) for accuracy regressions
  or data gaps (e.g. a resort's SNOTEL ingestion silently failing).
- Pick up the next unchecked item from the operational-readiness list in
  the README and make progress on it where that's a code change (not an
  account-provisioning step only you can do, like creating the Supabase
  project itself).
- Push commits directly to this branch (no PR review loop exists on this
  repo currently — same as this session has been doing).

**What it should NOT do without asking first** — same bar as this session
already follows:
- Touch anything in Phase B's auto-apply path once that exists — a
  self-tuning loop that itself gets self-modified by an unattended coding
  loop is two layers of unsupervised change stacked on each other, and
  that combination needs your sign-off, not a default.
- Change the Instagram-posting human-gate in Phase A.
- Any destructive git operation, force-push, or schema migration that
  drops/renames a column with existing data.

**Cost note, since this came up**: a recurring Routine firing into a fresh
session every run consumes usage each time, same as this session has.
Before activating this, worth deciding a cadence (daily check-in vs.
weekly) rather than defaulting to something aggressive — happy to propose
one once you say go.

---

## Suggested sequencing

Phase A's operational-readiness steps (README) → Phase C activation once
there's enough real signal for it to act on (after initial deploy, not
before) → Phase B once a season's worth of `accuracy_log` exists per
resort → Phase B's broader constants (alert threshold, score weights) only
after the per-resort SLR case has run a full cycle.
