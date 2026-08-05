# Palate — Finish-Line Runbook

*Everything left to ship, who has to do each step, every permission/approval the
agent needs, and how to verify the code and the app. Written 2026-08-04.*

Legend: **[YOU]** = only you can do it (login, credentials, legal declaration).
**[AGENT-OK]** = agent can do it but needs your explicit go (costs money or
changes production). **[AGENT]** = agent can just do it (free, reversible).

---

## 0. Current state (verified against code + EAS + Supabase)

| Thing | State |
|---|---|
| Build 13 (`91f6db1`) | Startup-crash fix. On TestFlight. |
| **Build 14 (`696ca02`)** | Crash + **onboarding re-survey fix** + **fast-food-in-recs fix** + **notification-trigger/NativeEventEmitter fix**. **Uploaded to App Store Connect, NOT submitted for Beta App Review.** Internal testers only. |
| UX declutter (`9042abf`) | On `main`. **Not in any build, not OTA'd.** (neighborhoods/match-reasons removed, profile collapsed, glows muted) |
| Compatibility feature (`f26e672`) | On `main`. **Not shipped.** Needs migration 0042 + OTA. |
| Migration 0041 (onboarding_complete) | **Deployed** ✅ |
| Migration 0042 (friend_taste_features) | **Local only — NOT deployed** ❌ |
| Sentry (`palate-sp`) | DSN set in prod env ✅ (only reports in build 14+) |
| Public TestFlight link | **Not set up.** External group never created. |

---

## TRACK A — Get the public TestFlight link live

*(This was started then abandoned. Build 14 is uploaded but not in review.)*

1. **[YOU]** Log into App Store Connect (agent cannot — Apple ID + 2FA).
2. **[YOU]** Confirm the review Gmail `palate.review1@gmail.com`: 2-Step Verification **OFF** ✅, **"Skip password when possible" → OFF** (still needs doing — it blocks the reviewer).
3. **[AGENT/YOU]** Verify **Test Information** saved (feedback email `kentonmcneal@gmail.com`, privacy URL `https://palate-zm29.vercel.app/privacy`, review notes explaining the OTP-via-inbox flow, sign-in username `palate.review1@gmail.com` + password). Password field is **[YOU]** only.
4. **[AGENT-OK]** Create **External Testing group** "Public Beta" → **enable the public link**. (Account change — confirm before I click.)
5. **[YOU]** **Export compliance** question when adding the build (legal declaration — you pick; standard-HTTPS exemption is the usual answer).
6. **[AGENT-OK]** Add **build 14** to the group → **Submit for Beta App Review**. *Outward/irreversible — explicit go each time.*
7. **[APPLE]** ~1 day review.
8. **[YOU]** Share the public link.

> Decide: submit **build 14** now for the link, or fold in the UX + compatibility
> work first (Track B) and submit a **build 15**. Recommendation: ship build 14's
> fixes to the link now; layer UX/compat via OTA after.

---

## TRACK B — Ship the UX cleanup + compatibility feature

Both are JS-only except migration 0042, so they reach build-14 devices via OTA —
**no new App Store build required.**

1. **[AGENT]** `npx tsc --noEmit` — green (verified). `npx jest` — green.
2. **[AGENT-OK]** **Deploy migration 0042** — `supabase db push` (dry-run first). *Production DB change — your go.* Additive + backwards-compatible (build 14 ignores the new RPC).
3. **[AGENT-OK]** **Push OTA** — `eas update --branch production -m "ux + compatibility"`. **PAID Expo command — your go.** Ships UX declutter + compatibility JS onto build 14.
   - Caveat: OTA goes to everyone on the `production` channel. For a *controlled* first look, use a `--branch preview` update and self-test there, then promote.
4. **[YOU]** Self-test the compatibility core (see §App checklist). Fastest ready pair: **friend the seeded `palate.review1` account** (18 visits) from your populated account — both clear the 5-visit gate today.
5. **[AGENT] (after you've eyeballed the core)** Build the deferred extensions (§Deferred).

---

## PERMISSIONS / APPROVALS THE AGENT NEEDS

**Money (per-action "yes" required — CLAUDE.md):**
- `eas update` (OTA), `eas build`, `eas submit` re-runs
- Any paid API run: LLM classifier / `eval:llm`, Google Places backfills, geocoding, email sends

**Production changes (your go):**
- `supabase db push` (migration 0042, and any future migration)
- `supabase functions deploy …`

**Account / outward actions the agent CANNOT do — [YOU]:**
- App Store Connect login (Apple ID + 2FA)
- Google account security (2FA, "Skip password")
- Entering ANY password/credential: Apple ID, the review Gmail password, the Supabase **service-role key**, API keys
- Export-compliance / legal declarations
- The final "Submit for Beta App Review" and "Enable public link" clicks are account actions — agent drives up to them and **confirms** before clicking

**Credentials the agent must NEVER handle (you enter them directly):**
- Apple ID password · review Gmail password · `SUPABASE_SERVICE_ROLE_KEY` · `ANTHROPIC_API_KEY` · any secret token

---

## CODE VERIFICATION CHECKLIST (how the agent checks the code)

Run from `mobile/` unless noted. Prefix RN/pod commands with `LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8` (empty locale breaks tooling), and build from a **space-free path** if ever doing a local iOS build (the `~/Claude Code/` space breaks CocoaPods/codegen).

- [ ] `npx tsc --noEmit` → exit 0
- [ ] `npx jest` → all suites green (palate suite = 24 tests)
- [ ] Classifier changes only: `npm run eval` (free) / `npm run eval:llm` (**paid**, needs `ANTHROPIC_API_KEY`) — harness at `supabase/eval/run.ts`
- [ ] `git status` clean; changes committed with clear messages
- [ ] Migration: `supabase db push --dry-run` shows only the intended file
- [ ] Deploy state: `supabase migration list --linked`, `supabase functions list`, `eas env:list production`, `eas build:list`
- [ ] Compatibility-specific: confirm `friend_taste_features` gates on `are_friends()` + `profile_visibility`; the scoring lib uses `{useSmoothing:false}` and the **pure** `computeCompatibility` (not cached `getCompatibility`); nearby fetched once

---

## APP VERIFICATION CHECKLIST (how to check the app on-device)

Install build 14 (+ OTA once pushed), then:

**Regression (fixes already in build 14):**
- [ ] Fresh email → **no crash**, onboarding appears exactly once
- [ ] Existing/populated account login → **no re-survey**
- [ ] Home recs → **no fast-food chains** in "Places you'll probably like"
- [ ] App stable on launch; no notification TypeError
- [ ] Sentry (`palate-sp`) shows no new fatal after a few sessions

**UX declutter (after OTA):**
- [ ] Restaurant cards: **no neighborhood line**, no "Matches your … habit" text
- [ ] Profile: no duplicate "Next Moves"; Wrapped/Account/Help/About/Your-data are **collapsible bars**
- [ ] Visuals noticeably **calmer** (score chip, CTA, identity, map pins)

**Compatibility (after migration 0042 + OTA):**
- [ ] Friend the `palate.review1` account
- [ ] Below 5 visits either side → **"keep logging to unlock"** with progress bars
- [ ] Both ≥5 visits → friend profile shows **"See your palate compatibility"** → result (Easy/Balanced/Stretch/Friction + summary + shared tags) + **"where you two should eat"** ranked by joint fit
- [ ] Non-friend / private profile → no compatibility entry / "add each other first"

---

## DEFERRED — compatibility extensions (build AFTER the core is validated)

- Group compatibility (3+ people)
- Per-occasion compatibility (date-night vs. business)
- Dietary-conflict sensing *(likely blocked — confirm dietary data is captured first)*
- 9:16 **share card** for the compatibility result (model on `SharePalateCard`/`WrappedStoryCard`)
- **Invite hook** — surface "invite a friend to see your compatibility" at the result (ties to `lib/referrals.ts`)
- Adjacent cluster (separate features): collaborative lists, "send a place"

---

## OPEN RISKS / NOTES

- **`palate.app` domain is dead** — privacy/links use the Vercel URL for now; point a real domain before a polished launch.
- **Google Places cost:** `featured-lists-refresh` + `gmail-import` call Google **outside** the kill-switch. Compatibility's "eat together" recs also hit Google Places (bounded by the kill-switch + 5-min cache).
- **OTA scope:** `eas update` on `production` reaches all testers at once — use a `preview` branch for a controlled first look.
- Full parked-features catalog + why each is stuck: see `PRODUCT_STRATEGY.md` and the session notes.

---

## UPDATE — compatibility + invite-only waitlist now built (NOT yet shipped)

Two more features are committed on `main` (typecheck-green, **not** deployed/OTA'd):
- **Friend palate compatibility + "eat together"** (`f26e672`) — migration **0042** + JS
- **Invite-only waitlist gate + admin approvals** (`b600cc7`) — migration **0043** + JS

Plus build 14 is now **submitted and "Waiting for Review"** in App Store Connect
(external "Public Beta" group, public link `testflight.apple.com/join/GYadZcZw`).
Review account is login-ready (2FA off, Skip-password off, passkey removed).

### Ship sequence — do this ONLY AFTER build 14's review passes

1. **[AGENT]** `npx tsc --noEmit` + `npx jest` green
2. **[AGENT-OK]** `supabase db push` → deploys migrations **0042 + 0043** *(production — your go)*
3. **[AGENT-OK]** `eas update --branch production -m "ux + compatibility + waitlist"` → **one OTA** ships UX declutter + compatibility + waitlist *(PAID — your go)*
4. **[YOU]** on-device test (all three were built blind — verify):
   - **Waitlist:** new fake account → "You're on the list"; your account → straight in; Profile → **Admin → Waitlist approvals** → approve the fake → it gets in
   - **Compatibility:** friend `palate.review1` (both ≥5 visits) → score + "where you two should eat"
   - **UX:** neighborhoods/match-reasons gone, Profile collapsed into bars, calmer visuals

### Why wait for review first
Don't OTA new behavior onto a build that's mid-review. The reviewer is
auto-approved regardless, but changing the app under a live review invites an
avoidable rejection. Ship once approved.

### Waitlist notes
- Existing users + `palate.review1` are **auto-approved** by the 0043 backfill — no lockout.
- `isApproved()` **fails open** — inert until 0043 deploys; safe to OTA the JS first.
- You approve in-app (**Profile → Admin → Waitlist approvals**) or by flipping `profiles.approval_status` in the DB.
- **Gap:** no notification when someone joins the waitlist — you must check the Admin screen. Fine for a small beta; add a push/email later.
- **Public link + waitlist compose:** the TestFlight public link admits up to 20 into the beta; the in-app waitlist controls actual access. You don't need both gates — simplest is keep the public link on and approve people in-app.

### Still deferred (compatibility extensions, after the core is validated)
Group compat (3+), per-occasion, dietary-conflict, share card, invite hook.
