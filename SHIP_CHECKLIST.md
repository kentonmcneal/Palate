# Palate — Ship Checklist (TestFlight)

**Status:** All code is on `main`, typechecks, and tests pass. Everything below
is credential-gated, paid, or a manual dashboard step — run it yourself. Per
CLAUDE.md, no agent runs `eas build`/`eas update`/`supabase ... deploy`/`db push`
without your explicit go.

Migrations included through **0038**: in-app feedback `0034`, report/block
moderation `0035`, RLS/auth hardening `0036`, weekly-wrapped service-role RPC
`0037` (fixes Sunday Wrapped that never generated), and the featured-lists cron
secret `0038` — on top of the recommendation/cost-control work.

⚠️ **NEW hard dependency this cycle — `CRON_SECRET`.** The security pass made both
`generate-weekly-wrapped` and `featured-lists-refresh` **fail closed**. You MUST
set up the shared cron secret (step 2a) *before/with* deploying those functions,
or Sunday Wrapped + the nightly Featured Lists refresh silently stop.

---

## 0. Apple Developer Program — the long pole ⏳
Not started as of 2026-07-15. Enroll first; identity verification can take 2–5 days.
- https://developer.apple.com/programs/enroll/  ($99/yr, individual is fine)

## 1. Make the privacy + terms URLs resolve  ⚠️ Apple hard-blocks a broken privacy URL
The app links to `https://palate.app/privacy` and `/terms` (in `mobile/app.json`
and Settings), but `palate.app` does not currently resolve — the site is live at
`palate-zm29.vercel.app`. Do ONE of:
- **Attach the `palate.app` domain** to the Vercel project (Vercel → Project →
  Settings → Domains) and confirm `https://palate.app/privacy` loads, **or**
- temporarily point the app's links at the working Vercel URL.
The privacy page currently renders as a "placeholder pending lawyer review." That
text is fine for TestFlight beta review, but finalize it (see `LAWYER_REVIEW.md`)
before a public App Store submission.

## 2a. Set the shared cron secret  🔑 do this FIRST (new this cycle)
Both `generate-weekly-wrapped` and `featured-lists-refresh` now fail closed and
authenticate via a shared secret. In the Supabase SQL editor:
```sql
select vault.create_secret('<paste-a-long-random-string>', 'cron_secret');
```
Then set the **same value** as an Edge Function secret on both functions:
```
supabase secrets set CRON_SECRET=<same-long-random-string>
```
(The Sunday Wrapped cron `0017` and the featured-lists cron `0038` both read
`vault: cron_secret` and send it to the functions, which compare against
`CRON_SECRET`. They must match exactly.)

## 2b. Deploy the backend
```
supabase login
supabase link --project-ref <YOUR-PROJECT-REF>
supabase db push          # applies migrations through 0038 (hardening + wrapped RPC + cron secret)
supabase secrets list     # confirm GOOGLE_PLACES key + CRON_SECRET present
```
Set the cost-alert push token (from your own device's push_token), then deploy
the functions. The two hardened functions MUST use `--no-verify-jwt` (they
authenticate via CRON_SECRET / service-role, not a JWT — matching the existing
Sunday Wrapped setup):
```
supabase secrets set ALERT_PUSH_TOKEN=<your-expo-push-token>
supabase functions deploy places-proxy                              # ⚠️ turns on Google Places cost; kill-switch/telemetry from migration 0033 protect it
supabase functions deploy generate-weekly-wrapped --no-verify-jwt   # Sunday Wrapped auto-gen (fixed) + fails closed
supabase functions deploy featured-lists-refresh  --no-verify-jwt   # nightly Featured Lists; ⚠️ calls Google directly (bounded)
```
Optional: `supabase functions deploy notify-feed-post` if not already deployed.

**Post-deploy smoke check (free):** in SQL, `select * from cron.job;` should show
`palate_sunday_wrapped` and `featured_lists_refresh_nightly`. To verify auth end
to end without waiting for the schedule, invoke `generate-weekly-wrapped` once
with the `CRON_SECRET` as a Bearer token and confirm a 200 (not 401).

## 3. Build + submit  ⚠️ paid — needs your explicit go
```
cd mobile
eas build --platform ios --profile production
eas submit --platform ios --profile production --latest
```
(EAS uses remote versioning — the `buildNumber` in app.json is informational.)

## 4. App Store Connect
- Create the app (Bundle ID `app.palate.ios`) if it doesn't exist — see `TESTFLIGHT_DAY_1.md`.
- Encryption question → "No, only standard system encryption."
- **Internal testing** (≤100, no review): add yourself + friends → build is installable in minutes.
- **External testing** (≤10,000, public link): submit the build for Beta App Review
  (~24–48h first time). Report/block (migration 0035) satisfies the Guideline 1.2
  UGC requirement that would otherwise flag the feed.

## 5. Collecting feedback + moderation reports
Users file feedback in-app (Settings → Share feedback). To pull everything into one
folder to drop into Claude Code:
```
cd supabase/scripts && npm install
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx export-feedback.ts
# → ./feedback-export/  (feedback.md, feedback.csv, reports.csv, screenshots/)
```
Keep the service-role key in your terminal — never paste it into chat.

---

### Apple-readiness audit (2026-07-15) — all green except the domain
- ✅ In-app account deletion (`delete_my_account`)
- ✅ Login is email magic-link only → no Sign in with Apple requirement
- ✅ Location is when-in-use only, with clear purpose strings
- ✅ UGC report + block (feed "•••" menu + profile actions + Blocked list in Settings)
- ✅ App icon + splash present
- ⚠️ Privacy/terms URL must resolve (step 1) and be finalized before public launch

### Known non-issue
Typecheck shows 33 stale Expo Router route-type errors (e.g. `/friends`,
`/feedback`, `/blocked`). They regenerate on `expo start` and are not real bugs.

### Deferred to post-launch (NOT a TestFlight blocker)
- **Gmail token encryption (#9).** `gmail_tokens.refresh_token` / `access_token`
  are stored as plaintext `text` (migration 0022's "encrypted at rest" comment was
  aspirational — corrected in the file). RLS already blocks all client reads
  (service-role only), so the only exposure is a DB dump / service-role leak — not
  a client-facing risk. Fix is a self-contained change: pgcrypto + a Vault key +
  encrypt-at-rest columns + three SECURITY DEFINER RPCs, shipped atomically with a
  rewire of the five token touchpoints in `gmail-import`. Needs one live
  "connect Gmail → scan" test. Do it after TestFlight is live.
