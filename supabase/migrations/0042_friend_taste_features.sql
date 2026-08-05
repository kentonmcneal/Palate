-- 0042_friend_taste_features.sql
-- ----------------------------------------------------------------------------
-- Gated cross-user read of a friend's visit-derived taste inputs, so the client
-- can compute palate compatibility + joint "where should we eat" recommendations
-- between two friends WITHOUT loosening the owner-only RLS on `visits`.
--
-- Mirrors the authorization gate in 0008_friend_profile_snapshot: SECURITY
-- DEFINER + are_friends() + profile_visibility. Returns nothing derived from the
-- friend's data unless the caller is that friend (accepted) and the target's
-- visibility allows it. Returns the visit rows in the exact shape the client's
-- taste-vector `aggregate()` consumes (visited_at, meal_type, restaurant{...}).
-- ----------------------------------------------------------------------------

create or replace function public.friend_taste_features(target_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  vis text;
  is_friends boolean;
  is_me boolean;
begin
  is_me := (auth.uid() = target_id);

  select profile_visibility::text into vis
  from public.profiles
  where profiles.id = target_id;

  if vis is null then
    return jsonb_build_object('authorized', false, 'reason', 'not_found');
  end if;

  is_friends := public.are_friends(auth.uid(), target_id);

  -- Visibility gate — same rules as get_friend_profile_snapshot.
  if not is_me and (vis = 'private' or (vis = 'friends' and not is_friends)) then
    return jsonb_build_object('authorized', false, 'reason', 'not_authorized');
  end if;

  -- Authorized: return the friend's visit rows + a count.
  return jsonb_build_object(
    'authorized', true,
    'visit_count', (select count(*)::int from public.visits where user_id = target_id),
    'visits', coalesce((
      select jsonb_agg(jsonb_build_object(
        'visited_at', v.visited_at,
        'meal_type', v.meal_type,
        'restaurant', jsonb_build_object(
          'id',              r.id,
          'name',            r.name,
          'cuisine_type',    r.cuisine_type,
          'cuisine_region',  r.cuisine_region,
          'cuisine_subregion', r.cuisine_subregion,
          'format_class',    r.format_class,
          'chain_type',      r.chain_type,
          'occasion_tags',   r.occasion_tags,
          'flavor_tags',     r.flavor_tags,
          'cultural_context', r.cultural_context,
          'neighborhood',    r.neighborhood,
          'latitude',        r.latitude,
          'longitude',       r.longitude,
          'price_level',     r.price_level
        )
      ))
      from public.visits v
      join public.restaurants r on r.id = v.restaurant_id
      where v.user_id = target_id
    ), '[]'::jsonb)
  );
end;
$$;

grant execute on function public.friend_taste_features(uuid) to authenticated;
