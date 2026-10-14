-- Parallel model-version scoring ("shadow scoring"), requested directly:
-- "can you produce multiple models and in season 1 we can run them parallel
-- and compare? (Build in compare)". Model versioning (0007/0008) already
-- supports exactly one ACTIVE version at a time plus retrospective
-- comparison across whichever versions were active/backtested at different
-- times. This migration adds genuine same-storm, same-data parallel
-- scoring: one or more additional "shadow" versions get computed on the
-- exact same live forecast inputs as the active version, every run, so a
-- season's worth of real accuracy_log data accumulates for several models
-- at once instead of sequentially.
--
-- is_primary distinguishes the production score (drives the public site
-- and the alert trigger) from a shadow version's score (comparison only,
-- never public-facing, never alert-triggering) for the SAME resort/date/run.
-- Defaults to true: every snow_scores/accuracy_log row written before this
-- migration, and every row written by a path that doesn't yet know about
-- shadowing (the historical backtest scripts), was/is the production score.
alter table snow_scores add column if not exists is_primary boolean not null default true;
create index if not exists idx_snow_scores_primary on snow_scores (resort_id, target_date) where is_primary = true;

alter table accuracy_log add column if not exists is_primary boolean not null default true;

-- is_shadow marks a model_versions row as currently being scored in
-- parallel. Orthogonal to status (draft/active/archived) — a draft can be
-- shadowed while iterating on it, and a version keeps accumulating
-- comparison data while shadowed regardless of status, EXCEPT active: the
-- active version is already scored as the primary row every run, so
-- shadowing it too would just duplicate the same computation. Enforced in
-- the database, not just application code, matching the existing
-- single-active-version partial unique index's own reasoning.
alter table model_versions add column if not exists is_shadow boolean not null default false;
alter table model_versions add constraint model_versions_active_not_shadow check (not (status = 'active' and is_shadow));
create index if not exists idx_model_versions_shadow on model_versions (is_shadow) where is_shadow = true;
