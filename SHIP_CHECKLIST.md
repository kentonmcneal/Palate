# Palate — Ship Checklist (TestFlight)

**Status:** All code is on `main`, typechecks, and tests pass. Everything below
is credential-gated, paid, or a manual dashboard step — run it yourself. Per
CLAUDE.md, no agent runs `eas build`/`eas update`/`supabase ... deploy`/`db push`
without your explicit go.

Migrations included through **0035** (adds in-app feedback `0034` + report/block
moderation `0035` on top of the recommendation/cost-control work).

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

## 2. Deploy the backend
```
supabase login
supabase link --project-ref <YOUR-PROJECT-REF>
supabase db push          # applies migrations through 0035 (feedback + moderation tables/RPCs)
supabase secrets list     # confirm Google Places key present
```
Set the cost-alert push token (from your own device's push_token), then:
```
supabase secrets set ALERT_PUSH_TOKEN=<your-expo-push-token>
supabase functions deploy places-proxy   # ⚠️ turns on Google Places cost; kill-switch/telemetry from migration 0033 protect it
```
Optional: `supabase functions deploy notify-feed-post` if not already deployed.

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
Typecheck shows ~30 stale Expo Router route-type errors (e.g. `/friends`,
`/feedback`, `/blocked`). They regenerate on `expo start` and are not real bugs.
