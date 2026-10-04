-- Resort detail page enrichment: historical/predicted snowfall visuals, SLR,
-- weather, wind, a wind-hold-probability estimate, and operator-curated
-- webcam embeds. See ROADMAP.md Phase D for the full rationale on each
-- judgment call made here (wind-hold thresholds are generic, not
-- resort-specific; webcams are operator-curated, not scraped).

-- Operator-entered, same pattern as elevation_* / slr_calibration_multiplier
-- (never touched by application code, only data). Nullable: most resorts
-- won't have this populated until an operator curates it per resort.
alter table resorts
  add column if not exists webcam_url text;

-- Open-Meteo's wind_gusts_10m, added alongside the existing sustained
-- wind_speed_10m — gusts are the more relevant input for a wind-hold
-- estimate than sustained speed alone.
alter table forecast_pulls
  add column if not exists wind_gust_kmh numeric;

-- Daily weather/wind summary + a wind-hold-probability estimate, computed
-- once at scoring time (lib/scoring/run.ts) and persisted here rather than
-- re-aggregated from raw forecast_pulls on every public page load. Keeps
-- forecast_pulls (raw per-model internals) service-role-only while still
-- surfacing a representative daily summary on the already-public
-- snow_scores table. All nullable: a day's model runs might not report
-- every field, and existing rows predate this column.
alter table snow_scores
  add column if not exists avg_temp_c numeric,
  add column if not exists avg_wind_speed_kmh numeric,
  add column if not exists max_wind_gust_kmh numeric,
  add column if not exists avg_cloud_cover_pct numeric,
  add column if not exists wind_hold_probability numeric check (wind_hold_probability is null or wind_hold_probability between 0 and 1);

-- Raw SNOTEL snow depth (SNWD, inches) alongside the existing WTEQ-derived
-- observed_swe_mm — observed_depth_change_in (already in 0001_init.sql but
-- never populated) is now computed as the day-over-day delta of this column
-- (see lib/ingestion/snotel.ts computeDepthChangeSeries), which is the
-- standard "new snowfall" proxy for SNOTEL stations, not a SWE-based one.
alter table snotel_actuals
  add column if not exists snow_depth_in numeric;

-- Public read: ground-truth SNOTEL data is public-domain NRCS data already
-- (see lib/ingestion/snotel.ts), and the resort detail page's "past week"
-- snowfall visual needs it client-/server-side via the anon key, same
-- transparency principle as snow_scores_public_read in 0002_rls.sql.
drop policy if exists snotel_actuals_public_read on snotel_actuals;
create policy snotel_actuals_public_read on snotel_actuals for select using (true);
