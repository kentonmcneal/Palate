# CODEX_HANDOFF — Palate

**Written:** 2026-09-27 (23:30–00:05 CDT) by Claude Opus 5, as a handoff. No application
code was changed. Everything below is evidence-labelled.

This repo already has a house rule about evidence labels (`CLAUDE.md` → "Evidence labels").
This document uses it:

| Label | Means |
|---|---|
| `COMMITTED` | verified in the git commit named |
| `RUN` | I executed the command and this is its real output |
| `CODE` | read in the source; not executed |
| `LIVE` | verified against the deployed system by invoking it |
| `INFERENCE` | not verified — the artifact that would settle it is named |

**Nothing in this document is labelled `LIVE`.** I did not invoke the deployed system, did
not spend money, and did not run the app on a device or simulator. Section 8 says exactly
why and what that leaves unverified.

---

## 0. READ THIS FIRST — two facts that will cost you if you miss them

### 0.1 This repository was being edited by another agent while I wrote this

Not a hypothesis. Observed:

- At 23:39 `git status` was clean at `8c90cce`. (`RUN`)
- At 23:45 `git status` reported two modified files that had not existed minutes earlier:
  `mobile/lib/recommendation/compatibility.ts` and
  `mobile/lib/recommendation/__tests__/ranking-harness.test.ts`. File mtimes 23:41 and
  23:44 — inside my session. (`RUN`)
- Between two reads a few minutes apart the same function changed signature
  (`unseenPrior(map)` → `unseenPrior(g.totalVisits)`) — someone was iterating live. (`RUN`)
- At 23:52 the work was **committed** as `1410f09` and the tree went clean again. (`RUN`)
- At 00:14 the next day HEAD had moved **again**, to `7274dbe`. That session was still running
  when I handed over. (`RUN`)
- `ps` shows three `claude` processes (started Sep 6, Sep 26, and mine at 23:39) plus a
  Codex/ChatGPT helper started 23:26. (`RUN`)

**Consequences for you:**

1. `git log -1` may not be `1410f09` by the time you read this. **Re-establish state before
   trusting any commit hash in this document.**
2. Do not run `git checkout .`, `git stash`, `git clean`, or `git reset --hard` in this
   repo. Another session's in-flight work is invisible to you and is not always committed.
3. This project has history here: `docs/` records two sessions running the same brief
   concurrently and one overwriting the other's file mid-build. **Confirm with Kenton that
   the other session is finished before you start.**

I snapshotted the uncommitted diff at 23:45 to
[`docs/codex-handoff/superseded-worktree-snapshot-20260927T234537.patch`](docs/codex-handoff/superseded-worktree-snapshot-20260927T234537.patch).
It is **superseded** — commit `1410f09` contains that work and more. It is kept only as
proof of the concurrency, not as work to restore.

### 0.2 `git` on this Mac is broken until you set one environment variable

```bash
export DEVELOPER_DIR=/Library/Developer/CommandLineTools
```

Without it every `git` command exits 69 with *"You have not agreed to the Xcode license
agreements"* — `xcode-select -p` points at `/Applications/Xcode.app` and its git is
licence-gated. (`RUN`) The CommandLineTools git (2.39.5) is unaffected. There is no
Homebrew git on this machine. (`RUN`)

Agreeing to the licence needs `sudo` and is Kenton's to run, not yours.

---

## 1. Product overview

**Palate is an iOS app that learns what you actually like to eat and tells you where to go.**
Not a review site and not a reservations app: the thesis is that your own visit history,
captured with as little effort as possible, is a better recommender than a 4.5-star average.

- **Audience:** people who eat out often and are tired of generic "top rated near me". Two
  real users today (the founder in Newport News, one in Philadelphia). Public Beta via
  TestFlight.
- **The competitor that matters is Beli.** The defensible pieces are passive capture (visits
  logged without you doing anything) and Wrapped (a year-in-review artefact people share).
- **Platform: iOS only, Expo/React Native.** There is a `landing/` marketing site, but
  Kenton's standing instruction is to work the app and leave the website alone unless an
  app-store requirement forces it.

### Core domain vocabulary

| Term | Meaning |
|---|---|
| **Visit** | one meal at one restaurant. The atom everything derives from. |
| **Passive capture** | background visit detection via a native `CLVisit` module, then a confirm prompt. Three-gate opt-in. |
| **Taste graph** | per-user affinity maps over cuisine region/subregion/type, flavours, formats (`lib/recommendation/taste-graph.ts`). |
| **Compatibility** | how well one restaurant fits one person's taste graph (`compatibility.ts`). The `0–100` "match". |
| **Gems** | the quality gate: fast food and chains are dropped from every recommendation surface (`gems.ts`, `eligibility.ts`). |
| **Friend** | *computed*, not a state: a **mutual follow**. Following is one-sided and needs no approval (`lib/friends.ts`). |
| **Palate** | a person's taste identity — the persona label, the Wrapped artefact, the profile. |
| **Stretch** | a place you would plausibly enjoy but would not have picked (`candidates.ts` → `isStretch`). |
| **Degraded** | a response served from the DB catalogue because the Google budget tripped or the user hit their own cap. Not an error. |

### Main user journeys (`CODE` — see §8 for why not observed running)

1. **Onboarding** — `app/onboarding/`, `sign-in.tsx`, `claim-username.tsx`,
   `demographics.tsx`, `starter-quiz.ts`. Apple/Google/email-OTP sign-in → username →
   a starter quiz that seeds a taste graph before any visits exist → waitlist gate
   (new signups land `pending`; founder approves in Profile → Admin).
2. **Home** — `app/(tabs)/index.tsx`. Ranked picks for right now, open-now aware, rotated so
   it does not freeze, plus a Stretch card.
3. **Discover / Map** — `app/(tabs)/discover.tsx`, `app/map.tsx`. Search is submit-triggered,
   not keystroke-triggered; map refetches on region change through a cache.
4. **Logging a visit** — `app/(tabs)/add.tsx`, `confirm-visit.tsx`, plus the passive path
   (`passive-inbox.tsx`, `digest.tsx`) and email-receipt import (`import-email.tsx`).
5. **Social** — `app/(tabs)/feed.tsx`, `follows.tsx`, `people.tsx`, `profile/`, `group.tsx`.
6. **Wrapped / identity** — `app/(tabs)/wrapped.tsx`, `wrapped-story.tsx`, `year-in-review.tsx`.

### What is real, what is not

| Area | State | Evidence |
|---|---|---|
| Recommendations end-to-end | Real and tested — 130 Jest suites, 1132 passing | `RUN` |
| Passive capture | Real; detection confirmed on-device 0.1.5(23) per project memory | `INFERENCE` (not re-verified here) |
| Follows / mutual-friend model | Real, enforced in SQL | `CODE` |
| Feed | Real but thin: 4 event kinds, no pagination | `CODE` §6E |
| Google cost controls | Rebuilt today in dollars; deployment not verified by me | `CODE` §6B |
| Server push | Built and **switched OFF** behind `feature_flags.server_push`. Only Kenton flips it. | project memory + `CODE` |
| Sentry crash reporting | Wired, but no DSN locally → no-op in local dev; production unverified | §6C |
| Analytical writing / anything web | N/A — different product (Groundwork) | — |

---

## 2. Repository state and preservation

| | |
|---|---|
| **Absolute path** | `/Users/kentonmcneal/Claude Code/Palate` (note the space in `Claude Code`) |
| **Remote** | `git@github.com:kentonmcneal/Palate.git` (SSH, no embedded credentials) |
| **Branch** | `main`, tracking `origin/main` |
| **HEAD when I started** | `8c90cce` |
| **HEAD when I validated** | `1410f09` — *fix(rank): absence of evidence was being scored as evidence against*. **All test/typecheck results in this document were measured at `1410f09`.** |
| **HEAD when I committed this doc** | `7274dbe` — *docs(rank): compressing affinity does not help, and here is the sweep*. Moved again ~15 min later, i.e. the other session was **still working** as I handed over (§0.1). |
| **Working tree** | clean apart from this handoff at each check (`RUN`) |
| **Stashes** | none (`RUN`) |
| **Worktrees** | one, the repo itself (`RUN`) |
| **Other branches** | `sdk-upgrade` — local `ae6d62b`, origin `4e47819`, **diverged**. Stale; confirm before touching. |

### Files that are ignored but must survive — never delete, never commit

| Path | What it is |
|---|---|
| `mobile/.env` | `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` |
| `landing/.env.local` | landing-site config |
| `landing/.vercel/` | Vercel project link |
| `supabase/.temp/` | Supabase CLI project link |
| `.claude/settings.local.json` | local tool permissions |

`mobile/.env` has **no `EXPO_PUBLIC_SENTRY_DSN`** — relevant to §6C.

### Preserving a baseline before you redesign (recommended)

The safest baseline here is a git tag plus a copy of the ignored config **outside** the repo:

```bash
export DEVELOPER_DIR=/Library/Developer/CommandLineTools
cd "/Users/kentonmcneal/Claude Code/Palate"
git tag codex-baseline-$(date +%Y%m%d)      # local tag, no push, no deploy
mkdir -p ~/palate-env-backup && cp mobile/.env landing/.env.local ~/palate-env-backup/
```

Then work on a branch: `git switch -c codex/<topic>`.

**Restoring only your own work, leaving everything else alone:**

```bash
git diff codex-baseline-YYYYMMDD -- <the paths you touched> > /tmp/mine.patch   # review first
git restore --source=codex-baseline-YYYYMMDD -- <the paths you touched>          # scoped revert
```

Never `git reset --hard` or `git clean` — §0.1.

**Do not push without reading §8.** Pushing `main` is not itself a deploy, but the repo has
GitHub Actions in `.github/` — check what they run before you push.

---

## 3. Architecture and environment map

### Stack

| Layer | Technology |
|---|---|
| App | Expo SDK 57, React Native 0.86, React 19.2.3, expo-router 57, TypeScript 6.0.3 |
| Package manager | npm (`mobile/package-lock.json`) |
| Backend | Supabase — Postgres + RLS, Edge Functions (Deno), Auth, Storage |
| Migrations | `supabase/migrations/`, **180 files**, latest `0180_friends_in_cities.sql` |
| External APIs | Google Places (New) — the only material cost; Anthropic Haiku for cuisine classification |
| Crash/observability | Sentry (`@sentry/react-native`) + a custom global error handler |
| Push | Expo push, via a `push_outbox` drained every 5 min |
| Build/ship | EAS Build / Update / Submit |
| Native | `modules/palate-visit-monitor` (Swift, `CLVisit`) |

### Monorepo boundaries

`mobile/` (the app) · `supabase/` (DB + edge functions) · `landing/` (Next.js marketing site,
leave alone) · `evals/`, `scripts/`, `infra/`, `marketing/`, `docs/`. No shared package —
`mobile/` and `supabase/functions/` each have their own copy of classification logic; the
canonical classifier is `supabase/functions/_shared/classifier.ts`.

### Commands — what I ran, and what I did not

| Command | Where | Result |
|---|---|---|
| `npx tsc --noEmit` | `mobile/` | **exit 0, clean** at `1410f09` (`RUN`) |
| `npx jest` | `mobile/` | **130 suites, 1132 passed, 1 skipped, 0 failed** at `1410f09` (`RUN`) |
| `npx jest` | `mobile/` | *Earlier, mid-edit at `8c90cce` + dirty tree:* 13 suites / 16 tests failed. Transient — see §6G. (`RUN`) |
| `npx eas whoami` | `mobile/` | **fails — eas-cli is not installed** (`RUN`). Not installed by me. |
| `npm test` | `mobile/` | not run (equivalent to `npx jest`) — `NOT RUN` |
| `npx expo start` | `mobile/` | **NOT RUN** — see §8 |
| `supabase db push` / `functions deploy` | `supabase/` | **NOT RUN** — costs money / changes production |

**Baseline to expect: fully green.** If you see red in `lib/recommendation/__tests__`, check
whether someone is mid-edit before assuming you broke it.

### Environment variable NAMES (never values)

Client (`mobile/.env`): `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`,
`EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`, and referenced-but-absent `EXPO_PUBLIC_SENTRY_DSN`.

Server (Supabase secrets, set in the dashboard — **not in this repo**): `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, `GOOGLE_MAPS_API_KEY`, `ANTHROPIC_API_KEY`,
`GOOGLE_DAILY_BUDGET_USD`, `ALERT_PUSH_TOKEN`.

Test-only: `RUN_LLM_EVAL`, `EVAL_LIMIT` — leave unset; setting them spends money.

### Anything that can cost money or touch production

- `supabase functions deploy`, `supabase db push` — production.
- `RUN_LLM_EVAL=1` — real Anthropic calls.
- Invoking the `places-proxy`, `reclassify`, `featured-lists-refresh` edge functions against
  production — real Google spend.
- `eas build/update/submit` — **pre-authorised** by `CLAUDE.md` (covered by the Expo
  subscription), but still announce what you shipped.
- Everything else in `CLAUDE.md` → "Spending policy" requires per-action approval.

---

## 4. Recent meaningful changes (last 7 commits, all Sept 26–27)

| Commit | What and why |
|---|---|
| `1410f09` | **Absence of evidence was being scored as evidence against.** A never-eaten cuisine scored *worse* than a completely unclassified place, and the penalty grew with how much you ate. Replaced with a breadth-scaled prior. This is the fix to the bimodal ranker `8c90cce` measured. |
| `8c90cce` | Added baselines (seeded-random + Google-rating popularity) to the held-out eval. Result: personalisation beats both on aggregate MRR ~6×, but is **2W/2L paired** — carried by two good ranks against two catastrophic ones. |
| `6ce9b5a` | "Friends in cities" — city-grain aggregate of friends' visits. Deliberately **costs nothing**: city derived from `addressComponents` already in `restaurants.google_raw`. Privacy gates enforced in SQL (mutual follow, private profiles excluded, ≥2 visits, month not timestamp, no restaurant identity in the return type). |
| `edd0d2a` | **Budget re-denominated in dollars**, migration `0179`. `_shared/google-spend.ts` makes guard + fetch + SKU pricing + metering + alerting one call. |
| `851cfa3` | **Restored 8 enrichment guards that `0127` silently dropped** via `create or replace`. Ordinary browsing had been erasing paid review text and re-queueing rows for $0.025 re-fetches. |
| `f40a634` | Stopped the reviews backfill that billed $300 in eight days; unscheduled the cron. |
| `25a4f2b`, `22fdd3b` | The reviews backfill itself (Sep 14) — the thing that caused the $300. |

**Known regression risk:** `1410f09` changed the core taste-scoring function. Tests are green,
but the held-out eval sample is **four places**. Treat any ranking claim as provisional.

---

## 5. Findings with evidence

### 5.1 Reproduced by running something

| # | Finding | Evidence |
|---|---|---|
| R1 | Full Jest suite is green at `1410f09`: 130 suites / 1132 tests | `RUN` |
| R2 | `mobile` typechecks clean | `RUN` |
| R3 | Repo was edited by another agent mid-session; `git status` output changed three times | `RUN`, §0.1 |
| R4 | `git` is unusable without `DEVELOPER_DIR` | `RUN`, §0.2 |
| R5 | `eas-cli` is not installed → EAS env/build state is not inspectable | `RUN` |
| R6 | JSX **does** decode `&apos;`/`&amp;`/`&nbsp;` even in React Native — I transformed a snippet with `babel-preset-expo` and got `we'll`, `&`, `\xA0` | `RUN`. **So the 11 `&apos;` in the codebase are NOT a rendering bug.** Cosmetic only. |
| R7 | Automated spellcheck over ~640 extracted user-visible strings found **zero real misspellings** | `RUN` |

### 5.2 Verified through code

| # | Finding | Location |
|---|---|---|
| C1 | Three code paths call `nearbyRestaurants()` **without** the 5-minute client cache | `lib/palate-persona.ts:372`; `lib/recommendation/candidates.ts:73` when `preFetched` is absent; reached from `lib/palate/pairCompatibility.ts:148` |
| C2 | Feed has **no pagination** — `list_feed(p_limit)` takes a limit and no cursor; the screen has pull-to-refresh and no `onEndReached` | `lib/feed.ts:82`, `app/(tabs)/feed.tsx:130` |
| C3 | Feed has only **4 event kinds** | `lib/feed.ts:20` |
| C4 | **Two parallel design systems**: `mobile/theme.ts` (114 files) and `mobile/lib/theme/palateTheme.ts` (5 files), with a comment saying not to merge them | `RUN` (file counts) + `CODE` |
| C5 | Copy is **not centralised** — no i18n/strings module; 259+ inline JSX literals | `RUN` (grep counts) |
| C6 | Terminology drifts for one concept: "spots"(6) / "places"(7) / "restaurants"(4); "friends"(9) / "people"(10) / "follow"(2) | `RUN` (grep counts) |
| C7 | Apostrophe style is inconsistent: 26 straight `'` vs 11 `&apos;`, zero typographic `’` | `RUN` |
| C8 | Hardcoded `COMING DECEMBER 2026` | `app/year-in-review.tsx:31` |
| C9 | Sentry is a **no-op without a DSN**, and `mobile/.env` has none | `lib/observability.ts:31-34` |
| C10 | Crash safety net is genuinely good: global handler for uncaught exceptions **and** unhandled promise rejections, plus `toError()` which fixes Supabase's non-Error rejections | `lib/global-error-handler.ts`, `lib/observability.ts` |
| C11 | Client cache quantises to ~150 m buckets with a 5-min TTL; map and Discover both use it | `lib/nearby-cache.ts` |
| C12 | Search fires on **submit**, not per keystroke | `app/(tabs)/discover.tsx:232` |

### 5.3 Suspected — needs validation

| # | Hypothesis | How to settle it |
|---|---|---|
| S1 | Sentry is inert in production too (no DSN in EAS env) | `eas env:list production` once eas-cli is available — **names only, never paste values** |
| S2 | `0179`/`0180` are deployed (the `edd0d2a` message says "verified after deploy") | Call `places-proxy` unauthenticated; its own lowercase `unauthorized` proves the module loaded, and costs nothing (`CLAUDE.md` §"How to actually verify", rule 5) |
| S3 | The `sdk-upgrade` branch is abandoned | Ask Kenton |

---

## 6. The improvement plan

### 6A. Typos and product copy

**The honest finding: there are no typos to fix.** An automated dictionary pass over ~640
extracted user-visible strings surfaced zero genuine misspellings (`RUN`), and the `&apos;`
entities render correctly (`RUN`, R6). Do not go hunting for spelling errors; the real
problems are structural.

**Where copy lives:** scattered. 259+ literal JSX text nodes across `app/` and `components/`,
plus string props and `Alert.alert` calls. There is no strings module. `lib/save-copy.ts` is
about copying a *save*, not copy text.

**Real problems, in priority order:**

1. **Terminology drift** (C6). One concept, three nouns. Pick one word per concept and write
   it down. Suggested: a place is a **restaurant** in body copy and a **spot** never; a
   logged meal is a **visit**; the social graph is **people** you **follow**, and "friends"
   is used only where mutual follow is genuinely required.
2. **Apostrophe inconsistency** (C7). Pick straight `'` (safest in RN) and convert the 11
   `&apos;`.
3. **`COMING DECEMBER 2026`** (C8) — a hardcoded date that will be wrong in January. Derive
   it or gate it.
4. **No centralisation.** Recommend `mobile/lib/copy.ts` exporting grouped constants, and
   migrating *opportunistically* — a big-bang extraction of 259 strings is churn with no user
   benefit and a large merge-conflict surface given §0.1.

**Acceptance:** a reader can walk onboarding → log a visit → feed → profile and never see two
words for one thing; no hardcoded future date; new strings land in `copy.ts`.

**Free verification:** re-run the extraction in
`docs/codex-handoff/` (the grep recipes are in §5), plus `npx jest` and `npx tsc --noEmit`.

---

### 6B. Unexpected API spending — the NYC question

> **Headline: the $300 was diagnosed and fixed on Sept 26–27, hours before this handoff. The
> cause was not a user in NYC.** Do not re-investigate from scratch; verify the fix and close
> the remaining holes.

#### Confirmed cause (`CODE`, and arithmetic that closes exactly)

The **reviews backfill** (migrations `0173`–`0175`, shipped Sep 14) swept all 5,137
restaurants with `MASK_WITH_REVIEWS`. That field mask selects Google's **Place Details
Enterprise + Atmosphere SKU at ~$0.025/call** — about 5× what the 1500-calls/day cap had been
sized against. Google auto-paid **$100 on Sep 18 and $200 on Sep 23**.
$300 ÷ 8 days = $37.50/day = exactly 1500 × $0.025. Run rate ~$1,140/month.

**The kill switch never malfunctioned.** It counted *calls*, and a call counter cannot see
that a field-mask change is a price change.

Three bugs made the job non-terminating, and a fourth made it silent:

1. `reclassify` stamped `refreshed_at` but never `reviews_refreshed_at` on failure, so dead
   `place_id`s pinned the head of the nulls-first queue and were re-paid forever.
2. The batch query only **ordered** nulls-first, never **filtered** — so it re-bought text it
   already had.
3. `prune_stale_review_text` nulled `reviews_refreshed_at` at 30 days, re-arming the queue.
4. **The root cause, found Sep 26:** `0127_business_status.sql` rewrote
   `restaurants_preserve_enrichment` with `create or replace` and silently lost **eight**
   guards from `0110`. `places-proxy` upserts *every* place it sees on the nearby/search
   paths (`index.ts:344`, `:497`) with a cheap mask, writing nulls into `review_snippets`,
   `editorial_summary`, `reviews_refreshed_at`, `tags`, and four more. With the guards gone
   those nulls landed — **so ordinary browsing erased paid review text and re-queued the row
   for a $0.025 re-fetch.**
5. **Why nobody was told:** `bump_google_usage` returns `crossed_warn`/`crossed_trip` **once
   per day**, to whichever caller crosses the line. Only `places-proxy` read those flags and
   pushed an alert. `featured-lists-refresh` and `reclassify` called the same RPC and threw
   the result away — so the 2am cron ate both one-shot flags every night. Eight nights, zero
   notifications.

#### Where NYC actually fits — **plausible, not confirmed**

The dense-city angle is *not* the cause, but it is not irrelevant either:

- Finding 4 was **worst inside the metro scope, because that is where the users browse**
  (`851cfa3` commit message). A user browsing a dense city touches far more `place_id`s per
  session, so each browsing session wiped and re-queued proportionally more rows.
- `f40a634` scoped the sweep to a corridor that **includes NYC** (Hampton Roads / DC /
  Baltimore / Philadelphia / NYC).
- Project memory records one of the two users spent two months in NYC.

**So: a heavy NYC user plausibly amplified a defect whose cause was a nightly cron plus a
dropped SQL guard. Density was an accelerant, not the origin.** Do not report NYC as the root
cause, and do not let the corridor scoping be mistaken for a fix — it is a blast-radius
reduction.

#### What is already fixed (`CODE`, deploy status `INFERENCE` → S2)

- `0176` unschedules the job, prune keeps the cursor. `0177` adds `reviews_attempts`, three
  strikes and a row retires.
- `0178` restores the eight guards; the prune announces itself with the transaction-local GUC
  `palate.pruning_review_text` so the terms-mandated 30-day expiry still wins.
- `0179` + `supabase/functions/_shared/google-spend.ts`: **budget in dollars**
  (`GOOGLE_DAILY_BUDGET_USD`, default **$5/day**), `SKU_MICROS` price table, unknown SKU
  priced at the most expensive known rate, and guard+fetch+price+meter+alert as a single
  call so a new spender cannot be silent.
- Per-user cap `USER_CAP_PER_DAY = 120` plus a burst limit, counted off `proxy_calls`; over
  cap returns catalogue rows with a `degraded` flag, **not a 429**.
- Client: 5-minute, ~150 m-bucket `nearby` cache (C11); search on submit (C12).

#### What is still open — your actual work

| Priority | Item | Detail |
|---|---|---|
| **P0** | **Verify the gate is deployed and no path bypasses it** | S2. Also re-run the check `edd0d2a` claims: no raw `fetch` to `places.googleapis.com` outside `_shared/google-spend.ts` except `gmail-import`'s free IDs-Only call. `grep -rn "places.googleapis.com" supabase/functions` |
| **P0** | **Only one price is confirmed** | `SKU_MICROS` comments say only `details_enterprise_atmosphere` (25,000 micros) is verified against the bill. The other four are list-price estimates. Correct them from Billing → Reports grouped by SKU. **I did not open the billing console and will not invent prices.** |
| **P1** | **Three uncached billed paths** (C1) | `lib/palate-persona.ts:372` (radius 600–1500, called on mount from `RecommendationsCard` and `WeeklyPalateInsights`), and `candidates.ts:73` via `pairCompatibility.ts:148` (radius 2500, no `preFetched`). Route all three through `getOrFetchNearby`. Bounded by the $5/day server budget, so this is efficiency, not an emergency. |
| **P1** | **The GCP quota backstop has the same flaw** | 2000/day × $0.025 = $50/day. Set it **per-SKU on the Atmosphere SKU specifically**, low (~200/day). Console work — Kenton's, not yours. |
| **P2** | Client controls are bypassable by definition | The client cache is an optimisation; a modified client ignores it. The server budget is the real control. Keep it that way — never move a limit client-side. |

#### The free test you should write

Synthetic dense-city fixture, no network:

1. Build a fixture of ~2,000 synthetic places in a 5 km² box (mirror
   `lib/recommendation/__fixtures__/memphis-pool.json`, which is already 227 KB of real shape).
2. Stub the `places-proxy` invoke boundary with a **counting** fake.
3. Drive: cold launch → Home → Discover → 10 map pans within one 150 m bucket → 10 pans
   across buckets → search submit ×3 → pull-to-refresh ×5.
4. **Assert an upper bound on the number of billed calls**, and assert that repeating the
   same bucket inside 5 minutes adds **zero**.
5. Add a case where the stub returns `degraded: true` and assert the UI still renders a list
   and says so rather than erroring.

This costs nothing, runs in CI, and is the regression test the $300 never had.

**Do not attempt to reproduce the spend against live Google.**

---

### 6C. Security, crashes, reliability

**Security is in better shape than "no security to check crashes" suggests.** Sept 5 and
Sept 14 were both security passes. Fixed and committed: `is_admin` self-grant (`0101`),
friend embeds through own-row RLS (`0102`), friendship forging (`0104`), blocks now cut both
ways (`0108`), `are_friends()` was an oracle for the anon key (`d034fbc`/`0172`), private
profiles were broadcasting visits (`9080a58`/`0171`), feed-post pushes checked the wrong
person's visibility (`21b30f3`). Every cross-user read is a definer RPC that does not return
email.

`CLAUDE.md` already encodes the two traps worth keeping: **revoke from `public` AND `anon`
AND `authenticated` by name**, and **plpgsql parses `return query` only at runtime**, so a
clean `db push` proves nothing — invoke the function.

**Crash detection, concretely:**

- `lib/global-error-handler.ts` installs handlers for uncaught JS exceptions *and* unhandled
  promise rejections, reports, and — in production — **does not re-raise**. This exists
  because under the New Architecture an unhandled rejection was escalated by `expo-updates`'
  error-recovery queue into a `SIGABRT` (the new-account launch crash, fixed in build 13).
- `lib/observability.ts` → `toError()` converts Supabase's plain `{code, details, hint,
  message}` rejections into real `Error`s. Without it Sentry files everything under *"Object
  captured as exception with keys: …"* — which per the source cost two of three users four
  days of invisible failures.
- A React `ErrorBoundary` is in `app/_layout.tsx` (render-phase only, by design).

**The gap that matters (C9/S1):** `initObservability()` returns early when `DSN` is falsy and
logs *"no SENTRY_DSN — observability is a no-op"*. `mobile/.env` has no
`EXPO_PUBLIC_SENTRY_DSN`. **Locally, crash reporting is off.** Whether production builds get
it from EAS env is unverified — eas-cli is not installed (R5).

**Work, in order:**

1. **P0 — settle S1.** If production has no DSN, every crash since launch went unrecorded and
   the whole apparatus above is decorative. One command, names only.
2. **P1 — a crash you can actually see.** Add a hidden debug action (`app/debug-visits.tsx`
   is the natural home) that throws a tagged error and an unhandled rejection, so you can
   prove end-to-end that both reach Sentry with a readable title. Verify with a **synthetic**
   error string; never log user content.
3. **P1 — network failure behaviour.** `_shared/retry.ts` exists server-side; audit the
   client for screens that render a spinner forever on a failed fetch. Every list screen
   needs loading / empty / error / degraded states — §6E notes the feed as a known offender.
4. **P2 — sensitive logging sweep.** `grep -rn "console.log" mobile/app mobile/lib` and check
   nothing prints tokens, emails, or coordinates.

**Verifying without exposing data:** assert on error *shape* (name, tagged message, breadcrumb
category) in Jest, not on payloads; use synthetic accounts; never paste a DSN, token, or real
email into a test, a log, or this repo.

---

### 6D. Visual redesign

**Correct a likely assumption first: a light "OpenTable/Airbnb" re-skin has already landed.**
`mobile/theme.ts` documents it in comments — restrained ember red `#E0473C` on a neutral
ground, `paper: #F6F6F6` page with white cards, `ink: #222222`. WCAG work is real, not
aspirational: `primaryFill: #C13A2F` exists specifically because `#E0473C` measures 4.09:1 on
white and fails AA for text at 5.37:1, and there are `lib/contrast.ts` and `lib/a11y.ts`
modules. (`CODE`)

**So "looks AI built" is not a palette problem.** The concrete, nameable defects:

1. **Two design systems (C4).** `theme.ts` (114 files) and `lib/theme/palateTheme.ts` (5
   files) coexist with an explicit "don't merge these" comment. `palateTheme` is dark —
   wine/oxblood/near-black with a glow — and `theme.ts` is light. So the Wrapped and identity
   surfaces are a **different app** visually from the diary and discovery surfaces. That
   seam, not the colours, is the strongest "assembled by a machine" signal.
2. **Colour carries almost no information.** The six-hue secondary palette was deliberately
   collapsed into "one warm family" on 2026-09-12 at Kenton's request. The result is defensible
   but flat: nothing in a list tells you *why* an item is there.
3. **No photography.** A deliberate cost decision (Google Photos API). A restaurant app with
   no images leans entirely on typography and spacing to create appetite — and currently does
   not carry that weight.
4. **Type is single-voice.** Inter throughout, via `components/Text`. Kenton has an open
   question on serif-vs-sans. A serif display face for restaurant names and Wrapped headlines
   would do more for perceived craft than any colour change.

**Recommended direction:** *editorial, not dashboard.* Keep the light ground and the restrained
red. Add a second typeface for display. Earn hierarchy with scale and spacing instead of
boxes and hairlines (`theme.ts` already says "rely on shadow + space"). Resolve the two themes
by **porting Wrapped to light**, or by making the dark system an explicit, deliberate "story
mode" with a visible transition — either is coherent; the current accident is not.

**Files:** `mobile/theme.ts` (the one that matters), `mobile/lib/theme/palateTheme.ts`,
`mobile/components/` (`Text`, `TextInput` — React 19 killed `Text.defaultProps`, so **never**
import `Text` from `react-native` in `app/` or `components/`).

**Baseline and rollback:** tag before you start (§2), keep the redesign on `codex/redesign`,
and change **tokens before components** — a palette swap is one file to revert, a relayout is
not. Screenshot the main screens before and after; there are no baseline screenshots in this
repo today because I could not run the app (§8).

**Cover the whole experience:** loading, empty ("no friends yet", "no visits yet"), error,
and the **degraded** state (§6B) which is unique to this app and easy to forget. Supported
sizes: iPhone SE through Pro Max, plus **Dynamic Type** — `055a08c` fixed onboarding buttons
that vanished at larger text sizes, so this has bitten before.

---

### 6E. Friends and feed

**Existing, verified:**

- **Model:** Instagram-shaped (`lib/friends.ts`). `follow` is one row, immediate, no approval.
  Mutual follow = "friend", **computed, never set**. States: `none | following | follows_you |
  mutual`. The old mutual-accept model produced *one* accepted friendship across fourteen
  accounts — that is why it was replaced.
- **Privacy:** `profile_visibility` is `private | friends | public`. A friends-only profile
  requires **mutual** follow. Blocks cut both ways (`0108`). Private profiles are excluded
  from broadcasts (`0171`). Enforced in SQL via definer RPCs, not in the client.
- **Discovery:** `app/people.tsx`, `browse_profiles`, username claim, invites/referrals.
- **Feed:** `feed_events` with **4 kinds** — `visit_logged`, `wrapped_shared`,
  `persona_change`, `milestone` (C3). `feed_likes` and threaded comments exist
  (`0146`, `0148`) with notifications.
- **New:** friends-in-cities aggregate (`6ce9b5a`), Friends tab only, renders nothing when
  there is nothing to say.

**Gaps, separated as asked:**

| Kind | Gap |
|---|---|
| **UI** | No pagination/infinite scroll — `list_feed(p_limit)` then pull-to-refresh (C2). No reaction affordance surfaced despite `feed_likes` existing. |
| **Backend** | No cursor in `list_feed`. No ranking — chronological only. No dedupe rule (five visits in one night = five cards). |
| **Schema** | No reaction *types* (only a like row). No "seen" state, so there is no unread/new concept. |
| **Product** | No no-friends experience worth the name: an empty feed is the default state for literally every new user, and with two users it is the *normal* state. |

**Translating Beli / Snapchat / Instagram into Palate** — pick the mechanic, not the skin:

- **From Beli:** ranked lists as the social object. Palate already has `rankings.tsx` and
  pairwise ranking is noted in project memory as the #1 post-launch feature. A friend's
  *ranking* is more interesting than a friend's check-in.
- **From Instagram:** asymmetric follow (already done) and a feed that tolerates low volume.
- **From Snapchat:** *lightweight, expiring, low-stakes* sharing — which is what makes a
  two-user network survivable. Not stories-as-a-format; the principle that posting costs
  nothing and disappearing is fine.

**Explicitly do not** copy their visual language, icons, or naming.

**Recommended first implementation (one cohesive slice):**

1. Add a cursor to `list_feed` + `onEndReached`. Without it the feed cannot grow.
2. Collapse multi-visit days into one card per person per day. Fixes the duplicate problem
   before it exists.
3. Surface the reactions the schema already supports — one tap, optimistic, with the
   notification path already built.
4. **Design the empty feed as a real screen**: "follow these people", the friends-in-cities
   module, your own recent visits. Today's empty feed is the product's most-seen screen.

**Backlog:** friend-ranked lists as feed objects; a "seen" state and an unread badge; sharing
a card out of the app; ranking beyond chronology (only once volume justifies it).

**Acceptance** must be journey-shaped: a new user with zero follows sees a useful screen; a
user who follows one person sees their visit within a refresh; scrolling past the first page
loads more without duplicates; a private-profile user's visits never appear to a non-mutual
follower (assert in SQL, not the client); every state — loading, empty, error, permission-denied
— renders.

---

### 6F. Personal profile

**Where it lives:** `app/(tabs)/me.tsx`, `app/profile/`, `components/ProfileBody.tsx`,
`app/edit-profile.tsx`, `app/curate-profile.tsx`, `app/photos.tsx`, `app/insights.tsx`,
`app/insights-deep.tsx`, `app/rankings.tsx`.

**Data sources:**

| Shown | Comes from | Reliable? |
|---|---|---|
| Name, username, avatar, visibility | `profiles` table, user-set | Yes |
| Visits, counts, streaks | `visits` table | Yes — the atom |
| Persona label / taste identity | derived, `lib/palate-persona.ts` | **Derived from few visits.** Honest only above a threshold. |
| Match / compatibility % | `lib/recommendation/compatibility.ts` | Changed **today** (`1410f09`). Treat as provisional. |
| Insights, Wrapped stats | `lib/analytics-stats.ts`, `lib/wrapped.ts` | Aggregates of visits; fine |
| Shared places with a friend | `get_friend_profile_snapshot` | Definer RPC; historically the single worst bug in the repo (raised `42702` for 65 migrations — every profile said "Profile not found"). **Exercise it, don't read it.** |

**Known problem:** the profile shows *derived* values (persona, compatibility) with the same
visual weight as *counted* ones (visits). With ≤5 visits the derived ones are noise.
Recommend a visible confidence treatment — hide or caveat derived values below a threshold —
rather than rendering a confident-looking wrong persona. The codebase already has the honest
instinct: the compatibility feature requires both people to have ≥5 visits.

**Recommended hierarchy:** identity (who you are) → counted facts (visits, streak) → derived
identity (persona, top cuisines, caveated) → lists (rankings, wishlist) → connections →
settings. Today these are flatter than that.

---

### 6G. Recommendation algorithm

**The pipeline, step by step** (`mobile/lib/recommendation/`):

1. **Candidate generation** — `candidates.ts:generateCandidates`. Source: `nearbyRestaurants`
   (Google via `places-proxy`, radius default **2500 m**) or `preFetched`. Returns `[]` on an
   empty pool.
2. **Eligibility / exclusions** — `dedupeVenues` (a venue Google lists twice would otherwise
   take two of three Home slots), then `filterRecommendable(..., { hidden })`:
   - `eligibility.ts` — a **primaryType food gate** added after UNIQLO, cinemas, transit and
     banks leaked into recommendations.
   - `gems.ts` — hard-drops fast food and chains; near-excludes cafés unless they clear a gem
     bar. Ordinary sit-down places survive and rank below gems.
   - `chains.ts`, `brand.ts` — chain detection.
   - **Hidden set** — `place_dislikes` (`0105`), a permanent per-user exclusion. **Any new
     recommendation surface MUST pass `hidden` and subscribe to `onPersonalSignalInvalidate`.**
3. **Pools** — taste-similar (cuisine subregion ≥0.05 or region ≥0.05) and stretch
   (`isStretch`: not in your subregion, but adjacent region / matching flavour / matching
   format).
4. **Scoring** — `compatibility.ts:computeCompatibility` over the taste graph
   (cuisine region / subregion / type, flavours, formats), shrunk toward a prior by
   `trust = m/(m+5)`. Then `scoring.ts` → `finalScore`, `gems.ts:gemAdjustment`, an explicit
   **price table (+10/−8)**, open-now, and distance.
5. **Ranking principle (do not silently revisit):** *the best restaurant in the city **for
   that person** comes first.* **Distance is a tiebreaker, not a driver.** Nearby-by-distance
   is an opt-in tab. Price is an explicit table, not a rating side effect.
6. **Diversity / freshness** — `reranking.ts`, a cap-by-key, and a rest rule that rotates Home
   so it does not freeze.
7. **Cold start** — the starter quiz seeds region/format maps with `totalVisits = 0`;
   `persona-prior.ts` and `population-prior.ts` fill the rest.
8. **Feedback** — `feedback.ts` is **place-scoped**: implicit feedback moves `finalScore`
   only, and never the taste graph or the match %. `rec_feedback_loop` flag is on.
   "Not interested" writes a permanent exclusion.

**Chargeable dependency:** exactly one — `nearbyRestaurants` → `places-proxy` → Google
`searchNearby`. Scoring itself is pure and free. Classification uses Haiku once per
restaurant, cached 30 days.

#### The weakness that was live today, and is now fixed

`8c90cce` measured the ranker against two free baselines on the same four held-out places:

```
ranker        n    MRR    R@10  R@30  NDCG@30  meanRank
personalized  4   0.048   0.25  0.50    0.135     102.3
popularity    4   0.008   0.00  0.00    0.000     124.3
random        4   0.008   0.00  0.00    0.000     141.8
```

Aggregate MRR ~6× both baselines — but **2W/2L paired**, carried by ranks 7 and 27 against
187 and 188 of 200. The cause: a cuisine you have never eaten scored *worse* than a place
with no cuisine data at all, and the penalty **grew with how much you ate**
(`trust` rises with `totalVisits`). `1410f09` replaced it with a breadth-scaled prior that
sits, by construction, below the unknown prior — so `good > unknown > known-poor` holds
without a clamp.

I observed this mid-flight: at `8c90cce` with a dirty tree, 13 suites / 16 tests were red and
the invariant measured unknown 56.4 vs known-poor 57.5 (inverted). At `1410f09` the whole
suite is green. (`RUN`)

#### Remaining weaknesses

1. **The eval sample is four places.** Every number above is directionally interesting and
   statistically meaningless. `8c90cce` was right to make the popularity gate recorded-but-not-
   enforced. **Do not tune against n=4.**
2. **Popularity is worth nothing here** (meanRank 124/200) — which retroactively justifies the
   taste graph, and also means there is no cheap fallback for a user with no history.
3. **No diversity or latency metric is measured at all.** Only rank quality.
4. **Cold start is asserted, not measured** — there are `cold-start.test.ts` and
   `quiz-cold-start.test.ts`, but no held-out evaluation of a *new* user.

#### A free, reproducible evaluation you should build

Extend `lib/recommendation/eval.ts` (it already has MRR, recall@k, NDCG@k, mean rank and two
baselines) into a matrix — all offline, all on fixtures, zero API calls:

| Dimension | Cases |
|---|---|
| Density | dense synthetic city (~2,000 places) vs sparse (~40) |
| User | new (quiz only) · light (5 visits) · returning (35 visits, the founder fixture) |
| Conflict | a user whose quiz contradicts their visits |
| Degenerate | empty pool · all-ineligible pool · all-duplicate pool |
| Limits | the `degraded` path from §6B |

**Measures — all proposed targets are recommendations, not validated thresholds:**

- **Relevance:** MRR and recall@10 vs the random floor. *Gate:* beats random, paired. Promote
  the popularity gate to enforced **only when n ≥ 30**.
- **Variety:** distinct cuisine subregions in the top 10, and max share of any one subregion.
  *Suggested:* ≥4 distinct, no subregion >40%.
- **Latency:** wall-clock of `generateCandidates` + scoring on the 2,000-place fixture.
  *Suggested:* <150 ms.
- **API volume:** billed calls per journey, from the counting stub in §6B. *Target:* an
  asserted upper bound, and **zero** for a repeated 150 m bucket inside 5 minutes.

**Do not promise personalisation you cannot support.** With ≤5 visits the graph is a quiz
prior. Say so in the UI rather than showing a confident match %.

---

## 7. Prioritised backlog

Ordered as instructed: spending and data-loss first, then safe validation, then broken
journeys, then features and polish. **One deviation, explained at the end.**

| # | Item | Pri | Depends on | Where | Acceptance (journey-level) | Free verification | Risk / rollback |
|---|---|---|---|---|---|---|---|
| P1 | **Confirm the dollar budget + guards are deployed** | P0 | §0.1 clear | `supabase/functions/_shared/google-spend.ts`, `0178`–`0180` | An unauthenticated `places-proxy` call returns the function's own lowercase `unauthorized`; no raw `fetch` to `places.googleapis.com` outside the module except `gmail-import` | grep + one unauthenticated call (costs nothing) | None — read-only |
| P2 | **Correct the four estimated SKU prices** | P0 | billing access (Kenton) | `SKU_MICROS` in `google-spend.ts` | Each SKU's micros matches Billing → Reports grouped by SKU, or is commented as still estimated | Read the console; change one table | Guessing low overruns the budget. Never guess low. |
| P3 | **Bounded-request regression test** (§6B) | P0 | — | new `lib/recommendation/__tests__/` + fixture | Asserted upper bound on billed calls for a scripted dense-city journey; repeat bucket in 5 min = 0 calls | `npx jest` | None; test-only |
| P4 | **Settle whether Sentry has a production DSN** | P0 | eas-cli (Kenton) | EAS env | A deliberate synthetic crash appears in Sentry with a readable title | `eas env:list production` — **names only** | If absent, every crash so far is unrecorded |
| P5 | **Route the 3 uncached nearby callers through the cache** | P1 | P3 (so you can measure it) | `palate-persona.ts:372`, `candidates.ts:73`, `pairCompatibility.ts:148` | Mounting `RecommendationsCard` twice in 5 min bills once; P3's bound drops | `npx jest` | Low — revert one file |
| P6 | **Per-SKU GCP quota backstop on Atmosphere** | P1 | Kenton | GCP console | Cap ~200/day on the Atmosphere SKU | n/a — console | Console-only; not yours to set |
| P7 | **Feed pagination + day-collapse** | P1 | — | `list_feed` RPC, `lib/feed.ts:82`, `app/(tabs)/feed.tsx` | Scrolling past page one loads more, no duplicates; five visits in a night = one card; loading/empty/error all render | `npx jest` + SQL assertions in the migration | Medium — new migration; additive only |
| P8 | **Design the empty feed** | P1 | P7 | `app/(tabs)/feed.tsx` | A user with zero follows sees a useful screen, not blankness | snapshot tests | Low |
| P9 | **Terminology + copy consistency** | P2 | — | `app/`, `components/`; new `lib/copy.ts` | One word per concept across onboarding → log → feed → profile; no hardcoded `DECEMBER 2026` | grep recipes in §5 + `tsc` | Low, but high merge-conflict surface — do it when §0.1 is quiet |
| P10 | **Resolve the two design systems** | P2 | baseline tag | `theme.ts`, `lib/theme/palateTheme.ts` | Wrapped and Home read as one app; contrast ratios still pass `lib/contrast.ts` | screenshots before/after + `tsc` | **Highest-churn item here.** Tokens before components. |
| P11 | **Confidence treatment for derived profile values** | P2 | — | `components/ProfileBody.tsx`, `palate-persona.ts` | Below the visit threshold, persona/match are caveated or hidden | `npx jest` | Low |
| P12 | **Evaluation matrix** (§6G) | P2 | P3's fixture | `lib/recommendation/eval.ts` | Dense/sparse × new/light/returning reported each run; variety + latency measured | `npx jest` | None; test-only |
| P13 | **Reactions surfaced in the feed** | P3 | P7 | `lib/feed.ts`, feed card | One tap reacts, optimistic, notification fires | `npx jest` | Low |

**The one deviation from the suggested order:** P4 (crash visibility) is P0 despite being
"reliability" rather than "spending", because until it is settled you cannot tell whether any
later change broke something for the real users. Conversely the $300 incident itself is
**already remediated** — P1/P2 are verification, not firefighting — so spending work is P0 by
verification burden, not by live bleeding.

---

## 8. Access, cost, production and rollback boundaries

### What I did not do, and why

| Not done | Reason |
|---|---|
| **Ran the app** (simulator or device) | Needs a dev build: the app has a custom native module (`palate-visit-monitor`), so Expo Go cannot load it. Building needs Xcode, whose **licence has not been agreed** on this Mac (§0.2) — and agreeing needs `sudo`, which is Kenton's. Project memory also records that local iOS builds fail from a path containing a space, which `~/Claude Code/` has. |
| **Signed in** | The only reachable accounts are real. Email OTP is an outbound send; Apple/Google sign-in creates real rows. |
| **Invoked any edge function** | Real Google/Anthropic spend. |
| **Ran migrations or deployed** | Production. |
| **`eas env:list` / `eas build:list`** | eas-cli not installed, and I was told not to install dependencies (R5). |
| **Opened the GCP billing console** | No access from here. This is why four SKU prices remain estimates. |

**Consequence you must carry forward:** there are **no Palate screenshots** in this handoff
and no reproduced UI findings. Everything in §6D/6E/6F is `CODE`, and §5.1 lists exactly what
was actually executed. Do not upgrade any of it to "observed" without running the app.

### Cost boundaries for your work

Free: `git` (with `DEVELOPER_DIR`), `tsc`, `jest`, reading files, grep.
**Pre-authorised:** `eas build` / `update` / `submit` only.
**Everything else that spends — ask first**, per `CLAUDE.md`.
Credentials in `mobile/.env` are access, not permission to spend.

### Production boundaries

Do not flip `feature_flags.server_push` — only Kenton does, and every server push path is
gated on it. Do not re-run the reviews backfill; the standing decision is that at two users,
on-demand pricing beats coverage pricing. The cron is deliberately **unscheduled**.

---

## 9. Unknowns, defaults, blockers

**Blockers (need Kenton or access):**

1. Is the other agent session finished? (§0.1) — **ask before starting.**
2. Xcode licence (`sudo xcodebuild -license`) — blocks running the app at all.
3. eas-cli availability — blocks P4.
4. GCP billing access — blocks P2.

**Unknowns, with the artifact that settles each:**

| Unknown | Settled by |
|---|---|
| Is `0179`/`0180` deployed? | one unauthenticated `places-proxy` call |
| Does production have a Sentry DSN? | `eas env:list production` |
| Are the four estimated SKU prices right? | Billing → Reports grouped by SKU |
| Is `sdk-upgrade` abandoned? | ask |
| Does the new prior in `1410f09` hold up? | n≥30 held-out set — **not n=4** |

**Sensible defaults if I am unreachable:** keep the light theme and restrained red; keep
distance as a tiebreaker; keep the budget in dollars and never move a limit client-side;
prefer additive migrations; when a value is derived from few visits, caveat it rather than
hide the feature.

---

## 10. Supporting files

- [`docs/codex-handoff/superseded-worktree-snapshot-20260927T234537.patch`](docs/codex-handoff/superseded-worktree-snapshot-20260927T234537.patch)
  — the uncommitted diff captured at 23:45, **superseded by `1410f09`**. Evidence for §0.1.
- Pre-existing context worth reading, in order: `CLAUDE.md` (rules, non-negotiable),
  `docs/ALGORITHM_REVIEW.md`, `docs/REVIEW_2026-09-05.md`,
  `docs/AUDIT_FINDINGS_2026-09-13.md`, `FINISH_LINE.md`.
