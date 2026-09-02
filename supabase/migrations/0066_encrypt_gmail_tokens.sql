-- ============================================================================
-- 0066_encrypt_gmail_tokens.sql — stop storing mailbox access in plaintext.
-- ----------------------------------------------------------------------------
-- gmail_tokens.refresh_token held a Google refresh token as text. That is
-- long-lived read access to somebody's email sitting in a column, and it was
-- already on the ship checklist. It also blocks scheduling the import cron:
-- multiplying the number of stored plaintext credentials is the wrong direction
-- to move before fixing how they are stored.
--
-- TIMING IS FORTUNATE AND WORTH RECORDING: gmail_tokens has ZERO rows today.
-- Nobody has ever completed a Gmail connect. So there is no ciphertext to
-- strand and no migration to get wrong — the thing the brief was rightly
-- cautious about does not apply. Encryption starts from the first real token.
--
-- Key handling: Supabase Vault holds the key, pgcrypto does the work. No
-- external key management, no secret for a human to set and lose, and the key
-- never leaves Postgres — the edge function calls RPCs and only ever sees
-- plaintext it already had.
--
-- The plaintext column is deliberately KEPT and left null. Dropping it is a
-- schema change that would break the currently-deployed function the moment it
-- is applied; retiring it is a follow-up once the new path has run once.
-- ============================================================================

alter table public.gmail_tokens
  add column if not exists refresh_token_encrypted bytea;

comment on column public.gmail_tokens.refresh_token is
  'DEPRECATED by migration 0066 — always null for tokens stored after that. Kept so a deploy of the old function cannot fail on a missing column. Drop once the encrypted path has run in production.';
comment on column public.gmail_tokens.refresh_token_encrypted is
  'pgp_sym_encrypt of the Google refresh token, keyed from Vault. Only store_gmail_token() writes it and only read_gmail_refresh() reads it.';

-- ----------------------------------------------------------------------------
-- The key
-- ----------------------------------------------------------------------------
-- Created once, randomly, and never printed. If this secret is ever rotated,
-- existing tokens become undecryptable and every user must reconnect — which
-- is an acceptable failure (a re-consent), and is why refresh tokens rather
-- than anything irreplaceable live here.
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'gmail_token_key') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'gmail_token_key',
      'Symmetric key for public.gmail_tokens.refresh_token_encrypted (migration 0066).'
    );
  end if;
end $$;

create or replace function public.gmail_token_key()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'gmail_token_key' limit 1;
$$;

-- Never callable by a client. The key must not be reachable from a JWT.
revoke all on function public.gmail_token_key() from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- Store / read
-- ----------------------------------------------------------------------------
create or replace function public.store_gmail_token(
  p_user uuid,
  p_refresh text,
  p_access text,
  p_expires timestamptz,
  p_email text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  k text;
begin
  k := public.gmail_token_key();
  if k is null then
    raise exception 'gmail_token_key missing';
  end if;

  insert into public.gmail_tokens (
    user_id, refresh_token, refresh_token_encrypted, access_token, expires_at, email, updated_at
  )
  values (
    p_user,
    null,                                        -- plaintext is never written again
    extensions.pgp_sym_encrypt(p_refresh, k),
    p_access, p_expires, p_email, now()
  )
  on conflict (user_id) do update set
    -- A re-connect must CLEAR any plaintext left from before 0066, not leave
    -- it beside the ciphertext.
    refresh_token           = null,
    refresh_token_encrypted = excluded.refresh_token_encrypted,
    access_token            = excluded.access_token,
    expires_at              = excluded.expires_at,
    email                   = excluded.email,
    updated_at              = now();
end;
$$;

create or replace function public.read_gmail_refresh(p_user uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  row_rec public.gmail_tokens%rowtype;
  k text;
begin
  select * into row_rec from public.gmail_tokens where user_id = p_user;
  if not found then return null; end if;

  if row_rec.refresh_token_encrypted is not null then
    k := public.gmail_token_key();
    if k is null then return null; end if;
    return extensions.pgp_sym_decrypt(row_rec.refresh_token_encrypted, k);
  end if;

  -- Pre-0066 rows. There are none today, but a token written by an
  -- old deployment between this migration and the function deploy would land
  -- here, and silently failing to read it would look like a broken connection.
  return row_rec.refresh_token;
end;
$$;

revoke all on function public.store_gmail_token(uuid, text, text, timestamptz, text) from public, anon, authenticated;
revoke all on function public.read_gmail_refresh(uuid) from public, anon, authenticated;
