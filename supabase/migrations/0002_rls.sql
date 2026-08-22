-- RLS: public/anon read access for transparency-required tables (section 10.5
-- "no paywall" — forecast display must not be gated behind auth). All writes
-- go through the service-role key from server-side code only; anon/public
-- gets SELECT-only on the tables the public site renders.

alter table resorts enable row level security;
alter table snow_scores enable row level security;
alter table alerts_fired enable row level security;
alter table subscribers enable row level security;
alter table forecast_pulls enable row level security;
alter table ensemble_pulls enable row level security;
alter table snotel_actuals enable row level security;
alter table fare_cache enable row level security;
alter table social_posts enable row level security;
alter table accuracy_log enable row level security;

-- Public read: resorts + their current scores (the site's core transparency
-- surface). No public read on internal raw model pulls, subscriber PII,
-- social posting drafts, or fare cache internals.
drop policy if exists resorts_public_read on resorts;
create policy resorts_public_read on resorts for select using (active = true);

drop policy if exists snow_scores_public_read on snow_scores;
create policy snow_scores_public_read on snow_scores for select using (true);

drop policy if exists alerts_fired_public_read on alerts_fired;
create policy alerts_fired_public_read on alerts_fired for select using (true);

-- Subscriber insert: allow anon INSERT only (email capture form), no
-- SELECT/UPDATE/DELETE from the client — those go through service role.
drop policy if exists subscribers_public_insert on subscribers;
create policy subscribers_public_insert on subscribers for insert
  with check (true);

-- No policies created for forecast_pulls / ensemble_pulls / snotel_actuals /
-- fare_cache / social_posts / accuracy_log => RLS default-denies all access
-- to anon/authenticated roles; only the service-role key (which bypasses RLS)
-- can read/write them, which is exactly what server-side cron + admin routes
-- use.
