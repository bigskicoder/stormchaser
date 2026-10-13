-- Model versioning: requested directly ("make the website 'save' previous
-- model versions which can be run and viewed from the admin dashboard,"
-- with comparison and rollback). Generalizes the pattern
-- resorts.slr_calibration_multiplier already used (a DB-stored, swappable
-- value instead of a hardcoded constant) to the rest of the scoring
-- engine's tunable parameters — reconciliation weights, powder_score
-- weights, confidence thresholds, which SLR strategy is active — so the
-- whole scoring configuration can be snapshotted, compared, activated, and
-- rolled back without a code deploy. See ROADMAP.md Phase C for the full
-- design writeup and what's deliberately NOT included (Kuchera's own
-- internal physics constants stay fixed, literature-grounded code, not an
-- admin-tunable business parameter).

create table if not exists model_versions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  status text not null default 'draft' check (status in ('draft', 'active', 'archived')),

  -- Global scoring configuration snapshot — mirrors lib/config/constants.ts's
  -- shape exactly (see lib/model-versions/resolve.ts's toScoringConfig).
  model_weights_by_bucket jsonb not null,
  model_disagreement_threshold numeric not null,
  ensemble_confidence_thresholds jsonb not null,
  ensemble_spread_normalization_ceiling_mm numeric not null,
  slr_strategy_name text not null default 'kuchera',
  powder_score_weights jsonb not null,
  confidence_weight_by_label jsonb not null,
  actionable_window_hours jsonb not null,
  lead_time_fit_decay_per_hour numeric not null,

  -- Per-resort SLR calibration multiplier snapshot at save time (resort_id
  -- -> multiplier), for historical comparison/rollback. NOT the live read
  -- path for current scoring — that stays resorts.slr_calibration_multiplier,
  -- same single-source-of-truth the live pipeline has always used.
  -- Activating a version writes this snapshot back onto the resorts table.
  resort_slr_multipliers jsonb not null default '{}'::jsonb,

  parent_version_id uuid references model_versions (id) on delete set null,
  -- 'system:baseline' (seeded from constants.ts at migration time),
  -- 'system:calibration:<recommendation_id>' (auto-created on an approved
  -- Phase B recommendation), or an admin's Clerk user id (manually
  -- created/edited).
  created_by text not null,
  -- Who activated the CURRENT activation (the admin's Clerk user id, or a
  -- 'system:*' tag) — distinct from created_by, since the person who
  -- authored a draft and the person who later activates it can differ.
  -- Overwritten each time the version is (re-)activated; the full history
  -- of activations is implicit in each version's own activated_at plus
  -- model_versions' created_at ordering, not separately logged — a simpler
  -- audit trail was judged sufficient for this feature's first pass.
  activated_by text,
  activated_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_model_versions_status on model_versions (status);
create index if not exists idx_model_versions_parent on model_versions (parent_version_id);

-- At most one active version at a time: every row satisfying status='active'
-- carries the identical value 'active' in that column, so a unique index
-- over it (scoped by the partial predicate) permits only one such row.
create unique index if not exists idx_model_versions_single_active
  on model_versions (status) where status = 'active';

alter table model_versions enable row level security;
-- No public policy — admin-only, same as forecast_pulls/accuracy_log
-- internals. Nothing here is part of the public transparency surface.

-- Traceability: which model version was active when a score/backtest row
-- was computed, so comparisons can aggregate real historical results by
-- version instead of needing to re-run anything. Nullable — existing rows
-- predate this column, and the live pipeline falls back to hardcoded
-- defaults when no active version exists yet (see resolve.ts).
alter table snow_scores add column if not exists model_version_id uuid references model_versions (id) on delete set null;
alter table accuracy_log add column if not exists model_version_id uuid references model_versions (id) on delete set null;

create index if not exists idx_snow_scores_model_version on snow_scores (model_version_id);
create index if not exists idx_accuracy_log_model_version on accuracy_log (model_version_id);
