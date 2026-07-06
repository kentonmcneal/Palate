# Palate — Ship Checklist

Branch `fix/typecheck-cleanup` is committed, pushed, and 12 commits ahead of `main`.
Code is done. These are the remaining manual steps, in order. Every step is
credential-gated, paid, or touches production — run them yourself.

---

## 1. Push the database migrations (applies 0028–0032)
```
cd Palate
supabase login
supabase link --project-ref YOUR-PROJECT-REF
supabase db push
```

## 2. Check edge-function secrets are set
```
supabase secrets list
```
Confirm the Google Places key (and any others the functions need) are present.

## 3. Deploy the edge function  ⚠️ raises Google Places cost
Ships classifier v1.4.0 (qualitative tags) + the map radius/results/rate fixes.
```
supabase functions deploy places-proxy
```

## 4. Run the classifier backfill
Re-classifies existing restaurant rows for the new lounge/fast-food exclusions.
Does NOT call Google (uses cached payloads). Keep the service-role key in your
terminal — never paste it into chat.
```
cd supabase/scripts
npm install
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx backfill-classifier.ts --dry-run
# review output, then run for real:
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx backfill-classifier.ts
```
Optional: add `--with-llm` (needs `ANTHROPIC_API_KEY`, costs money) for the LLM
fallback on low-confidence rows.

## 5. Ship to users  ⚠️ paid — needs your explicit go (CLAUDE.md rule)
```
cd mobile
eas update      # OTA update, cheaper — reaches existing installs
# OR
eas build       # full build, for App Store submission
```

## 6. QA the build
- Warm-white shift across every screen
- Fraunces titles / identity headlines
- Calmer red on Home (no competing reds)
- Casual/Boutique + Saves-only toggles on Discover
- Pan the map — confirm pins keep loading (only true after step 3)

## 7. Merge to main
Open a PR (or merge directly) `fix/typecheck-cleanup` → `main` once QA passes.

---

### Notes
- Typecheck is clean except ~30 stale Expo Router route-type errors — these
  regenerate on `expo start` and are not real bugs. Don't chase them.
- Deferred (next build, not this batch): media-forward discovery feed,
  collaborative filtering ("people with your palate loved this"),
  collaborative lists / "send a place."
