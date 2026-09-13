-- ============================================================================
-- 0147_receipt_forwarding.sql — receipts without asking for the mailbox.
-- ----------------------------------------------------------------------------
-- gmail.readonly is a RESTRICTED scope. Every user who tapped "Connect Gmail"
-- met Google's full-page "this app hasn't been verified / BACK TO SAFETY"
-- interstitial, and no console setting removes it: restricted scopes need OAuth
-- verification plus an annual CASA Tier 2 assessment (~$540-675/yr, ~6 weeks).
-- We withdrew the offer (mobile/lib/gmail-gate.ts) rather than ship onboarding
-- that tells a new user the app is unsafe.
--
-- Forwarding gets the same receipts with none of that. The user forwards the
-- confirmation — once by hand, or forever via one Gmail filter — to a personal
-- address. No OAuth, no review, no annual fee, and it works for people who are
-- not on Gmail at all, which the old path never did.
--
-- Two tables:
--
--   receipt_ingest_tokens  the secret half of that address. Per user, rotatable,
--                          and the ONLY thing standing between a stranger and
--                          writing into somebody's inbox — the From header is
--                          trivially forged, so it is never the identity.
--   email_receipts         what arrived, parsed, PENDING. Mail lands while the
--                          app is closed, so unlike the Gmail flow (which
--                          previewed and committed inside one session) there
--                          has to be somewhere for it to wait.
--
-- Nothing here writes a visit. Same rule as 0-day import review: the app
-- proposes, the person decides. A parser mistake that reaches the taste graph
-- surfaces later as bad taste rather than as a bug.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. The token that IS the identity.
-- ----------------------------------------------------------------------------
create table if not exists public.receipt_ingest_tokens (
  user_id    uuid        primary key references auth.users(id) on delete cascade,
  token      text        not null unique,
  created_at timestamptz not null default now(),
  rotated_at timestamptz
);

alter table public.receipt_ingest_tokens enable row level security;

-- Readable only by its owner. There is no insert/update/delete policy at all:
-- the token is minted by the definer function below, never by the client, so
-- nobody can choose their own token or overwrite somebody else's.
drop policy if exists "receipt_ingest_tokens: own row" on public.receipt_ingest_tokens;
create policy "receipt_ingest_tokens: own row"
  on public.receipt_ingest_tokens for select
  using (user_id = auth.uid());

-- ----------------------------------------------------------------------------
-- 2. What arrived.
-- ----------------------------------------------------------------------------
create table if not exists public.email_receipts (
  id             uuid        primary key default gen_random_uuid(),
  user_id        uuid        not null references auth.users(id) on delete cascade,
  -- Which platform sent the ORIGINAL mail, not who forwarded it.
  sender_domain  text,
  subject        text,
  restaurant_name text       not null,
  visited_at     timestamptz not null,
  meal_type      text,
  source         text        not null,            -- reservation | delivery | pos
  status         text        not null default 'pending',  -- pending | accepted | rejected
  visit_id       uuid        references public.visits(id) on delete set null,
  -- Same message forwarded twice (a hand-forward plus the filter that was set
  -- up afterwards) must not become two visits.
  dedupe_key     text        not null,
  created_at     timestamptz not null default now(),
  constraint email_receipts_status_ck check (status in ('pending','accepted','rejected'))
);

create unique index if not exists email_receipts_dedupe_idx
  on public.email_receipts (user_id, dedupe_key);

create index if not exists email_receipts_pending_idx
  on public.email_receipts (user_id, created_at desc)
  where status = 'pending';

alter table public.email_receipts enable row level security;

-- Read and decide on your own; never insert from the client. Rows are written
-- by the ingest function under the service role, which is the only party that
-- has actually seen the email.
drop policy if exists "email_receipts: own read" on public.email_receipts;
create policy "email_receipts: own read"
  on public.email_receipts for select
  using (user_id = auth.uid());

drop policy if exists "email_receipts: own decide" on public.email_receipts;
create policy "email_receipts: own decide"
  on public.email_receipts for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "email_receipts: own delete" on public.email_receipts;
create policy "email_receipts: own delete"
  on public.email_receipts for delete
  using (user_id = auth.uid());

-- ----------------------------------------------------------------------------
-- 3. Minting and rotating, server-side.
-- ----------------------------------------------------------------------------
-- gen_random_bytes(12) -> 24 hex chars. Long enough that guessing an address is
-- not a strategy, short enough to read off a screen and retype if the copy
-- button fails on somebody's phone.
create or replace function public.my_receipt_token(p_rotate boolean default false)
returns text
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_token text;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;

  if p_rotate then
    update public.receipt_ingest_tokens
       set token = encode(extensions.gen_random_bytes(12), 'hex'),
           rotated_at = now()
     where user_id = auth.uid()
    returning token into v_token;
    if v_token is not null then return v_token; end if;
  end if;

  select token into v_token
    from public.receipt_ingest_tokens
   where user_id = auth.uid();
  if v_token is not null then return v_token; end if;

  insert into public.receipt_ingest_tokens (user_id, token)
  values (auth.uid(), encode(extensions.gen_random_bytes(12), 'hex'))
  on conflict (user_id) do update set token = public.receipt_ingest_tokens.token
  returning token into v_token;

  return v_token;
end;
$$;

revoke all on function public.my_receipt_token(boolean) from public, anon;
grant execute on function public.my_receipt_token(boolean) to authenticated;
