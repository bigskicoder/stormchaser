-- One row per ingest cron run with its error list, so failures are visible
-- from the database. Vercel's runtime logs aren't readable from every tool
-- that operates this project, and the cron's JSON response is only seen by
-- Vercel's scheduler. Service-role only (RLS on, no policies).
create table if not exists cron_runs (
  id uuid primary key default gen_random_uuid(),
  job text not null,
  ran_at timestamptz not null default now(),
  resorts int,
  rows_written int,
  error_count int not null default 0,
  -- First 50 error messages; API keys are stripped before they get here.
  errors jsonb not null default '[]'::jsonb
);
create index if not exists idx_cron_runs_job_ran_at on cron_runs (job, ran_at desc);
alter table cron_runs enable row level security;
