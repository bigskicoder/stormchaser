-- Hour-by-hour rain/snow split (lib/scoring/phase-split.ts). A day used to
-- be all rain or all snow from one temperature; now each hour is phased on
-- its own, so a scored day can be part rain, part snow, with a changeover.
-- is_rain_case keeps its column but now means "no snow at all".
alter table snow_scores add column if not exists snow_fraction numeric;
alter table snow_scores add column if not exists phase_change text check (phase_change in ('rain_to_snow', 'snow_to_rain'));
alter table snow_scores add column if not exists phase_change_at timestamptz;
