-- ============================================================================
-- 0181 — the storage and query half of semantic similarity. No vendor, no spend.
-- ----------------------------------------------------------------------------
-- WHY THIS EXISTS. Two ranking fixes were measured and rejected this week
-- (0.5x compression, and dropping the sub-40-review penalty). Both failed the
-- same way: they reweighted signals the scorer ALREADY had, and rank is
-- relative, so lifting a term lifts the competition with it. Josephine Estelle
-- sits at 175 of 200 on the FULL graph with her own two visits counted — she is
-- behind on taste, behaviour, quality and gem bonus at once. The only evidence
-- that the founder likes her is that he went, which is exactly what leave-one-
-- out removes. No arithmetic on existing features can recover that. It needs a
-- signal the system has never had, and review-text similarity is the cheapest
-- candidate.
--
-- WHAT IS DELIBERATELY NOT HERE. No embedding provider, no API key, no backfill
-- and no scorer wiring. Anthropic has no embeddings endpoint, so this means a
-- NEW paid vendor, and two things have to be true before that is worth buying:
--
--   1. There has to be text to embed. Coverage of review_snippets in prod is
--      currently UNKNOWN — the backfill ran eight nights and was unscheduled,
--      and 0178 then showed ordinary browsing had been erasing the text the
--      whole time. The eval fixture has it on 0 of 200 rows.
--   2. The signal has to be worth paying for. Once the fixture carries text,
--      lexical (TF-IDF) similarity can be measured in the eval for nothing. If
--      free lexical similarity shows no lift, dense embeddings are a poor bet.
--
-- 1024 dimensions is the portable choice: it is native for voyage-3/3.5 and
-- Cohere embed-v3, and OpenAI's text-embedding-3-* accept a `dimensions`
-- parameter to match. embedding_model is stored beside the vector so two
-- models can never be silently compared against each other.
--
-- TERMS. Google caps caching of review CONTENT at 30 days (0173). A vector is a
-- derivation, not the text — the same standing as the tags 0173 keeps — so it
-- is not expired here. Flagging that as a judgement, not a certainty.
-- ============================================================================

create extension if not exists vector;

alter table public.restaurants
  add column if not exists review_embedding      vector(1024),
  add column if not exists embedding_model       text,
  add column if not exists embedding_refreshed_at timestamptz;

comment on column public.restaurants.review_embedding is
  'Dense vector over review_snippets + editorial_summary. 1024-d for portability across voyage-3/3.5, Cohere embed-v3, and OpenAI with dimensions=1024.';
comment on column public.restaurants.embedding_model is
  'Which model produced review_embedding. Vectors from different models are not comparable; every query must filter on this.';

-- Cosine, because the vectors are normalised and magnitude carries no meaning.
create index if not exists restaurants_review_embedding_idx
  on public.restaurants using hnsw (review_embedding vector_cosine_ops);

-- ---- 0178's lesson, applied before it can bite -----------------------------
-- A partial upsert must not erase a paid vector. classifyAndBuildRow does not
-- currently emit these columns, so PostgREST omits them and they survive — but
-- that is exactly what was true of review_snippets before 0127 added an
-- explicit null and wiped them. Guarding now, while it costs one line.
create or replace function public.restaurants_preserve_enrichment()
returns trigger language plpgsql as $$
declare
  pruning boolean := coalesce(current_setting('palate.pruning_review_text', true), '') = 'on';
begin
  new.cuisine_type      := coalesce(new.cuisine_type, old.cuisine_type);
  new.cuisine_region    := coalesce(new.cuisine_region, old.cuisine_region);
  new.cuisine_subregion := coalesce(new.cuisine_subregion, old.cuisine_subregion);
  new.cultural_context  := coalesce(new.cultural_context, old.cultural_context);
  new.vibe              := coalesce(new.vibe, old.vibe);
  new.menu_style        := coalesce(new.menu_style, old.menu_style);
  new.price_feel        := coalesce(new.price_feel, old.price_feel);
  new.ambiance_notes    := coalesce(new.ambiance_notes, old.ambiance_notes);
  new.llm_backfill_at   := coalesce(new.llm_backfill_at, old.llm_backfill_at);
  new.business_status   := coalesce(new.business_status, old.business_status);
  if new.occasion_tags is null or cardinality(new.occasion_tags) = 0 then new.occasion_tags := old.occasion_tags; end if;
  if new.flavor_tags   is null or cardinality(new.flavor_tags)   = 0 then new.flavor_tags   := old.flavor_tags;   end if;
  if new.crowd_energy  is null or cardinality(new.crowd_energy)  = 0 then new.crowd_energy  := old.crowd_energy;  end if;

  new.classification_confidence    := coalesce(new.classification_confidence, old.classification_confidence);
  new.google_raw                   := coalesce(new.google_raw, old.google_raw);
  new.editorial_blurb              := coalesce(new.editorial_blurb, old.editorial_blurb);
  new.editorial_blurb_generated_at := coalesce(new.editorial_blurb_generated_at, old.editorial_blurb_generated_at);
  if new.tags is null or cardinality(new.tags) = 0 then new.tags := old.tags; end if;

  -- 0181: paid derivations of paid text.
  new.review_embedding       := coalesce(new.review_embedding, old.review_embedding);
  new.embedding_model        := coalesce(new.embedding_model, old.embedding_model);
  new.embedding_refreshed_at := coalesce(new.embedding_refreshed_at, old.embedding_refreshed_at);

  new.reviews_refreshed_at := coalesce(new.reviews_refreshed_at, old.reviews_refreshed_at);
  if not pruning then
    new.editorial_summary := coalesce(new.editorial_summary, old.editorial_summary);
    if new.review_snippets is null or cardinality(new.review_snippets) = 0 then
      new.review_snippets := old.review_snippets;
    end if;
  end if;

  return new;
end $$;

-- ---- the queue, so a backfill can be sized before it is bought -------------
create or replace function public.embedding_coverage(p_model text default null)
returns table (total bigint, with_text bigint, embedded bigint, needs_embedding bigint)
language sql stable security definer set search_path = public as $$
  select count(*),
         count(*) filter (where review_snippets is not null or editorial_summary is not null),
         count(*) filter (where review_embedding is not null
                            and (p_model is null or embedding_model = p_model)),
         count(*) filter (where (review_snippets is not null or editorial_summary is not null)
                            and (review_embedding is null
                                 or (p_model is not null and embedding_model is distinct from p_model)))
    from public.restaurants;
$$;

revoke all     on function public.embedding_coverage(text) from public, anon;
grant  execute on function public.embedding_coverage(text) to service_role, authenticated;

-- ---- the query the scorer would eventually use -----------------------------
-- The centroid of what this person has actually eaten, and everything near it.
-- Self-scoped: auth.uid() only, so it cannot be used to read someone else's
-- taste. Filters on embedding_model, because comparing vectors from two models
-- produces confident nonsense.
create or replace function public.similar_to_my_taste(
  p_model text,
  p_limit integer default 50
)
returns table (google_place_id text, name text, similarity real)
language sql stable security definer set search_path = public as $$
  with centroid as (
    select avg(r.review_embedding)::vector(1024) as v
      from public.visits v0
      join public.restaurants r on r.id = v0.restaurant_id
     where auth.uid() is not null
       and v0.user_id = auth.uid()
       and r.review_embedding is not null
       and r.embedding_model = p_model
  )
  select r.google_place_id, r.name,
         (1 - (r.review_embedding <=> c.v))::real
    from public.restaurants r, centroid c
   where auth.uid() is not null
     and c.v is not null
     and r.review_embedding is not null
     and r.embedding_model = p_model
     and coalesce(r.recommendation_eligibility, 1) > 0
   order by r.review_embedding <=> c.v
   limit greatest(1, least(p_limit, 200));
$$;

revoke all     on function public.similar_to_my_taste(text, integer) from public, anon;
grant  execute on function public.similar_to_my_taste(text, integer) to authenticated;

-- ---- proofs ----------------------------------------------------------------
do $$
declare d int; n int; cov record; def text;
begin
  if not exists (select 1 from pg_extension where extname = 'vector') then
    raise exception '0181: pgvector is not installed';
  end if;

  select a.atttypmod into d
    from pg_attribute a join pg_class c on c.oid = a.attrelid
   where c.relname = 'restaurants' and a.attname = 'review_embedding';
  if d is distinct from 1024 then
    raise exception '0181: review_embedding is % dimensions, expected 1024', d;
  end if;

  if not exists (select 1 from pg_indexes where tablename = 'restaurants'
                   and indexname = 'restaurants_review_embedding_idx') then
    raise exception '0181: the cosine index was not created';
  end if;

  -- The preserve trigger must now defend the vector too.
  select pg_get_functiondef(p.oid) into def
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'restaurants_preserve_enrichment';
  if def !~ 'review_embedding' then
    raise exception '0181: a partial upsert can still erase review_embedding';
  end if;

  -- Self-scoped: unauthenticated callers get nothing.
  select count(*) into n from public.similar_to_my_taste('probe-model', 10);
  if n <> 0 then raise exception '0181: leaked % rows to an unauthenticated caller', n; end if;

  if has_function_privilege('anon', 'public.similar_to_my_taste(text, integer)', 'execute') then
    raise exception '0181: anon can execute similar_to_my_taste';
  end if;

  select * into cov from public.embedding_coverage(null);
  raise notice '0181: % restaurants, % with review text, % embedded, % need embedding',
    cov.total, cov.with_text, cov.embedded, cov.needs_embedding;
end $$;
