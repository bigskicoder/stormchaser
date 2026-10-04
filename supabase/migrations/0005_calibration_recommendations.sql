-- ROADMAP Phase B: self-tuning SLR calibration, recommend-only mode.
-- A cron job proposes a new resorts.slr_calibration_multiplier per resort
-- based on recent accuracy_log history; nothing is applied until an admin
-- approves it via /admin/calibration (see lib/calibration/).

create table if not exists calibration_recommendations (
  id uuid primary key default gen_random_uuid(),
  resort_id uuid not null references resorts (id) on delete cascade,
  computed_at timestamptz not null default now(),
  sample_count integer not null,
  mean_signed_error_in numeric not null,
  current_multiplier numeric not null,
  recommended_multiplier numeric not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_by text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_calibration_recommendations_resort
  on calibration_recommendations (resort_id, status, computed_at desc);

alter table calibration_recommendations enable row level security;
-- No public policy: service-role (cron) writes, admin-authenticated reads/writes
-- go through service-role server code in src/app/admin/calibration, same
-- pattern as the rest of the admin panel.
