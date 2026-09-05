-- ============================================================================
-- 0093_turn_on_server_push.sql — the notifications, switched on.
-- ----------------------------------------------------------------------------
-- NOT APPLIED BY AN AGENT. This migration starts sending push notifications
-- to other people's phones, which is the founder's call. Apply with
-- `supabase db push`; turn it back off with one update to feature_flags.
--
-- The founder logged a visit from his mother's phone and asked why nobody was
-- told. Measured LIVE, the answer had four parts and none was the trigger:
--
--   1. feature_flags.server_push = false. send-push refuses to send while it
--      is false, by design (0055). It has been false since it was created.
--   2. Nothing ever called send-push. The drain schedule in 0055 was written
--      and left commented out, so the outbox has been a table nobody reads.
--   3. broadcast_recipients and the visit trigger both require a recipient
--      timezone, and the app only started writing timezones in an update
--      published after that visit. (INFERENCE — profiles carries no
--      updated_at. Running the trigger's own insert by hand against that
--      visit now produces the row.)
--   4. The other path, the app calling notify-feed-post directly, was in the
--      same update, so the phone that logged the visit did not have it.
--
-- Cost: one edge invocation every five minutes, inside the plan's included
-- quota, sending nothing unless a row is due.
-- ============================================================================

-- 1. The switch.
update public.feature_flags set enabled = true where key = 'server_push';

-- 2. A friend's visit is news for a few hours, not a day. Without expires_at,
--    a row deferred by the daily cap would be delivered tomorrow as "just
--    logged a visit". Same trigger body as 0057 otherwise.
create or replace function public.enqueue_friend_visit_push()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_name text;
  actor_vis  text;
  place_name text;
begin
  select coalesce(display_name, split_part(email, '@', 1), 'A friend'),
         coalesce(profile_visibility, 'friends')
    into actor_name, actor_vis
    from public.profiles where id = new.user_id;

  if actor_vis = 'private' then
    return new;
  end if;

  select name into place_name
    from public.restaurants where id = new.restaurant_id;

  if place_name is null then
    return new;
  end if;

  insert into public.push_outbox (user_id, title, body, data, send_after, dedupe_key, expires_at)
  select
    f.friend_id,
    actor_name || ' just logged a visit',
    actor_name || ' ate at ' || place_name || '.',
    jsonb_build_object('type', 'friend_visit', 'visit_id', new.id, 'user_id', new.user_id),
    public.next_sendable_at(p.timezone),
    'friend_visit:' || new.id::text,
    now() + interval '12 hours'
  from (
    select case when requester_id = new.user_id then addressee_id else requester_id end as friend_id
      from public.friendships
     where status = 'accepted'
       and (requester_id = new.user_id or addressee_id = new.user_id)
  ) f
  join public.profiles p on p.id = f.friend_id
  where p.push_social_activity
    and p.push_token is not null
    and public.next_sendable_at(p.timezone) is not null
  on conflict (user_id, dedupe_key) do nothing;

  return new;
end;
$$;

-- 3. The drain. Same shape as the two working crons: the secret comes from
--    the vault, the function checks it (send-push is deployed --no-verify-jwt
--    with its own x-cron-secret gate), and the gateway is not involved.
--    timeout_milliseconds is set because pg_net's 5s default is what timed
--    out the featured-lists job on 2026-09-05.
select cron.unschedule(jobid) from cron.job where jobname = 'drain_push_outbox';
select cron.schedule(
  'drain_push_outbox',
  '*/5 * * * *',
  $cron$
    select net.http_post(
      url := 'https://oxzsspbojeyeelbjqjdx.supabase.co/functions/v1/send-push',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', coalesce(
          (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret' limit 1),
          ''
        )
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 30000
    ) as request_id;
  $cron$
);

-- 4. The nightly featured-lists refresh has been hitting pg_net's 5s default
--    timeout (LIVE: "Timeout of 5000 ms reached" at 04:00 on 2026-09-05).
update cron.job
   set command = replace(command,
                         E'body := jsonb_build_object(\'action\', \'refresh_all_active\')',
                         E'body := jsonb_build_object(\'action\', \'refresh_all_active\'),\n      timeout_milliseconds := 120000')
 where jobname = 'featured_lists_refresh_nightly'
   and command not like '%timeout_milliseconds%';

do $$
begin
  if not exists (select 1 from cron.job where jobname = 'drain_push_outbox' and active) then
    raise exception '0093: drain_push_outbox is not scheduled';
  end if;
  if not exists (select 1 from public.feature_flags where key = 'server_push' and enabled) then
    raise exception '0093: server_push is still off';
  end if;
  if not exists (select 1 from cron.job where jobname = 'featured_lists_refresh_nightly' and command like '%timeout_milliseconds := 120000%') then
    raise exception '0093: featured-lists cron did not take the timeout';
  end if;
end $$;
