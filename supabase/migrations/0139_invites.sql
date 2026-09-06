-- ============================================================================
-- 0139 — invites: who brought whom, and one thing to share.
-- ----------------------------------------------------------------------------
-- Nothing in this app has ever asked anybody to bring a friend. There is a
-- share sheet for a Wrapped image and that is all: no code, no link, no record
-- of who arrived because of whom. For an app whose recommendations lean on the
-- people you follow, that is the loop left unbuilt.
--
-- The invite-only gate is gone (0061), so a code is NOT a key. Nobody is kept
-- out without one and nobody gets in faster with one. All it does is two
-- things: it records the referral, and it gives the new account somebody to
-- follow on day one instead of an empty feed.
--
-- Codes are six characters from an unambiguous alphabet (no I, O, 0, 1) so a
-- person can read one off a screen and type it without a support ticket.
-- ============================================================================

alter table public.profiles
  add column if not exists invite_code text,
  add column if not exists invited_by uuid references public.profiles(id) on delete set null;

create unique index if not exists profiles_invite_code_key
  on public.profiles (invite_code) where invite_code is not null;
create index if not exists profiles_invited_by_idx
  on public.profiles (invited_by) where invited_by is not null;

-- Ambiguity is the enemy of a code somebody reads aloud.
create or replace function public.gen_invite_code()
returns text language plpgsql volatile as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  candidate text;
  i int;
begin
  for attempt in 1..20 loop
    candidate := '';
    for i in 1..6 loop
      candidate := candidate || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    if not exists (select 1 from public.profiles p where p.invite_code = candidate) then
      return candidate;
    end if;
  end loop;
  -- Twenty collisions against a 32^6 space means something is very wrong;
  -- fall back to something guaranteed unique rather than returning null.
  return upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
end $$;

-- Everyone existing gets one now; everyone new gets one on insert.
update public.profiles set invite_code = public.gen_invite_code() where invite_code is null;

create or replace function public.set_invite_code()
returns trigger language plpgsql as $$
begin
  if new.invite_code is null then new.invite_code := public.gen_invite_code(); end if;
  return new;
end $$;

drop trigger if exists profiles_invite_code on public.profiles;
create trigger profiles_invite_code before insert on public.profiles
  for each row execute function public.set_invite_code();

-- ---- redeeming ------------------------------------------------------------
-- Definer because it reads another person's profile row by code, which RLS
-- correctly forbids. It returns only what the app needs to offer a follow:
-- the inviter's id, name and handle. Never their email, never their visits.
create or replace function public.redeem_invite(p_code text)
returns table (inviter_id uuid, display_name text, username text)
language plpgsql volatile security definer set search_path = public as $$
declare me uuid := auth.uid(); target uuid; already uuid;
begin
  if me is null then return; end if;
  if p_code is null or length(btrim(p_code)) = 0 then return; end if;

  -- Set once. A referral is a fact about how somebody arrived, and letting it
  -- be rewritten later would make it worthless as a record and would let
  -- someone farm follows by cycling codes.
  select p.invited_by into already from public.profiles p where p.id = me;
  if already is not null then return; end if;

  select p.id into target from public.profiles p
   where upper(p.invite_code) = upper(btrim(p_code));
  if target is null or target = me then return; end if;   -- no self-invites

  update public.profiles set invited_by = target where id = me;

  return query
    select p.id, p.display_name, p.username from public.profiles p where p.id = target;
end $$;

revoke all on function public.redeem_invite(text) from public, anon;
grant execute on function public.redeem_invite(text) to authenticated;

-- ---- your own code and count ----------------------------------------------
create or replace function public.invite_summary()
returns table (code text, joined integer)
language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null then return; end if;
  return query
    select p.invite_code,
           (select count(*)::int from public.profiles c where c.invited_by = me)
      from public.profiles p where p.id = me;
end $$;

revoke all on function public.invite_summary() from public, anon;
grant execute on function public.invite_summary() to authenticated;

-- ---- proofs --------------------------------------------------------------
do $$
declare a uuid; b uuid; code_a text; n int; got uuid; cnt int;
begin
  select id into a from public.profiles order by created_at limit 1;
  select id into b from public.profiles where id <> a order by created_at limit 1;

  -- Everybody has a code, and they are unique.
  select count(*) into n from public.profiles where invite_code is null;
  if n <> 0 then raise exception '0139: % profiles still have no invite code', n; end if;
  select count(*) into n from (
    select invite_code from public.profiles group by 1 having count(*) > 1) x;
  if n <> 0 then raise exception '0139: % invite codes collide', n; end if;

  if a is null or b is null then
    raise notice '0139: fewer than two profiles, redemption proof skipped';
    return;
  end if;

  select invite_code into code_a from public.profiles where id = a;

  -- Signed out: nothing, and no error.
  perform set_config('request.jwt.claims', null, true);
  select count(*) into n from public.redeem_invite(code_a);
  if n <> 0 then raise exception '0139: a signed-out caller redeemed an invite'; end if;

  -- You cannot invite yourself.
  perform set_config('request.jwt.claims', json_build_object('sub', a::text)::text, true);
  select count(*) into n from public.redeem_invite(code_a);
  if n <> 0 then raise exception '0139: self-invite was accepted'; end if;
  select invited_by into got from public.profiles where id = a;
  if got is not null then raise exception '0139: self-invite wrote invited_by'; end if;

  -- A real redemption, then proof it cannot be overwritten.
  perform set_config('request.jwt.claims', json_build_object('sub', b::text)::text, true);
  select inviter_id into got from public.redeem_invite(code_a);
  if got is distinct from a then raise exception '0139: redemption did not return the inviter'; end if;
  select invited_by into got from public.profiles where id = b;
  if got is distinct from a then raise exception '0139: invited_by was not set'; end if;

  select count(*) into n from public.redeem_invite(code_a);
  if n <> 0 then raise exception '0139: a second redemption was allowed'; end if;

  -- The inviter can see the count.
  perform set_config('request.jwt.claims', json_build_object('sub', a::text)::text, true);
  select joined into cnt from public.invite_summary();
  if cnt < 1 then raise exception '0139: invite_summary did not count the join'; end if;
  raise notice '0139: invites work; the seed inviter now shows % join(s)', cnt;

  -- Leave the database as it was found.
  perform set_config('request.jwt.claims', null, true);
  update public.profiles set invited_by = null where id = b;
end $$;
