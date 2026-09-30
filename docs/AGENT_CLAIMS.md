# AGENT_CLAIMS.md — who is holding what, right now

More than one coding agent works this repo at the same time. This file is how they avoid
editing the same thing. It is **advisory, append-only, and self-expiring** — read it before you
edit, add a row when you start something that will take a while, and never delete somebody
else's row.

## Why this exists, concretely

Every one of these happened on 2026-09-29, in one session:

- A Claude session committed onto `codex/handoff-priorities` **without noticing it was on
  someone else's feature branch**. No harm, because the change was one appended doc section —
  luck, not care.
- That branch tip moved **three times** under an in-progress task (`854cd8c` → `95f94b2` →
  `2940e17` → `cac1285`).
- Twice the working tree held **another agent's uncommitted files** (`observability*`, then
  `delete-account/index.ts` + a new script).
- Earlier, a patch was written against a **stale copy of `reclassify/index.ts`** that had been
  rewritten two days before. It failed on a string mismatch, which is the only reason it did not
  land on top of somebody's fix.

`AGENTS.md` already records the same shape from 09-27: *"HEAD moved four times during the
handoff review."*

## The rules

1. **Before you edit anything, run the check.** One command, costs nothing:

   ```bash
   ./scripts/checks/claims.sh
   ```

   It prints the live claims, the branch you are on, and anything uncommitted. If you skip this,
   nothing else here helps — the information was always available; the failures above were
   failures to look.

2. **Uncommitted changes in the working tree are a claim, and they outrank this file.** If
   `git status` shows files you did not touch, someone is mid-edit. Do not edit those paths, do
   not `git add -A`, and never run `git checkout .`, `git stash`, `git clean` or
   `git reset --hard` (`AGENTS.md` rule 3).

3. **Commit only the paths you claimed.** `git add <path>`, never `git add -A`. This is what
   made today's collisions harmless.

4. **Say which branch you are on.** Branch confusion, not file confusion, was the actual
   failure. If you are about to commit to a branch with someone else's name on it, stop.

5. **Claims expire.** Default two hours. An expired row is void and needs no cleanup — that is
   deliberate, because a lock that has to be released is a lock that gets abandoned. Give
   yourself a longer window if the work is genuinely long, and say so in the note.

6. **This file is not a mutex.** Two agents can still claim the same path in the same second and
   neither will see the other, because a claim has to be committed to be visible and commits
   race. It reduces collisions; it cannot prevent them. Rule 2 is the reliable half.

## Enforcement

`.githooks/pre-commit` refuses a commit whose staged paths fall under another agent's
unexpired claim. **One-time setup per clone**, because git does not share hooks:

```bash
git config core.hooksPath .githooks
export PALATE_AGENT=claude        # or codex — the hook cannot tell you apart otherwise
```

`./scripts/checks/claims.sh` warns when either is missing.

It is a **no-op while the table below is empty**, deliberately: a hook with false positives
gets deleted and then protects nothing. It is also not security — `--no-verify` bypasses it and
git offers no way to prevent that. It makes not-looking fail loudly rather than silently.

Verified by making it fire: an unexpired claim by another agent blocks (including via glob), and
an empty table, an expired claim, a non-matching path, and your own claim with `PALATE_AGENT`
set all pass.

## Active claims

Newest first. **Exactly six columns — the hook parses `agent`, `paths` and `expires` by
position, so do not add or reorder them.** `expires` must be UTC ISO to the minute
(`2026-09-29T23:04Z`); it is compared as a string, which is why the format is fixed. `paths` is
space-separated and may glob (`mobile/lib/observability*`). Delete your own row when done, or
let it expire.

| agent | branch | paths | opened | expires | note |
|---|---|---|---|---|---|
| codex | `codex/handoff-priorities` | `mobile/scripts/visit-write-account*` `mobile/lib/visits.ts` `mobile/lib/__tests__/prompt-refusals.test.ts` `mobile/lib/__tests__/visit-write-*` `docs/codex-handoff/VISIT_WRITE_*` `mobile/lib/passive-runner.ts` `mobile/lib/passive-pipeline.ts` `mobile/lib/passive-confidence.ts` `mobile/lib/__tests__/digest-cancels-on-confirm.test.ts` `mobile/lib/passive-digest.ts` `mobile/lib/passive-confirm.ts` `mobile/lib/__tests__/passive-*` `docs/codex-handoff/PASSIVE_*` `docs/codex-handoff/CODEX_WORKLOG.md` `docs/codex-handoff/CODEX_BACKLOG.md` | 2026-09-29T23:12Z | 2026-09-30T01:12Z | Task01a0e643 user-prioritized offline passive capture and evening reminder recovery; no device/live messages. |
| codex | `codex/handoff-priorities` | `mobile/lib/recommendation/right-now.ts` `mobile/lib/recommendation/chains.ts` `mobile/lib/recommendation/__tests__/right-now-chain-parity.test.ts` `docs/codex-handoff/RIGHT_NOW_CHAIN_*` `docs/codex-handoff/CODEX_WORKLOG.md` `docs/codex-handoff/CODEX_BACKLOG.md` | 2026-09-29T22:53Z | 2026-09-30T00:53Z | Task01a0e643 duplicate chain substring gate false-positive audit; synthetic pipeline only. |
| codex | `codex/handoff-priorities` | `supabase/functions/_shared/llm-admission*` `supabase/functions/classify-cuisine-backfill/index.ts` `supabase/functions/places-proxy/index.ts` `supabase/scripts/*llm*` `supabase/scripts/llm-admission/*` `supabase/scripts/backfill-classifier.ts` `mobile/package.json` `.github/workflows/build.yml` `supabase/eval/run.ts` `mobile/lib/__tests__/classifier-llm-eval.test.ts` `docs/codex-handoff/LLM_*` `docs/codex-handoff/CODEX_WORKLOG.md` `docs/codex-handoff/CODEX_BACKLOG.md` | 2026-09-29T22:31Z | 2026-09-30T00:31Z | Task01a0e643 reviewed disabled-by-default LLM admission integration and offline tests; no migration/deployment. |
| codex | `codex/handoff-priorities` | `supabase/functions/classify-cuisine-backfill/index.ts` `supabase/functions/places-proxy/index.ts` `supabase/scripts/test-llm-spend-guards.cjs` `docs/codex-handoff/LLM_*` `docs/codex-handoff/CODEX_WORKLOG.md` `docs/codex-handoff/CODEX_BACKLOG.md` | 2026-09-29T21:55Z | 2026-09-29T23:55Z | Task01a0e643 bounded LLM accounting and retry safeguards; atomic policy remains separate draft. |
| codex | `codex/handoff-priorities` | `mobile/app/(tabs)/feed.tsx` `mobile/lib/__tests__/feed-loading-races.test.tsx` `docs/codex-handoff/CODEX_BACKLOG.md` `docs/codex-handoff/CODEX_WORKLOG.md` `docs/codex-handoff/FEED_*_20260929.md` | 2026-09-29T20:30Z | 2026-09-29T22:30Z | Task01a0e643; recommendation integration complete a72d662. Reviewed feed integration; other workers scratch-only. |
| _(none)_ | | | | | |

## Closed recently

Kept briefly so the next session can see what was just touched.

| agent | branch | paths | closed | outcome |
|---|---|---|---|---|
| claude | `main` | `docs/AGENT_CLAIMS.md`, `scripts/checks/claims.sh`, `AGENTS.md`, `CLAUDE.md` | 2026-09-29 | this convention |
| claude | `main` | `supabase/functions/send-push/index.ts`, `CODEX_HANDOFF.md` | 2026-09-29 | surfaced retry counts (S8) |
| codex | `codex/handoff-priorities` | `mobile/lib/observability*`, `supabase/functions/delete-account/index.ts` | 2026-09-29 | in flight at time of writing |

| codex | `codex/handoff-priorities` | `mobile/app/(tabs)/add.tsx` `mobile/lib/__tests__/add-search-*` `docs/codex-handoff/ADD_SEARCH_*` `docs/codex-handoff/CODEX_WORKLOG.md` `docs/codex-handoff/CODEX_BACKLOG.md` | 2026-09-30T00:39Z | 2026-09-30T02:39Z | Task01a0e643 reviewed Add search admission integration, offline only. |

| codex | `codex/handoff-priorities` | `mobile/lib/passive-pipeline.ts` `mobile/lib/passive-confirm.ts` `mobile/lib/__tests__/passive-*` `docs/codex-handoff/PASSIVE_*` `docs/codex-handoff/CODEX_WORKLOG.md` `docs/codex-handoff/CODEX_BACKLOG.md` | 2026-09-30T01:09Z | 2026-09-30T03:09Z | Task01a0e643 offline passive input validation and inbox recovery; no native/deployment. |

| codex | `codex/handoff-priorities` | `mobile/app/(tabs)/add.tsx` `mobile/lib/__tests__/add-save-*` `docs/codex-handoff/ADD_SAVE_*` `docs/codex-handoff/CODEX_WORKLOG.md` `docs/codex-handoff/CODEX_BACKLOG.md` | 2026-09-30T01:14Z | 2026-09-30T03:14Z | Task01a0e643 independently reviewed Add save completion ownership; offline only. |

| codex | `codex/handoff-priorities` | `mobile/app/confirm-visit.tsx` `mobile/app/confirm-multi.tsx` `mobile/app/digest.tsx` `docs/codex-handoff/CODEX_WORKLOG.md` `docs/codex-handoff/CODEX_BACKLOG.md` | 2026-09-30T01:23Z | 2026-09-30T03:23Z | Task01a0e643 coffee-inclusive confirmation copy, no flow changes. |

| codex | `codex/handoff-priorities` | `mobile/lib/passive-digest.ts` `mobile/lib/__tests__/passive-digest*` `docs/codex-handoff/CODEX_WORKLOG.md` `docs/codex-handoff/CODEX_BACKLOG.md` | 2026-09-30T01:30Z | 2026-09-30T03:30Z | Task01a0e643 accurate delayed-reminder date wording; no schedule changes. |

| codex | `codex/handoff-priorities` | `mobile/lib/passive-runner.ts` `mobile/lib/passive-capture.ts` `mobile/lib/__tests__/passive-storage-*` `docs/codex-handoff/PASSIVE_STORAGE_*` `docs/codex-handoff/CODEX_WORKLOG.md` `docs/codex-handoff/CODEX_BACKLOG.md` | 2026-09-30T01:31Z | 2026-09-30T03:31Z | Task01a0e643 preserve unreadable retry/processed/raw queues before native acknowledgement; offline. |

| codex | `codex/handoff-priorities` | `mobile/lib/passive-inbox-sync.ts` `mobile/lib/passive-confirm.ts` `mobile/scripts/passive-sync-account*` `mobile/lib/__tests__/passive-*` `mobile/app/passive-inbox.tsx` `docs/codex-handoff/PASSIVE_*` `docs/codex-handoff/CODEX_WORKLOG.md` `docs/codex-handoff/CODEX_BACKLOG.md` | 2026-09-30T01:43Z | 2026-09-30T03:43Z | Task01a0e643 initiating-account mirror and honest inbox recovery, offline review only. |

| codex | `codex/handoff-priorities` | `mobile/lib/passive-inbox-policy.ts` `mobile/lib/passive-confirm.ts` `mobile/lib/passive-digest.ts` `mobile/lib/__tests__/passive-digest-expiry.test.ts` `docs/codex-handoff/PASSIVE_*` `docs/codex-handoff/CODEX_WORKLOG.md` `docs/codex-handoff/CODEX_BACKLOG.md` | 2026-09-30T01:54Z | 2026-09-30T03:54Z | Task01a0e643 prevent low-only deferral beyond inbox expiry; synthetic offline. |

| codex | `codex/handoff-priorities` | `mobile/lib/passive-pipeline.ts` `mobile/lib/passive-misses.ts` `mobile/lib/__tests__/passive-radius*` `docs/codex-handoff/PASSIVE_*` `docs/codex-handoff/CODEX_WORKLOG.md` `docs/codex-handoff/CODEX_BACKLOG.md` | 2026-09-30T02:09Z | 2026-09-30T04:09Z | Task01a0e643 radius rejection diagnostics after independently reviewed cache correction. |

| codex | `codex/handoff-priorities` | `mobile/lib/capture-status.ts` `mobile/lib/passive-capture.ts` `mobile/lib/passive-permissions.ts` `mobile/lib/notifications.ts` `mobile/components/CaptureWarning.tsx` `mobile/components/HomeHero.tsx` `mobile/app/(tabs)/me.tsx` `mobile/app/settings.tsx` `mobile/lib/home-state.ts` `mobile/lib/__tests__/capture-status*` `mobile/lib/__tests__/home-state.test.ts` `docs/codex-handoff/PASSIVE_STATUS_*` `docs/codex-handoff/CODEX_WORKLOG.md` `docs/codex-handoff/CODEX_BACKLOG.md` | 2026-09-30T02:13Z | 2026-09-30T04:13Z | Task01a0e643 reviewed permission-status honesty and local auth ordering; no permission requests or activation. |

| codex | `codex/handoff-priorities` | `mobile/app/settings.tsx` `mobile/components/PassiveCaptureToggle.tsx` `mobile/lib/__tests__/passive-toggle*` `docs/codex-handoff/PASSIVE_*` `docs/codex-handoff/CODEX_WORKLOG.md` `docs/codex-handoff/CODEX_BACKLOG.md` | 2026-09-30T05:19Z | 2026-09-30T07:19Z | Task01a0e643 reviewed saved-consent settings and repair ownership; offline mocks only. |

| codex | `codex/handoff-priorities` | `mobile/lib/__tests__/push-preferences-mounted.test.tsx` `mobile/lib/__tests__/push-preferences-independent.test.tsx` `mobile/lib/__tests__/profile-settings-boundary.test.tsx` | 2026-09-30T05:27Z | 2026-09-30T07:27Z | Task01a0e643 exact new capture component test boundary; preserves existing push/profile assertions. |

| codex | `codex/handoff-priorities` | `mobile/lib/passive-capture.ts` `mobile/lib/__tests__/passive-start-stop*` `mobile/lib/__tests__/passive-toggle-safety.test.tsx` `docs/codex-handoff/PASSIVE_*` `docs/codex-handoff/CODEX_WORKLOG.md` `docs/codex-handoff/CODEX_BACKLOG.md` | 2026-09-30T05:39Z | 2026-09-30T07:39Z | Task01a0e643 independently reviewed same-runtime consent start/stop ordering; no native/deviceclaims. |
