-- ============================================================================
-- 0065_batch_taste_features.sql — one round trip instead of N.
-- ----------------------------------------------------------------------------
-- The People directory and the friends list both compute a palate match per
-- person, and each one calls friend_taste_features(target_id) separately. At 13
-- accounts that is fine. At 50 it is 50 round trips to render one list, every
-- time the screen opens, and the list cannot show a score until the slowest one
-- returns.
--
-- This is the same function over an array. The per-user version stays — the
-- profile screen legitimately wants exactly one person, and rewriting that call
-- site to pass a one-element array would be worse code for no gain.
--
-- The visibility gate is IDENTICAL and applied per element: an unauthorized id
-- yields an unauthorized entry rather than being silently dropped, so the
-- caller can tell "not allowed" apart from "no such person". Batching must not
-- become a way to widen access.
-- ============================================================================

create or replace function public.friend_taste_features_batch(target_ids uuid[])
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  out_obj jsonb := '{}'::jsonb;
  tid uuid;
begin
  if target_ids is null or array_length(target_ids, 1) is null then
    return out_obj;
  end if;

  -- Bounded so one call cannot ask for the whole user table.
  if array_length(target_ids, 1) > 100 then
    raise exception 'too many ids';
  end if;

  foreach tid in array target_ids loop
    out_obj := out_obj || jsonb_build_object(
      tid::text,
      public.friend_taste_features(tid)
    );
  end loop;

  return out_obj;
end;
$function$;

revoke all on function public.friend_taste_features_batch(uuid[]) from public;
grant execute on function public.friend_taste_features_batch(uuid[]) to authenticated;
