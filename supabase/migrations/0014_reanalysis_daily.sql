-- Daily ERA5 weather per resort, saved by the historical model run
-- (lib/backtest/slr-reanalysis.ts) from the same archive request the SLR
-- backtest already makes. Kept for the planned natural base-depth model
-- (accumulation, settling, melt, sublimation), which needs humidity, wind
-- and sunshine as well as temperature and precipitation. Nothing reads it
-- yet; Nick approved collecting it now (2026-10-18) so the 40-year load
-- doesn't have to be repeated later.
--
-- One row per resort per resort-local day, at the resort's mid elevation.
-- Only resorts with a SNOTEL station are in the historical run (32 on
-- 2026-10-18), so about 32 x 41 water years x 365 days = ~480k rows, ~60 MB.
-- Applied to the live project on 2026-10-18 one statement per execute_sql call.
-- Service-role only (RLS on, no policies).
create table if not exists reanalysis_daily (
  resort_id uuid not null references resorts(id) on delete cascade,
  date date not null,
  elevation_m int not null,
  hours int not null,
  precip_mm numeric,
  snowfall_cm numeric,
  temp_min_c numeric,
  temp_max_c numeric,
  temp_mean_c numeric,
  dew_point_mean_c numeric,
  rh_mean_pct numeric,
  wind_mean_ms numeric,
  wind_max_ms numeric,
  shortwave_mj_m2 numeric,
  pressure_mean_hpa numeric,
  cloud_cover_mean_pct numeric,
  fetched_at timestamptz not null default now(),
  primary key (resort_id, date)
);
alter table reanalysis_daily enable row level security;
