# Palate — Shelf & Resume Doc

**Status: SHELVED as of 2026-08-10.** Pausing active development to focus on a
revenue-generating test-prep business. This doc is the single source of truth
for picking Palate back up with minimal re-learning. Read it top to bottom before
touching anything.

---

## Before you resume — answer this first

Don't restart on nostalgia. The strategic question that shelved it:

> **Name the one-sentence reason Palate survives Beli having every feature Palate has.**

If you can say it and believe it, resume. If you're reaching, the app isn't the
problem — the wedge is, and building more features won't fix that. The scarce
resource was never the idea or the code (both keep). It was your time and runway.
Resume when you have a wedge *and* the runway to reach it before Beli locks in
the taste graph.

---

## What Palate is

A mobile app (iOS, React Native + Expo) that tracks where you eat and reflects
your real dining taste back to you — an "honest mirror," culminating in a weekly
"Wrapped." The core long-term bet was **passive dining capture** (auto-detect
restaurant visits so logging isn't manual). Main competitor: **Beli**.

- Launched: TestFlight (public beta), build 0.1.0(14) approved 2026-08-04.
- Traction at shelving: ~9 accounts, ~1 signup/3 days. Pre-product-market-fit.

## Where everything lives (infra inventory)

| Thing | Value |
|---|---|
| Code | `github.com/kentonmcneal/Palate` (this repo), branch `main` |
| Mobile app | `mobile/` — Expo SDK 57, RN 0.86, expo-router |
| Landing site | `landing/` — Next.js |
| Backend | Supabase project ref **`oxzsspbojeyeelbjqjdx`** (org jxtllfyseeammhhfgyoj, East US) |
| DB schema | `supabase/migrations/` 0001–0048 (all applied to remote as of shelving) |
| Edge functions | `supabase/functions/` (places-proxy, notify-admin-waitlist, etc.) |
| iOS builds | EAS project `@kentonmcneal/palate-app`, bundle `app.palate.ios` |
| App Store Connect | ASC app id **6765514102**, Apple Team D92543Q666 (Individual) |
| Email (auth OTP) | Resend via custom SMTP, sender `login@your-palate.com` |
| Places API | Google Places, called through `places-proxy` edge fn (has kill-switch, migration 0033) |
| Domains | `palate.app` (app/landing), `your-palate.com` (email) |

## Current state (what works / what's in-flight)

**Working:** email OTP sign-in, waitlist/approval gate (Profile→Admin→Waitlist),
manual visit logging, recs engine, classifier (venue food-gate v1.7.0), Wrapped,
compatibility, referrals. Sentry live.

**In-flight / not verified (as of shelving):**
- **Google sign-in** (native iOS id_token flow) — CODE COMPLETE, provider enabled
  in Supabase, but only reaches users once EAS build 47 (triggered 2026-08-10) is
  installed. Not runtime-verified. See `mobile/app/sign-in.tsx`, `lib/auth.ts`.
- **Passive dining capture** — DESIGNED, NOT BUILT. Decisions locked this session:
  native CLVisit Expo module (iOS-only), homegrown Supabase `analytics_events`
  table for the permission funnel. Phased build spec is in the session notes; a
  cheap **geofencing spike** (1–2 wks, expo-location, ≤20 seeded venues) was the
  agreed way to validate the thesis before committing months to the native module.
  This is the biggest lever and the biggest unbuilt risk — do the cheap validation
  before the expensive build.

**Known issues:**
- **OTP email deliverability to `.edu`/corporate domains** (e.g. itayzit@wharton.upenn.edu):
  university mail (Proofpoint) quarantines/drops Resend mail intermittently. Auth
  email rate limit is 30/hr project-wide, 60s per address. Google sign-in was the
  intended permanent fix. Admin workaround: mint a login code via
  `POST /auth/v1/admin/generate_link` with the service_role key (get it from
  `GET /v1/projects/<ref>/api-keys?reveal=true`), have the user reach the code
  screen first (tapping "Send code" overwrites any pre-minted code).
- No magic-link handler in the app (no `/auth-callback` route); sign-in is
  OTP-code only. `site_url` is still the default `localhost:3000`.

## Cost teardown (do this so a shelved app stops spending)

- [ ] **Pause cron jobs** — jobid 8 (daily, Google Places, $) + jobid 5 (weekly
      Wrapped, push/email to users). `select cron.unschedule(8); select cron.unschedule(5);`
- [ ] **Supabase** — consider downgrading to Free to stop monthly charge. Free
      projects PAUSE after ~1 week idle but retain data (restorable). Take a backup
      first (Dashboard → Database → Backups, or `supabase db dump`).
- [ ] **Apple Developer Program** — $99/yr. Lapsing removes the app from
      TestFlight/store but the code/account remain. Decide renew vs. lapse.
- [ ] **Resend / Google Cloud / Twilio** — low idle cost, but revoke/rotate keys
      if abandoning, or leave for quick resume.
- [ ] **EAS** — no idle cost; builds are pay-per-use.

## Credentials inventory (locations, NOT values — keep secrets in a password manager)

- Supabase anon key + URL: `mobile/.env` (public, `EXPO_PUBLIC_*`).
- Supabase access token: macOS Keychain, service "Supabase CLI" (base64).
- Supabase service_role: fetch via Management API `api-keys?reveal=true`.
- Resend SMTP creds: stored in Supabase auth config (`smtp_pass`).
- Google iOS OAuth client id: `mobile/.env` (`EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`).
- Apple/EAS credentials: managed on EAS servers (already set up).

## Resume checklist

1. `git pull`, `cd mobile && npm install`.
2. Restore/unpause Supabase; confirm migrations 0001–0048 applied (`supabase migration list --linked`).
3. Re-enable crons if wanted (re-run migrations 0017/0038/0045 schedule blocks).
4. First real work item: the **geofencing spike** to validate passive capture — do
   NOT start with the native module.
5. Answer the wedge question at the top before spending a dollar.
