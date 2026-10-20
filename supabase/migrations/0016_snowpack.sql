-- Natural snowpack model (lib/snowpack/). Nick approved building it on
-- 2026-10-20. Applied to the live project the same day, one statement per
-- execute_sql call.

-- One row per resort with a reference station: the fitted parameters, the
-- held-out scores and whether they clear the bar (lib/snowpack/fit.ts).
-- Written by scripts/snowpack-fit.ts (GitHub Actions). A resort that fails
-- the bar keeps its row so the admin side can see why, but the public site
-- shows no estimate for it.
create table if not exists snowpack_params (
  resort_id uuid primary key references resorts(id) on delete cascade,
  params jsonb not null,
  held_out jsonb not null,
  in_sample jsonb not null,
  passes boolean not null,
  failed_checks jsonb not null default '[]'::jsonb,
  station_triplet text,
  station_elevation_m numeric,
  weather_elevation_m numeric,
  winters int not null,
  fitted_at timestamptz not null default now()
);
alter table snowpack_params enable row level security;

-- The current season's modeled natural snowpack at mid-mountain, one row
-- per resort per local day, rewritten by /api/cron/snowpack. kind is
-- 'modeled' for past days and 'projected' for today onward (forecast
-- weather). calibrated = false means SNOW-17 default parameters (no
-- reference station); the site labels those "uncalibrated".
create table if not exists snowpack_daily (
  resort_id uuid not null references resorts(id) on delete cascade,
  date date not null,
  swe_mm numeric not null,
  depth_in numeric not null,
  density numeric,
  kind text not null check (kind in ('modeled', 'projected')),
  calibrated boolean not null,
  computed_at timestamptz not null default now(),
  primary key (resort_id, date)
);
alter table snowpack_daily enable row level security;
-- Public display data, like snow_scores.
create policy snowpack_daily_public_read on snowpack_daily for select using (true);

-- Latest run per model per hour for one resort's band over a window, so
-- the daily snowpack job can read forecast weather without pulling every
-- archived run (forecast_pulls keeps all of them).
create or replace function snowpack_forecast_hours(p_resort_id uuid, p_band text, p_from timestamptz, p_to timestamptz)
returns table (model_name text, valid_time timestamptz, swe_mm numeric, temp_2m_c numeric, wind_speed_kmh numeric)
language sql stable
as $$
  select distinct on (f.model_name, f.valid_time)
    f.model_name, f.valid_time, f.swe_mm, (f.raw_payload->>'temperature_2m')::numeric, f.wind_speed_kmh
  from forecast_pulls f
  where f.resort_id = p_resort_id and f.elevation_band = p_band and f.valid_time >= p_from and f.valid_time < p_to
  order by f.model_name, f.valid_time, f.run_init_time desc
$$;
revoke all on function snowpack_forecast_hours(uuid, text, timestamptz, timestamptz) from public, anon, authenticated;
