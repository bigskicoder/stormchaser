-- Adds a public-baseline comparison pipeline (NWS api.weather.gov gridded
-- forecasts) alongside the existing powder-alert scoring engine, so backtest
-- accuracy can be reported as "us vs. a public baseline vs. observed SNOTEL"
-- rather than just "us vs. observed."
--
-- This is deliberately NOT a comparison against OpenSnow or any other
-- proprietary/paid product — api.weather.gov is public-domain NWS data,
-- no ToS restriction on automated access, no scraping involved. See
-- ROADMAP.md for why an OpenSnow-scraping pipeline was explicitly declined.

-- Resolved once per resort at onboarding (same pattern as the elevation
-- check and SNOTEL station resolution — see lib/ingestion/elevation.ts,
-- lib/ingestion/snotel.ts), via the NWS /points/{lat},{lng} endpoint.
alter table resorts
  add column if not exists nws_grid_id text,
  add column if not exists nws_grid_x integer,
  add column if not exists nws_grid_y integer,
  add column if not exists nws_resolved_at timestamptz;

-- One row per (resort, source, target_date, pull) — append-only like
-- forecast_pulls, so a backtest join can pick the most-recently-pulled
-- value per target_date the same way scoring does for snow_scores.
create table if not exists benchmark_forecasts (
  id uuid primary key default gen_random_uuid(),
  resort_id uuid not null references resorts (id) on delete cascade,
  source text not null default 'nws' check (source in ('nws')),
  target_date date not null,
  estimated_snowfall_in numeric not null,
  lead_time_hours numeric not null,
  raw_payload jsonb not null,
  pulled_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_benchmark_forecasts_lookup
  on benchmark_forecasts (resort_id, source, target_date, pulled_at desc);

alter table benchmark_forecasts enable row level security;
-- No public policy: service-role only, same as forecast_pulls/ensemble_pulls.

-- accuracy_log now tracks accuracy for ANY forecast source against SNOTEL
-- ground truth, not just our own scoring engine's predictions.
alter table accuracy_log
  add column if not exists source text not null default 'powder_alert';

-- Drop the old (resort_id, target_date, lead_time_hours_at_prediction)
-- unique constraint by looking up its actual (auto-generated, possibly
-- truncated) name rather than guessing it, then add the source-aware one.
do $$
declare
  old_constraint_name text;
begin
  select conname into old_constraint_name
  from pg_constraint
  where conrelid = 'accuracy_log'::regclass
    and contype = 'u'
    and conname <> 'accuracy_log_resort_date_leadtime_source_key';

  if old_constraint_name is not null then
    execute format('alter table accuracy_log drop constraint %I', old_constraint_name);
  end if;
end $$;

alter table accuracy_log add constraint accuracy_log_resort_date_leadtime_source_key
  unique (resort_id, target_date, lead_time_hours_at_prediction, source);
