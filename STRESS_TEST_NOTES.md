# Stress test — what's solid, what's deferred, what to watch

A short, honest engineering review of the MVP I just built. Read this before you ship.

## What's solid

- **The core loop works end-to-end:** sign in → onboarding → "Check now" → confirm visit → saved → Wrapped. You can build everything else once this is in users' hands.
- **Row Level Security is enforced at the database.** A user literally cannot read another user's visits, even if our app code had a bug. Verified by writing policies on every user-owned table.
- **The Google Places key never touches the phone.** All Places calls go through the Supabase edge function, which adds a per-user rate limit and caches results in our own `restaurants` table.
- **Wrapped is computed server-side via a `security definer` function.** It can't be tampered with from the client.
- **Privacy switch is real.** Settings → "Location tracking" off persists in `AsyncStorage` and we honor it before calling the OS. We also respect the OS-level permission state.
- **Account deletion really deletes.** `delete_my_account` removes the auth user, all visits, all location events. Not a soft-delete.
- **Brand discipline.** Red `#FF3008` is reserved for the logo, primary buttons, and accents. Everything else is ink/paper/mute.

## What I deferred (and you should ship without)

- **Background location detection.** This is an entire 2-3 week project on its own — significant location changes, geofencing the recently-seen restaurants, local notification UX, App Store review copy. The current MVP is foreground-only ("Check now" button + manual add). Ship this first, get 10-20 friends using it, then add background.
- **Apple/Google Sign-In.** The plumbing is in `lib/auth.ts` for magic-link email. Apple Sign-In requires native config in your Apple Developer account before it works — not worth doing until you're ready for TestFlight. Magic link is fine for testing.
- **Social anything.** Per your spec — explicitly out of scope. The schema doesn't even have a `friends` table.
- **A real privacy policy / ToS.** I left placeholders. Use Termly.io (~$10/mo) or a lawyer before any public launch.
- **App icon and splash.** I left a README in `mobile/assets/` explaining what to drop in. Expo will warn until you do.

## Risks to watch

1. **Google Places billing.** Even with the proxy + caching, sloppy use can cost money. Two safeguards:
   - The edge function rate-limits to 5 nearby calls per user per minute.
   - We only call `details` if the cached row is older than 30 days.
   - **What you should do:** in Google Cloud, set a daily budget alert at $5 for the first month. Sleep better.

2. **iOS will eventually ask for "background" or "always" permission again.** Right now we ask only for "When in use." If/when you add background detection, iOS will require a *separate* second prompt, and Apple's review team will scrutinize the justification text. Plan a careful rollout.

3. **Magic links + Expo Go can be finicky.** The redirect URI is `palate://auth-callback` — works in a development build, but in Expo Go it may bounce through `exp://` instead. If you hit issues, switch the sign-in flow to OTP-code-only (the verify code path already exists in `lib/auth.ts` and `sign-in.tsx`).

4. **`location_events` table grows fast.** With foreground-only it's tiny. When you add background, this table will balloon. The schema includes a `purge_old_location_events()` function — set it on a cron in Supabase before you ship background detection. Otherwise this is your first storage bill.

5. **The `restaurants` table is shared across users.** Cheap and correct for an MVP. If two users hit the same place at the same time, last write wins on `refreshed_at`. Not a problem at this scale; flag it if you ever expose a public "popular restaurants" feature.

6. **No analytics, no error monitoring.** Intentional for MVP. Once you have ~50 daily users, add PostHog (analytics) and Sentry (errors). Both have generous free tiers and Expo plugins.

## Things that will trip you up specifically

- **`brew install` on Apple Silicon** sometimes installs to `/opt/homebrew/bin` which isn't on `PATH`. The Homebrew installer prints the right `eval` line — actually run it.
- **Expo Go iOS build numbers.** As of mid-2026 you need Expo SDK 51+. The `package.json` pins `expo: ~51.0.28`. If you bump it later, run `npx expo install --check` to keep dependencies aligned.
- **`supabase functions deploy` requires Docker** if you want to test locally with `supabase functions serve`. The deploy itself doesn't, but if anything looks weird, install Docker Desktop.
- **Vercel + monorepo.** I structured the repo so `landing/` is a normal Next app. When you import to Vercel, set the root directory to `landing` (Step 5.2 in SETUP.md). Don't skip that.

## Build order I recommend

1. **Day 1, ~3 hours:** Parts 0–3 of `SETUP.md`. Accounts created, schema run, edge function deployed.
2. **Day 1, ~1 hour:** Parts 4–5. Landing page running locally and deployed to Vercel.
3. **Day 2, ~2 hours:** Part 6. Mobile app on your iPhone via Expo Go. Walk through onboarding. Add a manual visit. Tap "Check now" outside.
4. **Day 2, ~30 min:** Run the full "Testing checklist" in `SETUP.md`.
5. **Day 3:** Replace privacy/ToS placeholders. Generate icon+splash. Set Google Cloud budget alert.
6. **Day 4–7:** Get 5 friends to install via Expo Go and use it for a week. **Don't add features.** Watch what they do.
7. **Week 2:** Based on what you learned, start TestFlight build (`eas build`) and tell me when you want to add background detection.
