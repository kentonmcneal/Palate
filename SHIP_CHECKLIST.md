# Palate — Ship Checklist

**Status as of 2026-07-20: LIVE on TestFlight.** Build `0.1.0 (11)` passed Apple
processing and was verified running on a physical device. The backend is fully
deployed. What remains is distribution, not engineering.

> **Read this before trusting any doc in this repo.** The previous version of this
> file described the backend deploy and `CRON_SECRET` as pending for five days
> after they had shipped. Checklists go stale; live infrastructure does not.
> Every claim below was verified with a free read-only command, listed inline so
> you can re-verify in seconds rather than trusting this file.

---

## Verified deployed ✅

| Thing | State | Verify with |
|---|---|---|
| Migrations | Applied through **0040** | `supabase migration list --linked` |
| Edge functions | All 5 ACTIVE (deployed 2026-07-17) | `supabase functions list --project-ref oxzsspbojeyeelbjqjdx` |
| `CRON_SECRET` | Set **and proven working** | see "Cron proof" below |
| `ALERT_PUSH_TOKEN` | Set 2026-07-20 → Places cost alerts live | `supabase secrets list --project-ref …` |
| Privacy / terms URLs | `palate-zm29.vercel.app/privacy` + `/terms`, both 200 | `curl -I` |
| iOS build | `0.1.0 (11)`, STORE distribution, submitted | `eas build:list` |
| App Store Connect | App ID `6765514102` | TestFlight tab |
| Feedback capture | `feedback` table + private bucket live | `select count(*) from public.feedback` |

**Cron proof** — don't infer from `cron.job_run_details`; its `succeeded` only means
pg_net *dispatched* the request. `featured_lists_refresh_nightly` shows a 5000ms
pg_net timeout every night, which is benign: the function runs longer than
Postgres waits. Confirm the crons by checking that they **wrote data**:

```sql
select max(refreshed_at) from public.featured_lists_cache;  -- ~16s after 04:00 UTC
select max(created_at)   from public.weekly_wrapped;        -- ~3s after Sun 14:00 UTC
```

Both writing = both authenticated = the Vault `cron_secret` matches the edge
secret. That is the only end-to-end proof that matters.

---

## Remaining work

### 1. Verify the feedback path  ⚠️ still unproven
`public.feedback` has **0 rows**. The app writes visits fine (23 logged), but
nothing has exercised `submitFeedback` end to end. Send one from
**Settings → Help → Share feedback** with a screenshot attached, then:

```sql
select count(*) from public.feedback;
select count(*) from storage.objects where bucket_id = 'feedback';
```

A beta whose feedback channel silently fails produces nothing.

### 2. Internal testers — instant, no review
App Store Connect → **Users and Access** → add each person by Apple ID →
TestFlight → Internal Testing group. Up to 100, installable within minutes.
This is the fastest path to other people's phones and needs nothing else on this
list.

### 3. External testers — needs a demo account first  ⚠️
A public `testflight.apple.com/join/…` link requires a one-time **Beta App
Review** (~24–48h). Apple requires a working demo account for anything behind a
login, and **Palate's login is `signInWithOtp` — email OTP only, no password and
no reviewer bypass.** A reviewer cannot get in.

Fix before submitting:
1. Configure a **test OTP** in Supabase Auth (maps a demo email to a fixed code,
   so no email is ever sent).
2. Sign in once as that demo user so the account exists.
3. Seed it with visit history — a reviewer landing on an empty app sees nothing
   of what Palate does, which is its own rejection reason.
4. Put the email + fixed code in App Store Connect → **App Review Information**.

Copy to paste is in `TESTFLIGHT_COPY.md`.

---

## Shipping updates to phones

`expo-updates ~57.0.8` is configured, so **JS and asset changes go out over the
air** — no rebuild, no resubmission, no review. Testers get them on next launch.

```
cd mobile && eas update --channel production -m "what changed"
```

Two constraints:

- **JS/assets only.** Native changes — new native deps, permission or plugin
  changes in `app.json`, SDK bumps — require a full rebuild and resubmit.
- **`runtimeVersion` policy is `appVersion`.** Updates only reach builds whose
  `version` matches. **Keep `version` at `0.1.0`** while pushing OTA fixes;
  bumping it strands every phone running `0.1.0` until they install a new build.

⚠️ `eas update` and `eas build` are paid — per `CLAUDE.md`, no agent runs them
without an explicit go.

---

## Collecting feedback

**Two inboxes.** Testers will use whichever they find first:

1. **In-app** → your `feedback` table. Export everything into one folder:
   ```
   cd supabase/scripts && npm install
   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx export-feedback.ts
   # → ./feedback-export/  (feedback.md, feedback.csv, reports.csv, screenshots/)
   ```
   Keep the service-role key in your terminal — never paste it into chat.

2. **TestFlight's built-in feedback** (screenshot → share → TestFlight) → lands in
   **App Store Connect, not your database.** `export-feedback.ts` cannot see it.
   Check both.

The in-app entry is buried under Settings → Help. Until that's surfaced better,
point testers at it in TestFlight's "What to Test" field — the one screen every
tester reads.

Action moderation reports (`reports.csv`) within 24h once you have real users.

---

## Post-launch backlog

- **Gmail token encryption (#9).** `gmail_tokens.refresh_token`/`access_token` are
  plaintext. RLS blocks all client reads (service-role only), so exposure is a DB
  dump or service-role leak, not a client risk. Needs pgcrypto + a Vault key +
  three SECURITY DEFINER RPCs, shipped atomically with a rewire of the five
  touchpoints in `gmail-import`, plus one live "connect Gmail → scan" test.
- **Surface the feedback entry** — a prompt after a few visits, or shake-to-report.
- **`palate.app` domain.** Doesn't resolve. Nothing user-facing depends on it, but
  `applinks:palate.app` in `app.json` claims universal links for a dead domain.
- **Vestigial Info.plist keys.** The expo-location plugin injects
  `NSLocationAlwaysAndWhenInUseUsageDescription`, `NSLocationAlwaysUsageDescription`,
  and `NSMotionUsageDescription` **unconditionally** — removing the plugin block
  from `app.json` does not strip them, it only replaces your custom string with
  generic boilerplate (verified via `npx expo config --type introspect`). Removing
  them needs a custom config plugin. Cosmetic: the app only ever calls
  `requestForegroundPermissionsAsync`, so users only see the When-In-Use prompt.
- **Chain flagging review.** Migration 0039 flagged 86 restaurants as
  discovery-ineligible (444 remain eligible of 533). Reviewed 2026-07-20 — no
  false positives, but Shake Shack (12 locations), Waffle House, and The
  Cheesecake Factory are judgment calls. Un-flag with:
  ```sql
  update public.restaurants set recommendation_eligibility = 1,
         ineligibility_reason = null
   where ineligibility_reason = 'national_chain' and name ilike '%shake shack%';
  ```
  Many flagged rows are airport locations — if terminal meals are a big share of
  visit history, consider a separate `airport` reason later.
