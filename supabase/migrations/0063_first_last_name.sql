-- ============================================================================
-- 0063_first_last_name.sql — people should have names.
-- ----------------------------------------------------------------------------
-- Several testers render as an email prefix — briebreezy.collabs, itayzit, gd —
-- because nothing ever asked them for a name, and display_name falls back to
-- split_part(email, '@', 1). The People directory looks like a database dump
-- as a direct result.
--
-- display_name STAYS as the single thing the UI reads. These are the inputs to
-- it, not a replacement: every existing surface keeps working, and the trigger
-- below keeps display_name in step when the parts change.
--
-- Deliberately NOT adding phone number. It is sensitive PII with consent
-- implications, the privacy policy does not currently cover it, and there is no
-- use for it yet.
-- ============================================================================

alter table public.profiles
  add column if not exists first_name text,
  add column if not exists last_name  text;

alter table public.profiles
  drop constraint if exists profiles_first_name_len,
  add constraint profiles_first_name_len
    check (first_name is null or char_length(first_name) between 1 and 40);
alter table public.profiles
  drop constraint if exists profiles_last_name_len,
  add constraint profiles_last_name_len
    check (last_name is null or char_length(last_name) between 1 and 40);

comment on column public.profiles.first_name is
  'Input to display_name, not a replacement for it. The UI reads display_name everywhere; keep_display_name_in_step() keeps them consistent.';

-- ----------------------------------------------------------------------------
-- Keep display_name in step
-- ----------------------------------------------------------------------------
-- Only ever DERIVES display_name from the parts when the parts are what
-- changed. A user who set a display name directly — a nickname, a handle, a
-- single mononym — keeps it, because overwriting someone's chosen name with
-- "Firstname Lastname" is the kind of helpfulness nobody asked for.
create or replace function public.keep_display_name_in_step()
returns trigger
language plpgsql
as $$
declare
  composed text;
begin
  if new.first_name is null and new.last_name is null then
    return new;
  end if;

  -- Only act when the name parts actually changed on this write.
  if tg_op = 'UPDATE'
     and new.first_name is not distinct from old.first_name
     and new.last_name  is not distinct from old.last_name then
    return new;
  end if;

  composed := btrim(concat_ws(' ', nullif(btrim(new.first_name), ''), nullif(btrim(new.last_name), '')));
  if composed = '' then
    return new;
  end if;

  new.display_name := composed;
  return new;
end;
$$;

drop trigger if exists profiles_display_name_in_step on public.profiles;
create trigger profiles_display_name_in_step
  before insert or update of first_name, last_name on public.profiles
  for each row execute function public.keep_display_name_in_step();
