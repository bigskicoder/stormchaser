-- ENSO-aware SLR calibration (ROADMAP Phase B.6).
--
-- enso_oni holds NOAA CPC's Oceanic Nino Index exactly as published in
-- https://www.cpc.ncep.noaa.gov/data/indices/oni.ascii.txt: one row per
-- overlapping 3-month season (DJF, JFM, ... NDJ) per year, the anomaly in
-- degrees C. Filled by refreshEnsoOni() (lib/enso/oni.ts), run by the
-- monthly cron and at the start of the local model run. Never typed in by
-- hand, so the phase labels downstream are always NOAA's numbers.
create table if not exists enso_oni (
  year int not null,
  season text not null check (season in ('DJF','JFM','FMA','MAM','AMJ','MJJ','JJA','JAS','ASO','SON','OND','NDJ')),
  anomaly_c numeric not null,
  fetched_at timestamptz not null default now(),
  primary key (year, season)
);
alter table enso_oni enable row level security;
-- Public, non-sensitive NOAA data: readable by anyone, written only by the service role.
create policy enso_oni_public_read on enso_oni for select using (true);

-- Per-resort, per-phase SLR multipliers, snapshotted per model version like
-- resort_slr_multipliers: { resort_id: { "el_nino": 1.04, "la_nina": 0.97 } }.
-- A phase that's absent falls back to the resort's base multiplier. Only
-- set through an approved calibration recommendation (lib/calibration/apply.ts),
-- and only proposed when a resort's backtest error in that phase is
-- statistically distinct from its neutral-winter error.
alter table model_versions add column if not exists resort_enso_slr_multipliers jsonb not null default '{}'::jsonb;

-- Which multiplier a recommendation is for: null = the resort's base
-- multiplier (unchanged behavior), otherwise the phase-specific one.
alter table calibration_recommendations add column if not exists enso_phase text
  check (enso_phase is null or enso_phase in ('el_nino','la_nina'));
