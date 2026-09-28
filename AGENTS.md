# AGENTS.md — Palate

Rules for any coding agent working in this repository. **`CLAUDE.md` is the governing
document**; this file exists so agents that read `AGENTS.md` by convention do not miss it.
Read `CLAUDE.md` in full before writing code. For current state, findings and the backlog,
read [`CODEX_HANDOFF.md`](CODEX_HANDOFF.md).

## What this is

An iOS app (Expo / React Native) that learns what you like to eat from your own visit history
and recommends restaurants. Two real users; TestFlight public beta.

- The app is in **`mobile/`**. The backend (Postgres + RLS, Deno edge functions, 180+
  migrations) is in **`supabase/`**.
- **Leave `landing/` alone.** The marketing site is out of scope unless an app-store
  requirement forces a change.
- This repo is **not** related to Groundwork (`~/Claude Code/Groundwork`). No shared code.

## Hard rules

### 1. Spending — read `CLAUDE.md` § "Spending policy"

**Never take an action that costs money without explicit, per-action approval.** When you reach
such a step, stop, describe the action and its cost, and wait.

Free: `git`, `tsc`, `jest`, reading files. **Pre-authorised: `eas build` / `eas update` /
`eas submit` only** (covered by the monthly Expo subscription). Everything else that spends —
paid API calls, provisioning, deploys — needs approval first.

**Credentials you can see are access, not permission to spend.**

### 2. A field-mask change is a PRICE change

Google Places bills by SKU, and the SKU is chosen by the **field mask**, not the endpoint.
Adding one field to a mask reads like a harmless one-line diff and is a price rise. That is how
a backfill billed **$300 in eight days** while every guard behaved exactly as written: the
budget counted *calls*, and a call counter cannot see a price change.

- **Never `fetch` a paid Google endpoint directly.** Go through `spendGoogle()` in
  `supabase/functions/_shared/google-spend.ts` — it gates on the dollar budget, prices by SKU,
  meters, and raises the alert. The sole exception is `gmail-import`'s free IDs-Only call.
- **Touching a field mask means naming its SKU in the same diff** and re-approving in dollars.
- **A new spender must not be able to go quiet.** Never re-implement the gate or the meter
  locally.
- **Do not re-run the bulk reviews backfill.** The cron is deliberately unscheduled; at two
  users, on-demand pricing beats coverage pricing.

### 3. Never destroy work you did not create

This repo is frequently worked by more than one agent session at a time. HEAD moved four times
during the handoff review on 2026-09-27.

**Never run `git checkout .`, `git stash`, `git clean`, or `git reset --hard`.** Assume
uncommitted changes belong to someone else. Check `git log -1` before trusting any commit hash.

### 4. Production switches that are not yours

- **`feature_flags.server_push` is OFF and only the founder flips it.** Every server push path
  is gated on it.
- Do not deploy (`supabase db push`, `supabase functions deploy`) without approval.
- Never commit `mobile/.env` or `landing/.env.local`.

### 5. Evidence labels are required

Every claim that something works carries one: `COMMITTED` (verified in the current commit),
`WORKING TREE`, `LIVE` (verified by *invoking* the deployed system), `DEVICE` (verified on a
physical iPhone), or `INFERENCE` (not verified — name the artifact that would settle it).

**A conclusion without a label is incomplete.** GitHub, the working tree, EAS, the installed
phone and live Supabase are five separate states; compare them explicitly. Reading the source
has repeatedly produced confident, wrong answers here — `CLAUDE.md` § "How to actually verify"
lists the specific traps (plpgsql parses `return query` only at runtime; revoke from `public`
AND `anon` AND `authenticated` by name; a successful deploy is not a booting function).

## Environment

```bash
export DEVELOPER_DIR=/Library/Developer/CommandLineTools   # or every git command exits 69
```

Xcode's licence is not agreed on this Mac, so `/usr/bin/git` fails and **the iOS app cannot be
built or run locally**. `node_modules` is already installed in `mobile/` — do not reinstall.

## Validation

```bash
cd mobile && npx tsc --noEmit && npx jest
```

Baseline is fully green (130 suites / 1132 tests as of `1410f09`). If
`lib/recommendation/__tests__` is red, check whether another session is mid-edit before
assuming you broke it.

Pushing `main` runs CI only — build, `tsc`, `jest`, a containerised DB smoke test. **No deploy.**

## Design and product invariants

- **Ranking principle:** the best restaurant in the city *for that person* comes first.
  **Distance is a tiebreaker, not a driver.** Price is an explicit table, not a rating effect.
- Any new recommendation surface **must** pass the `hidden` set to `filterRecommendable(...)`
  and subscribe to `onPersonalSignalInvalidate`, or permanently-excluded places reappear.
- **"Friend" is computed, not set** — it means a mutual follow. Following is one-sided and needs
  no approval.
- Import `Text` / `TextInput` from `components/`, **never from `react-native`** in `app/` or
  `components/` — React 19 removed `Text.defaultProps`.
- Cross-user reads go through security-definer RPCs that never return email. Enforce privacy in
  SQL, not in the client.
