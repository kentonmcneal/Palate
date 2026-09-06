-- THROWAWAY PROBE (own-the-data audit) — read-only, raises so nothing commits.
do $$
declare
  r   record;
  n   bigint;
  rep text := E'\n===== PROBE: own-the-data =====\n';
begin
  rep := rep || 'COLUMNS(restaurants): ';
  for r in select column_name from information_schema.columns
            where table_schema = 'public' and table_name = 'restaurants'
            order by ordinal_position loop
    rep := rep || r.column_name || ' ';
  end loop;
  rep := rep || E'\n';

  select count(*) into n from public.restaurants;
  rep := rep || 'total_rows=' || n || E'\n';
  select count(*) into n from public.restaurants where created_at >= now() - interval '30 days';
  rep := rep || 'created_last_30d=' || n || E'\n';
  select count(*) into n from public.restaurants where created_at >= now() - interval '7 days';
  rep := rep || 'created_last_7d=' || n || E'\n';
  select count(*) into n from public.restaurants where created_at >= now() - interval '1 day';
  rep := rep || 'created_last_24h=' || n || E'\n';
  select count(*) into n from public.restaurants where refreshed_at >= now() - interval '30 days';
  rep := rep || 'refreshed_last_30d=' || n || E'\n';

  rep := rep || E'ROWS PER DAY (last 14d):\n';
  for r in select created_at::date d, count(*) c from public.restaurants
            where created_at >= now() - interval '14 days' group by 1 order by 1 loop
    rep := rep || '  ' || r.d || ' = ' || r.c || E'\n';
  end loop;

  rep := rep || E'classifier_version, rows created last 30d:\n';
  for r in select coalesce(classifier_version, '(null)') v, count(*) c
            from public.restaurants where created_at >= now() - interval '30 days'
            group by 1 order by 2 desc loop
    rep := rep || '  ' || r.v || ' = ' || r.c || E'\n';
  end loop;

  rep := rep || E'classifier_version, ALL rows:\n';
  for r in select coalesce(classifier_version, '(null)') v, count(*) c
            from public.restaurants group by 1 order by 2 desc loop
    rep := rep || '  ' || r.v || ' = ' || r.c || E'\n';
  end loop;

  select count(*) into n from public.restaurants
   where created_at >= now() - interval '30 days' and latitude is null;
  rep := rep || 'last30d_latitude_null (stub rows)=' || n || E'\n';
  select count(*) into n from public.restaurants
   where created_at >= now() - interval '30 days' and types is null;
  rep := rep || 'last30d_types_null=' || n || E'\n';
  select count(*) into n from public.restaurants
   where created_at >= now() - interval '30 days' and neighborhood is null;
  rep := rep || 'last30d_neighborhood_null=' || n || E'\n';
  select count(*) into n from public.restaurants
   where created_at >= now() - interval '30 days' and cuisine_type is null;
  rep := rep || 'last30d_cuisine_null=' || n || E'\n';
  select count(*) into n from public.restaurants
   where created_at >= now() - interval '30 days' and recommendation_eligibility = 0;
  rep := rep || 'last30d_ineligible(elig=0)=' || n || E'\n';

  select count(*) into n from public.restaurants where neighborhood is null;
  rep := rep || 'ALL_neighborhood_null=' || n || E'\n';
  select count(*) into n from public.restaurants where google_raw is null;
  rep := rep || 'ALL_google_raw_null=' || n || E'\n';
  select count(*) into n from public.restaurants where google_raw is not null and jsonb_exists(google_raw, 'reviews');
  rep := rep || 'ALL_google_raw_has_reviews=' || n || E'\n';
  select count(*) into n from public.restaurants where google_raw is not null and jsonb_exists(google_raw, 'editorialSummary');
  rep := rep || 'ALL_google_raw_has_editorialSummary=' || n || E'\n';
  select count(*) into n from public.restaurants where reviews_refreshed_at is not null;
  rep := rep || 'ALL_reviews_refreshed_at_set=' || n || E'\n';
  select count(*) into n from public.restaurants
   where reviews_refreshed_at is not null
     and (google_raw is null or not jsonb_exists(google_raw, 'reviews'));
  rep := rep || 'CLOBBERED_google_raw (details ran, raw now thin)=' || n || E'\n';
  select count(*) into n from public.restaurants where review_snippets is not null;
  rep := rep || 'ALL_review_snippets_set=' || n || E'\n';
  select count(*) into n from public.restaurants where editorial_summary is not null;
  rep := rep || 'ALL_editorial_summary_set=' || n || E'\n';
  select count(*) into n from public.restaurants where vibe is not null;
  rep := rep || 'ALL_vibe_set=' || n || E'\n';
  select count(*) into n from public.restaurants where menu_style is not null;
  rep := rep || 'ALL_menu_style_set=' || n || E'\n';
  select count(*) into n from public.restaurants where llm_backfill_at is not null;
  rep := rep || 'ALL_llm_backfill_at_set=' || n || E'\n';
  select count(*) into n from public.restaurants where recommendation_eligibility = 0;
  rep := rep || 'ALL_ineligible(elig=0)=' || n || E'\n';

  rep := rep || E'api_usage_daily, last 30d by action/source:\n';
  for r in select action, source, sum(count) c from public.api_usage_daily
            where day >= current_date - 30 group by 1, 2 order by 3 desc loop
    rep := rep || '  ' || r.action || '/' || r.source || ' = ' || r.c || E'\n';
  end loop;
  rep := rep || E'billable calls by day (last 14d):\n';
  for r in select day, billable_calls as c, tripped from public.google_usage_counter
            where day >= current_date - 14 order by day loop
    rep := rep || '  ' || r.day || ' = ' || r.c || ' tripped=' || r.tripped || E'\n';
  end loop;

  select count(distinct (x->>'google_place_id')) into n
    from public.featured_lists_cache f, lateral jsonb_array_elements(f.restaurants) x;
  rep := rep || 'featured_lists distinct place_ids=' || n || E'\n';
  select count(*) into n
    from (select distinct (x->>'google_place_id') pid
            from public.featured_lists_cache f, lateral jsonb_array_elements(f.restaurants) x) s
   where not exists (select 1 from public.restaurants rr where rr.google_place_id = s.pid);
  rep := rep || 'featured_lists place_ids MISSING from restaurants=' || n || E'\n';
  select count(*) into n from public.featured_lists_cache;
  rep := rep || 'featured_lists_cache rows=' || n || E'\n';

  rep := rep || 'TRIGGERS: ';
  for r in select tgname from pg_trigger
            where tgrelid = 'public.restaurants'::regclass and not tgisinternal loop
    rep := rep || r.tgname || ' ';
  end loop;
  rep := rep || E'\n';

  raise exception 'PROBE %', rep;
end $$;
