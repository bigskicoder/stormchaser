-- powder-alert :: PART_1 schema (BUILD_PRIMER section 4)
-- Entity structure preserved per primer; field types/constraints refined by agent.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- resorts: operator-editable data, never hardcoded in application code
-- ---------------------------------------------------------------------------
create table if not exists resorts (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  pass_affiliation text not null default 'none' check (pass_affiliation in ('epic', 'ikon', 'independent', 'none')),
  state text,
  lat double precision not null,
  lng double precision not null,
  -- operator-entered elevations (meters). Validated at seed/onboarding time
  -- against the Open-Meteo Elevation API (section 2.1a); large discrepancies
  -- (>150m) are flagged in elevation_check_flag rather than silently trusted.
  elevation_base_m numeric not null,
  elevation_mid_m numeric not null,
  elevation_summit_m numeric not null,
  elevation_checked_at timestamptz,
  elevation_check_flag boolean not null default false,
  elevation_check_notes text,
  timezone text not null default 'America/Denver',
  -- per-resort SLR calibration multiplier, default 1.0 (section 5.3).
  -- Manual post-backtest tuning hook; never touched by code, only data.
  slr_calibration_multiplier numeric not null default 1.0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_resorts_active on resorts (active);

-- ---------------------------------------------------------------------------
-- forecast_pulls: raw per-model, per-elevation-band ingestion records
-- ---------------------------------------------------------------------------
create table if not exists forecast_pulls (
  id uuid primary key default gen_random_uuid(),
  resort_id uuid not null references resorts (id) on delete cascade,
  model_name text not null check (model_name in ('hrrr', 'gfs', 'icon', 'ecmwf', 'gem')),
  elevation_band text not null check (elevation_band in ('base', 'mid', 'summit')),
  run_init_time timestamptz not null,
  valid_time timestamptz not null,
  pulled_at timestamptz not null default now(),
  raw_payload jsonb not null,
  swe_mm numeric,
  precip_mm numeric,
  temp_c numeric,
  -- Wind is NOT elevation-corrected by Open-Meteo (section 2.1a) — the same
  -- nearest-grid-cell value is returned for every band. Stored per-row for
  -- completeness but the reconciliation engine must not treat it as
  -- band-differentiated.
  wind_speed_kmh numeric,
  wind_dir_deg numeric,
  freezing_level_m numeric,
  cloud_cover_pct numeric,
  created_at timestamptz not null default now()
);

create index if not exists idx_forecast_pulls_lookup
  on forecast_pulls (resort_id, model_name, elevation_band, valid_time);
create index if not exists idx_forecast_pulls_run_init on forecast_pulls (run_init_time);

-- ---------------------------------------------------------------------------
-- ensemble_pulls: per-member ensemble values feeding confidence/spread calc
-- ---------------------------------------------------------------------------
create table if not exists ensemble_pulls (
  id uuid primary key default gen_random_uuid(),
  resort_id uuid not null references resorts (id) on delete cascade,
  elevation_band text not null check (elevation_band in ('base', 'mid', 'summit')),
  member_id integer not null,
  run_init_time timestamptz not null,
  valid_time timestamptz not null,
  pulled_at timestamptz not null default now(),
  swe_mm numeric,
  created_at timestamptz not null default now()
);

create index if not exists idx_ensemble_pulls_lookup
  on ensemble_pulls (resort_id, elevation_band, valid_time);

-- ---------------------------------------------------------------------------
-- snow_scores: output of reconciliation + scoring engine, one row per
-- resort/target_date/computed_at (recomputed as lead time shortens)
-- ---------------------------------------------------------------------------
create table if not exists snow_scores (
  id uuid primary key default gen_random_uuid(),
  resort_id uuid not null references resorts (id) on delete cascade,
  target_date date not null,
  computed_at timestamptz not null default now(),
  reconciled_swe_mm numeric not null,
  disagreement_flag boolean not null default false,
  model_agreement_score numeric not null check (model_agreement_score between 0 and 1),
  ensemble_spread_score numeric not null check (ensemble_spread_score between 0 and 1),
  confidence_label text not null check (confidence_label in ('low', 'medium', 'high')),
  slr_strategy text not null default 'kuchera',
  snow_to_liquid_ratio numeric not null,
  is_rain_case boolean not null default false,
  estimated_snowfall_in numeric not null,
  normalized_snowfall numeric not null check (normalized_snowfall between 0 and 1),
  lead_time_hours numeric not null,
  lead_time_fit numeric not null check (lead_time_fit between 0 and 1),
  powder_score numeric not null check (powder_score between 0 and 1),
  created_at timestamptz not null default now()
);

create index if not exists idx_snow_scores_lookup on snow_scores (resort_id, target_date, computed_at desc);
create index if not exists idx_snow_scores_latest on snow_scores (resort_id, computed_at desc);

-- ---------------------------------------------------------------------------
-- snotel_actuals: ground truth, never joined into forward-looking scoring
-- ---------------------------------------------------------------------------
create table if not exists snotel_actuals (
  id uuid primary key default gen_random_uuid(),
  resort_id uuid not null references resorts (id) on delete cascade,
  station_triplet text,
  date date not null,
  observed_swe_mm numeric,
  observed_depth_change_in numeric,
  pulled_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (resort_id, date)
);

-- ---------------------------------------------------------------------------
-- alerts_fired
-- ---------------------------------------------------------------------------
create table if not exists alerts_fired (
  id uuid primary key default gen_random_uuid(),
  resort_id uuid not null references resorts (id) on delete cascade,
  snow_score_id uuid references snow_scores (id) on delete set null,
  fired_at timestamptz not null default now(),
  target_date_start date not null,
  target_date_end date not null,
  powder_score_at_trigger numeric not null,
  confidence_label text not null check (confidence_label in ('low', 'medium', 'high')),
  trip_opportunity_payload jsonb not null,
  delivery_status text not null default 'pending' check (delivery_status in ('pending', 'sent', 'failed', 'skipped_rate_limited')),
  recipients_count integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_alerts_fired_resort_time on alerts_fired (resort_id, fired_at desc);

-- ---------------------------------------------------------------------------
-- fare_cache (section 2.4)
-- ---------------------------------------------------------------------------
create table if not exists fare_cache (
  id uuid primary key default gen_random_uuid(),
  resort_id uuid not null references resorts (id) on delete cascade,
  origin_airport_code text not null,
  price_usd numeric,
  airline text,
  depart_date date,
  return_date date,
  fetched_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_fare_cache_lookup on fare_cache (resort_id, origin_airport_code, fetched_at desc);

-- ---------------------------------------------------------------------------
-- subscribers
-- ---------------------------------------------------------------------------
create table if not exists subscribers (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  clerk_user_id text,
  resort_prefs jsonb not null default '[]'::jsonb, -- array of resort UUIDs
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_subscribers_active on subscribers (active);

-- ---------------------------------------------------------------------------
-- social_posts (section 8)
-- ---------------------------------------------------------------------------
create table if not exists social_posts (
  id uuid primary key default gen_random_uuid(),
  alert_id uuid not null references alerts_fired (id) on delete cascade,
  graphic_url text not null,
  caption_text text not null,
  status text not null default 'draft' check (status in ('draft', 'approved', 'publishing', 'posted', 'failed')),
  ig_container_id text,
  ig_media_id text,
  posted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_social_posts_alert on social_posts (alert_id);

-- ---------------------------------------------------------------------------
-- accuracy_log: backtest output (section 5.5) — feeds season-long
-- calibration reporting, required before PART_2 (booking) begins
-- ---------------------------------------------------------------------------
create table if not exists accuracy_log (
  id uuid primary key default gen_random_uuid(),
  resort_id uuid not null references resorts (id) on delete cascade,
  snow_score_id uuid references snow_scores (id) on delete set null,
  target_date date not null,
  predicted_snowfall_in numeric not null,
  observed_equivalent_in numeric,
  accuracy_error_in numeric,
  lead_time_hours_at_prediction numeric not null,
  logged_at timestamptz not null default now(),
  unique (resort_id, target_date, lead_time_hours_at_prediction)
);

create index if not exists idx_accuracy_log_resort on accuracy_log (resort_id, target_date);

-- updated_at maintenance trigger
create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_resorts_updated_at on resorts;
create trigger trg_resorts_updated_at before update on resorts
  for each row execute function set_updated_at();

drop trigger if exists trg_subscribers_updated_at on subscribers;
create trigger trg_subscribers_updated_at before update on subscribers
  for each row execute function set_updated_at();

drop trigger if exists trg_social_posts_updated_at on social_posts;
create trigger trg_social_posts_updated_at before update on social_posts
  for each row execute function set_updated_at();
