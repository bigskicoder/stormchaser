-- Adds the resolved SNOTEL station triplet to resorts, so the daily SNOTEL
-- pull (section 2.2) and backtest join (section 5.5) have a stable key.
-- Resolved once via an onboarding lookup (lib/ingestion/snotel.ts
-- resolveNearestSnotelStation), analogous to the elevation-check onboarding
-- step in section 2.1a — not hardcoded in application code.

alter table resorts
  add column if not exists snotel_station_triplet text,
  add column if not exists snotel_station_distance_km numeric,
  add column if not exists snotel_resolved_at timestamptz;

-- Many Northeast/Midwest resorts have no nearby SNOTEL station at all —
-- NRCS SNOTEL is a western-US mountain snowpack telemetry network. A null
-- snotel_station_triplet after resolution means "no ground-truth coverage
-- available for this resort", not an error.
