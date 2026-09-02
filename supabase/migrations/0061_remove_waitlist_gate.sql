-- ============================================================================
-- 0061_remove_waitlist_gate.sql — new accounts are approved on arrival.
-- ----------------------------------------------------------------------------
-- The invite-only gate (0043, shipped 2026-08-05) held new signups at
-- approval_status='pending' behind a /waitlist screen until an admin approved
-- them. Removed on the founder's decision.
--
-- THE EVIDENCE, stated honestly because it is suggestive rather than conclusive.
-- Four accounts signed in and never fired onboarding_started. One is the App
-- Store review account and predates the gate. The other three — itayzit
-- (Aug 11), briebreezy (Aug 17), mcldkt (Sep 2) — all joined AFTER it shipped.
--
-- But three users who joined Aug 7, also after the gate, DID start onboarding
-- the same day. So the gate does not block everyone; the plausible reading is
-- that it blocks you until a human approves, and whether you ever return
-- depends on how quickly that happened. n=3 either way. At seven real testers
-- the gate was costing more than it protected.
--
-- REVERSIBLE ON PURPOSE. The column, the admin RPCs and the /waitlist screen
-- all stay. This changes the default and stops routing people there; putting it
-- back is one default change and one routing guard.
-- ============================================================================

alter table public.profiles
  alter column approval_status set default 'approved';

-- Nobody is pending today, but a row could have been created between the last
-- approval sweep and this migration.
update public.profiles
   set approval_status = 'approved'
 where approval_status is distinct from 'approved';

-- ----------------------------------------------------------------------------
-- Keep "someone joined" working
-- ----------------------------------------------------------------------------
-- The 0057 join notification fires on an UPDATE of approval_status into
-- 'approved'. With the new default that transition never happens — accounts are
-- born approved — so without this the broadcast silently stops firing for
-- exactly the people it exists to announce.
create or replace function public.enqueue_join_push_on_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  who text;
begin
  if coalesce(new.approval_status, '') <> 'approved' then
    return new;
  end if;
  if coalesce(new.profile_visibility, 'friends') = 'private' then
    return new;
  end if;

  who := coalesce(new.display_name, new.username, 'Someone new');

  insert into public.push_outbox (user_id, title, body, data, send_after, dedupe_key, expires_at)
  select
    r.id,
    who || ' joined Palate',
    'Say hi — see if your palates match.',
    jsonb_build_object('type', 'user_joined', 'user_id', new.id),
    public.next_sendable_at(r.timezone),
    'user_joined:' || new.id::text,
    now() + interval '3 days'
  from public.broadcast_recipients(new.id) r
  on conflict (user_id, dedupe_key) do nothing;

  return new;
end;
$$;

drop trigger if exists profiles_enqueue_join_push_insert on public.profiles;
create trigger profiles_enqueue_join_push_insert
  after insert on public.profiles
  for each row execute function public.enqueue_join_push_on_insert();

-- The dedupe key is shared with the UPDATE-path trigger, so an account that
-- somehow travels both routes still produces exactly one notification.
