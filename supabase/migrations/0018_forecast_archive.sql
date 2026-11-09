-- Archive of old forecast runs (scripts/archive-forecast-pulls.ts).
-- forecast_pulls keeps every hourly run's full 10-day forecast, but only
-- the newest run per hour is ever read. Older runs are written to gzipped
-- JSON Lines files in the private 'forecast-archive' Storage bucket, then
-- removed from the table by exact id, so the raw data is kept outside the
-- database at a fraction of the cost.

insert into storage.buckets (id, name, public) values ('forecast-archive', 'forecast-archive', false)
  on conflict (id) do nothing;

create table if not exists forecast_archive_log (
  run_date date not null,
  part integer not null,
  object_path text not null,
  row_count integer not null,
  bytes integer not null,
  first_id uuid,
  last_id uuid,
  deleted boolean not null default false,
  archived_at timestamptz not null default now(),
  primary key (run_date, part)
);
alter table forecast_archive_log enable row level security;

-- Rows from runs started on p_run_date that nothing reads any more: every
-- row whose hour is more than 14 days past, and any row a newer run of the
-- same model has replaced. Keyset-paged by (run_init_time, id), which the
-- run_init_time index serves; returned as one JSON array
-- so a page can be bigger than PostgREST's 1,000-row cap.
create or replace function forecast_archive_chunk(p_run_date date, p_after_time timestamptz, p_after_id uuid, p_limit integer)
returns json
language sql stable
as $$
  select coalesce(json_agg(t order by t.run_init_time, t.id), '[]'::json) from (
  select f.* from forecast_pulls f
  where f.run_init_time >= p_run_date and f.run_init_time < p_run_date + 1
    and (p_after_time is null or (f.run_init_time, f.id) > (p_after_time, p_after_id))
    and (
      f.valid_time < now() - interval '14 days'
      or exists (
        select 1 from forecast_pulls n
        where n.resort_id = f.resort_id and n.model_name = f.model_name
          and n.elevation_band = f.elevation_band and n.valid_time = f.valid_time
          and n.run_init_time > f.run_init_time
      )
    )
  order by f.run_init_time, f.id
  limit p_limit
  ) t
$$;
revoke execute on function forecast_archive_chunk(date, timestamptz, uuid, integer) from public, anon, authenticated;

create or replace function forecast_archive_delete(p_ids uuid[])
returns integer
language sql
as $$
  with d as (delete from forecast_pulls where id = any(p_ids) returning 1) select count(*)::integer from d
$$;
revoke execute on function forecast_archive_delete(uuid[]) from public, anon, authenticated;
grant execute on function forecast_archive_chunk(date, timestamptz, uuid, integer) to service_role;
grant execute on function forecast_archive_delete(uuid[]) to service_role;
