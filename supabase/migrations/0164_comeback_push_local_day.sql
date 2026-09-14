-- ============================================================================
-- 0164 — "Not since Sunday" about a Saturday dinner.
-- ----------------------------------------------------------------------------
-- enqueue_comeback_pushes formats the day name with to_char(last_at, 'FMDay')
-- on a timestamptz, in a UTC session. A Saturday 8pm dinner in Memphis is
-- Sunday 01:00 UTC, so the push tells somebody they have not been since
-- SUNDAY -- naming a day they were not there, about a meal they remember
-- perfectly well. Every evening visit west of Greenwich gets the wrong day.
--
-- Latent until this morning. The cron has been active at 23:00 daily and
-- server_push was switched on today, so it is armed and wrong.
--
-- Same fix as 0151, 0158 and 0163: read visits.local_date, the calendar date
-- the person actually experienced, falling back to the UTC date only for rows
-- written before that column existed.
--
-- NOT profiles.timezone, deliberately: it is null on more than half of
-- profiles, and it says where somebody LIVES rather than where they ATE, so a
-- dinner on a trip would be misnamed all over again.
--
-- Patched by rewriting the DEPLOYED source rather than retyping the function,
-- so this is provably a formatting change and not a silent rewrite of who gets
-- a comeback nudge. It refuses to apply if the expected text is not found.
-- ============================================================================
do $$
declare src text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'enqueue_comeback_pushes';
  if src is null then
    raise exception 'enqueue_comeback_pushes not found';
  end if;

  src := replace(src,
    'max(v.visited_at) as last_at',
    'max(v.visited_at) as last_at, max(coalesce(v.local_date, (v.visited_at at time zone ''UTC'')::date)) as last_local_date');
  src := replace(src, 'to_char(fav.last_at, ''FMDay'')',   'to_char(fav.last_local_date, ''FMDay'')');
  src := replace(src, 'to_char(fav.last_at, ''FMMonth'')', 'to_char(fav.last_local_date, ''FMMonth'')');

  if position('last_local_date' in src) = 0 then
    raise exception 'comeback rewrite matched nothing; the deployed source has changed shape';
  end if;
  if position('to_char(fav.last_at' in src) > 0 then
    raise exception 'a to_char on the raw timestamp survived the rewrite';
  end if;

  execute src;
  raise notice 'comeback push now names the day the person actually ate';
end $$;
