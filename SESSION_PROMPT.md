# Palate — session prompt

**Paste this as the opening message of a Claude Code session opened from `~/Claude Code/Palate`.**

---

## 0. Repo boundary — read first

You own **Palate only**: `~/Claude Code/Palate`.

There is a second, unrelated product at `~/Claude Code/Test Prep` (GRE Mastery), worked
by a different session. **Never read from, write to, or `cd` into it.** Different repo,
different product, no shared code. If a task seems to need something from there, stop and
ask — it doesn't.

**Before your first write, check for a peer session in this repo:**

```bash
ps aux | grep "[c]laude" ; git -C . status --short
```

Also run `ListAgents`. If another session is live in this repo, **do not write anything** —
message it, agree who owns the repo, and stand down if it is further along. Two agents
editing one codebase silently destroy each other's uncommitted work; this happened on
2026-09-02 in the other repo and cost both sessions their in-flight Phase A. Checking costs
ten seconds.

---

## 1. Verified state (2026-09-02)

- Branch **`sprint/tester-feedback`**, **11 commits ahead of `main`**, nothing merged.
- `mobile/`: `npx tsc --noEmit` clean, **154 tests / 18 suites green**.
- App version **0.1.7** (bumped for a new native runtime — `expo-screen-capture`).
- EAS build **`556144d4`, 0.1.7 (26)** finished. **Not submitted. Not distributed.**
  It was built from `f56ebf3` and therefore **does NOT contain the Dynamic Type commit**
  (`a97c9e5`).
- Supabase migrations applied through **0053**, verified against production:
  `restaurants.is_chain_brand` populated (154 of 951 flagged, no false positives found),
  `feature_flags.discovery_pings` present and **off**.
- Google Places usage: **40–56 billable calls/day**, cap 1500, kill switch never tripped.

`SPRINT_2_ZERO_COST.md` in this repo is the plan. Read it, plus `CLAUDE.md` (the spending
policy is a hard rule) and `SPRINT_LOG.md` (what shipped last session and what is unverified).

---

## 2. Scope, in order

**First, three things that are already queued and blocking a release:**

1. **Rebuild.** Build 26 predates the accessibility fix. Cut a new build off the current
   branch head so the Dynamic Type work is actually in a binary.
2. **Verify the lock-screen notification actions on a physical device.** This is the
   highest-value thing shipped last sprint and the only part that could not be verified —
   action buttons cannot be exercised in the Simulator. Test: trigger a confirm
   notification, tap "Yes, I ate here" with the app fully closed, reopen, confirm the visit
   landed. It fails *silently* by design if the background write is dropped, so this must be
   checked by hand.
3. **Finish the Dynamic Type pass** — Wrapped, Insights, onboarding, and the Wrapped story
   cards were not touched and are the most layout-fragile screens in the app. Reported by a
   real user (the founder's mother) running a large iPhone text size, so the bar is "she can
   use it", not "it compiles".

**Then work `SPRINT_2_ZERO_COST.md` in its stated order.** Its P0 is the server-side nearby
cache in places-proxy — it adds nothing a user can see, and it is still the right first
move, because every nearby request that misses the client cache currently costs a Google
call and that is the number that scales with users.

---

## 3. Permissions

**Granted — do not ask:**
- Any file in this repo; `npm`/`npx`/`node`/`python3`; `git add`/`commit`/`branch` on a
  working branch
- `npx tsc --noEmit`, `npm test`, `npx jest <path>`
- `supabase db query --linked "<read-only SQL>"` — use it freely; grounding a decision in
  real rows beats reasoning about it
- `supabase db push` — **always `--dry-run` first** and confirm only your own migrations are
  pending. Applied through 0053; next is **0054**.
- `supabase functions deploy <name>`
- `eas build` / `eas update` / `eas submit` (pre-authorized in `CLAUDE.md`) — but see the
  distribution rule below
- Sending a test push to the developer's own device (Expo push is free)
- Merging this sprint's branch to `main` once its work is green
- Subagents for parallel work

**Stop and ask, every time:**
- Anything that spends: Google Places, the LLM classifier, geocoding, email sends, beyond a
  normal local dev run
- **Scheduling** any cron. Writing one is free; scheduling it attaches a recurring bill.
- **Distributing to testers** — pushing to real users, or submitting when the intent is to
  reach the external TestFlight group. Building is pre-authorized; putting something in
  front of people is a separate decision and it is the user's.
- Flipping a `feature_flags` row **on** in production
- Any non-additive migration: dropping columns, deleting data

**Never:**
- Widen a Google search radius, remove a rate limit, or raise `GOOGLE_DAILY_CALL_CAP` to
  make something work. If a fix needs more paid calls, write up the finding and stop.
- Invoke `featured-lists-refresh` — it calls Google directly.
- Touch `~/Claude Code/Test Prep`.

---

## 4. Hard rules

- `npx tsc --noEmit` clean and `npm test` green before every commit. Do not regress below
  154 tests.
- Many small commits, one per unit of work, each saying what changed and *why*.
- Bump `version` in `app.json` whenever native code changes — the runtime is the version
  string, and an OTA reaching a binary without the native module fails silently.
- Report honestly. If something is unverified — especially anything needing a physical
  device — say so plainly instead of implying it works.
- Update `SPRINT_LOG.md` as you go.

---

## 5. End of session

Append to `SPRINT_LOG.md`: what shipped, what is verified and *how*, what you could not
verify and why, anything you want the user's eyes on, and your recommended next move.
