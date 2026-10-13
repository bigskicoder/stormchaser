-- Widens accuracy_log's uniqueness to include model_version_id.
--
-- Why: comparing model versions (lib/model-versions/compare.ts) means
-- backtesting the SAME resort/date/lead-time/source under two different
-- model_versions rows — e.g. once under the active version, once under a
-- draft being evaluated before activation (see scripts/backtest-*.ts's
-- --version flag). The old 4-column constraint
-- (resort_id, target_date, lead_time_hours_at_prediction, source) would
-- make the second backtest's upsert silently overwrite the first version's
-- row instead of producing a second, comparable one.
--
-- Postgres unique indexes never treat two NULLs as equal, so this 5-column
-- index alone gives NO duplicate protection for rows where model_version_id
-- IS NULL (pre-model-versioning legacy rows, or any write that races ahead
-- of a model_versions baseline). That's accepted here, not overlooked:
-- lib/model-versions/create.ts's createBaselineVersionIfNoneExists() is now
-- called from scripts/seed-resorts.ts, so by the time this matters in
-- practice every resort roster has an active version and every new
-- accuracy_log write (live or backtest) carries a real model_version_id —
-- see that function's own doc comment.
alter table accuracy_log drop constraint if exists accuracy_log_resort_date_leadtime_source_key;

create unique index if not exists idx_accuracy_log_resort_date_leadtime_source_version
  on accuracy_log (resort_id, target_date, lead_time_hours_at_prediction, source, model_version_id);
