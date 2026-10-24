-- Calibration now replaces a waiting recommendation instead of skipping the
-- resort (lib/calibration/generate.ts). The older pending row is kept for
-- the record with status 'superseded', so admin only shows the latest.
alter table calibration_recommendations drop constraint if exists calibration_recommendations_status_check;
alter table calibration_recommendations add constraint calibration_recommendations_status_check
  check (status in ('pending', 'approved', 'rejected', 'superseded'));
