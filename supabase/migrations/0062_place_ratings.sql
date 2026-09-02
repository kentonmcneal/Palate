-- ============================================================================
-- 0062_place_ratings.sql — the ranked list, one comparison at a time.
-- ----------------------------------------------------------------------------
-- Beli's ranked list is the strongest food-identity artifact on the market and
-- its weakness is that ranking is manual labour forever. Passive capture
-- already knows where someone ate, so the only thing we need from them is
-- preference — and we ask for it one question at a time rather than making them
-- binary-search a new place into position.
--
-- Elo rather than insertion sort, for that reason exactly: see mobile/lib/
-- ranking.ts. Each answer nudges two ratings; the order emerges.
--
-- TWO TABLES ON PURPOSE. place_ratings is current state, which is what the UI
-- reads. rating_comparisons is the append-only log of answers, which is what
-- lets us recompute from scratch if the K-factor or the algorithm changes. A
-- rating with no history behind it is unrecoverable the first time the maths
-- needs tuning.
-- ============================================================================

create table if not exists public.place_ratings (
  user_id       uuid        not null references auth.users(id) on delete cascade,
  restaurant_id uuid        not null references public.restaurants(id) on delete cascade,
  rating        double precision not null default 1500,
  comparisons   integer     not null default 0,
  updated_at    timestamptz not null default now(),
  primary key (user_id, restaurant_id)
);

create index if not exists place_ratings_user_rank_idx
  on public.place_ratings (user_id, rating desc);

comment on table public.place_ratings is
  'Per-user Elo rating for a restaurant, built from pairwise comparisons. Current state; the answers themselves live in rating_comparisons.';

-- Append-only. Never updated, never deleted except by cascade.
create table if not exists public.rating_comparisons (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid        not null references auth.users(id) on delete cascade,
  winner_id  uuid        not null references public.restaurants(id) on delete cascade,
  loser_id   uuid        not null references public.restaurants(id) on delete cascade,
  created_at timestamptz not null default now(),
  -- A place cannot beat itself; without this a UI bug could silently corrupt
  -- a rating by comparing something to itself.
  constraint rating_comparisons_distinct check (winner_id <> loser_id)
);

create index if not exists rating_comparisons_user_idx
  on public.rating_comparisons (user_id, created_at desc);

comment on table public.rating_comparisons is
  'Append-only log of pairwise answers. Exists so ratings can be recomputed from source if the algorithm changes — a rating with no history behind it is unrecoverable the first time the maths needs tuning.';

-- ----------------------------------------------------------------------------
-- RLS — a person owns their own preferences, full stop
-- ----------------------------------------------------------------------------
alter table public.place_ratings      enable row level security;
alter table public.rating_comparisons enable row level security;

drop policy if exists "own place ratings" on public.place_ratings;
create policy "own place ratings" on public.place_ratings
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "own rating comparisons" on public.rating_comparisons;
create policy "own rating comparisons" on public.rating_comparisons
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

grant select, insert, update, delete on public.place_ratings      to authenticated;
grant select, insert                 on public.rating_comparisons to authenticated;
