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
| D | Visual design / UI polish | 🟡 First pass done (public site + graphic) | You (product name), then me for further passes |

**Test/build state as of this update**: 82/82 unit tests passing, clean
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

## Phase D — Visual design / UI polish

**Status: 🟡 first pass done** (public site + social graphic). Admin panel got a light consistency pass (new color tokens, branding), not a full redesign — still the lower priority per the plan below. Verified in an actual headless browser, not just "looks right in code" — see Session log.

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

**How it was actually verified**: there's still no live Supabase, so a
temporary `/design-preview` route rendered the same presentational
components (`ResortCard`, `ScoreTable`) against realistic fixture data
— removed once verification was done, never shipped. Screenshotted via
`playwright-core` against the pre-installed Chromium at desktop (1440px)
and mobile (390px) widths, actually looked at the images, found and
fixed two real problems that way (the glow effect looked like a hard-
edged flat circle, not a soft glow — fixed with a radial-gradient
instead of solid-color + opacity; the social graphic's snowflake glyph
silently failed to render — switched to a pure-CSS mark). This is the
same "verify in a real browser before calling it done" standard the
project's own instructions ask for, not just "the code looks plausible."

**Still open**: the product name itself (BUILD_PRIMER section 0,
"rename TBD") — the current design uses "powder-alert" as a working
brand, which is low-cost to swap for a real name/logo later since
nothing about the visual system depends on this specific name. A
resort map (Mapbox, optional per section 3) remains unbuilt. Admin
panel beyond the color-consistency pass remains unbuilt (intentionally
— lower priority, one operator not a public audience).

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
"optional, low priority, if resort map visualization is implemented" —
not implemented. No resort map exists anywhere in the current UI.
Candidate for Phase D if a map ever seems worth the Mapbox API key +
integration work; not required for anything else to function.

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

---

## Suggested sequencing

Phase 0 (you, this week ideally) → Phase A verification happens naturally
as Phase 0 completes → Phase C activation once there's enough real signal
for a dev loop to act on (after initial deploy, not before — say the word
when you're ready) → Phase B stays dormant through a full season of real
`accuracy_log` data before you approve your first recommendation → Phase
B's broader constants (alert threshold, score weights) only after the
per-resort SLR case has run a full cycle and you're comfortable with it.
Phase D ran independently of all of this and its first pass is done —
a decided product name is the only real blocker left for a final
polish pass (swapping "powder-alert" for the real name/logo).
