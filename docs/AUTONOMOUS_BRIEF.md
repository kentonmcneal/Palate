# Working brief — run Palate's roadmap without checking in

Paste this as a session prompt. It is written to be executed, not read.

---

## Mission

Execute `docs/ROADMAP.md` in order. It is ordered by dependency, not effort:
accuracy first, because pattern data built on wrong visits is wrong data.

Do not ask which item to start. Start at the top of the queue below, finish it,
ship it, move down. Report at the end of each item, not before starting one.

---

## Standing rules

**Evidence.** Every claim that something works carries a label from CLAUDE.md:
`COMMITTED`, `WORKING TREE`, `LIVE`, `DEVICE`, `INFERENCE`. A clean `supabase db
push` proves nothing — invoke the thing. A green deploy proves nothing — call
the function and read the status code.

**Guards must fail first.** Four guards written in the week of 2026-09-09
passed while the thing they described was broken: a substring check that could
never match, a regex blind to JSX text, an allowlist that kept its own subjects
alive, and a flag matcher that counted a DELETE as a read. Before trusting any
new guard, make it fail on purpose and say so in the commit.

**Measure, do not reason.** Three times that week I was confidently wrong from
reading source — the price ladder, the brand rule, the PKCE theory — and right
every time I ran something. Run the harness. Query production. Prefer a probe
migration that raises `PROBE%` (it rolls back, records nothing) over an
argument.

**Screenshots settle visual work.** I cannot see the app. Any change to a
screen is `INFERENCE` until the founder sends a picture. Say so rather than
claiming it looks better.

**Never spend money without explicit per-action approval.** EAS build, update
and submit are pre-authorized. `supabase db push` and `functions deploy` are
pre-authorized. Google Places and Anthropic calls are NOT, at any volume.
Setting `ANTHROPIC_API_KEY` as a Supabase secret IS starting the backfill —
`llm_cuisine_backfill` runs every ten minutes.

**Ship what is finished.** Free work: commit, push, OTA via `scripts/ota.sh`.
Never `git add -A` while it runs — it swaps `app.json` through four runtimes and
`app-version.test.ts` exists because that was committed twice.

---

## Decisions already made — do not ask again

These were open questions. They are answered here so the queue does not stall.
Each says how to reverse it.

1. **Radius stays at 75m until items 1–4 are shipped and measured.** Dropping
   it trades a Panda Express false positive against real missed meals, and the
   miss rate is unknown. Revisit with `passive_misses` data in hand. *Reverse:
   one constant in `passive-pipeline.ts`.*

2. **Bars and nightlife stay loggable.** People eat at them. Already decided in
   `passive-loggable.test.ts`; a diff of the reason list finds differences, not
   mistakes. *Reverse: add to `NOT_A_DINING_STOP`.*

3. **Unclassified venues stay loggable.** Zero rows are unclassified today, so
   it is hypothetical, and the existing test's reasoning stands. *Reverse: the
   `== null` branch.*

4. **Familiar places ship as a measured row, not an argument.** Add "somewhere
   you loved" to Home, let `rec_funnel_weekly` say whether it is taken. Do not
   change the exclusion rules until it has four weeks of data. *Reverse: remove
   the row.*

5. **Aggregate only, never individual, in anything resembling a data product.**
   Not negotiable and not a judgement call to revisit.

6. **Palette is the warm terracotta family.** Six keys, one ramp. Do not
   reintroduce unrelated hues. *Reverse: `categoryColors` in `theme.ts`.*

---

## Queue

Work top to bottom. Each item is self-contained and free unless marked.

**1. Travel-aware suppression.** Home/work suppression learns overnight
clusters and only knows one city; travel silently disables it, which is exactly
when volume explodes — 987 detections in a week, one place resolved 24 times.
Detect "no known cluster within N km" as its own mode: longer minimum dwell,
tighter accuracy bound, and suppress a venue already resolved today. Measure
the before/after on `visit_detected` → `visit_logged` yield.

**2. Learn from "No".** A rejection writes `prompt_decisions` and suppresses
for six hours, teaching the resolver nothing. Make it permanently down-weight
that venue *at that location*. This is the feedback loop; it does not exist.

**3. Dwell shape.** A drive-through and a sit-down meal are both eight minutes.
The arrival/departure pattern differs and the fixes are already on device. This
is what produced ten prompts on a drive to an airport.

**4. Confidence gates the prompt.** `confidence` is computed per resolution and
banded, and is not consulted before asking. Ask when confident; batch the rest
into the digest; stay silent below a floor.

**5. Score on qualitative tags.** Free, but blocked on item 7. The taste graph
has a `flavors` dimension with almost nothing in it, which is why "a lot of
American but not much fried food" is currently inexpressible.

**6. Familiar-places row.** Per decision 4.

**7. Classifier backfill. COSTS MONEY — STOP HERE.** `flavor_tags` and
`occasion_tags` are missing on ~46% of recommendable places. Run
`RUN_LLM_EVAL=1 EVAL_LIMIT=20 npx jest classifier-llm-eval` only with a key the
founder has exported locally, report the measured cost, and wait.

**8. Promoted flag on the slate.** One field. Must exist before any paid
placement or the model learns people like whoever paid.

---

## Blocked work goes last, and asks once

Some tasks need the founder's own accounts. He does not want to be interrupted
as each one comes up. So:

**Do the free queue first, all of it.** When an item needs something below,
skip it, write it on the list, and keep going down. Only when the free queue is
exhausted, present every blocked item together, once, with the exact value
needed for each. One interruption, not seven.

| needs | what for |
|---|---|
| Apple ID | Nothing, if EAS keeps syncing capabilities. Otherwise one Developer-portal login. |
| Supabase dashboard | Auth → Apple → Client IDs = `app.palate.ios`. Secret Key stays EMPTY: the native `signInWithIdToken` flow does not use it. |
| `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ZONE_ID` | `palate.app` → Vercel, then flip `SHARE_DOMAIN`. Scoped to one zone, exported in his shell, never pasted into a conversation. |
| GitHub secrets | `SUPABASE_DB_URL`, `BACKUP_PASSPHRASE` for nightly backups. |
| Supabase secret | `SENTRY_WEBHOOK_SECRET` for crash alerts. |
| A spend ceiling | The classifier backfill. Nothing is spent without it. |
| His phone | Tapping Connect Gmail, rating visits. |

**Never take a credential into the conversation.** A scoped token exported in
his own shell and read from the environment is fine — that is how the Supabase
anon key and the classifier eval already work. An Apple ID is not scopeable and
is not acceptable at any time: it is his legal identity, it carries 2FA, and
actions taken with it are attributable to him.

---

## How to report

At the end of each queue item: what changed, the evidence label, the test
count, and whether it shipped. Not before starting one, and not a plan — the
plan is this file.

At the end of the free queue: the blocked list above, filled in, once.
