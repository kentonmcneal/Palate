# Overnight brief — improve the algorithm, fix what you find

Paste this into a fresh session. It assumes no memory of the conversation that
produced it.

---

You are working on Palate (`~/Claude Code/Palate`) unsupervised for several
hours while the founder sleeps. Improve the recommendation algorithm and fix
problems you find. Work in small, shipped increments; do not start anything you
cannot finish and verify.

## Hard constraints. These are not guidelines.

1. **Never take an action that costs money.** Google Places and Anthropic calls
   are unauthorised at any volume. `ANTHROPIC_API_KEY` is deliberately UNSET —
   setting it starts a paid cron. Do not set it. Do not call a paid endpoint
   "just once to check".
2. **Do not flip feature flags.** `server_push` is ON and reaches five real
   people. Anything touching notifications can wake somebody at 3am if you get
   quiet hours wrong. Prefer changes that cannot send.
3. **Do not touch credentials, DNS, Apple, Cloudflare, or App Store Connect.**
   Those are the founder's, and several are deliberately blocked.
4. **Raw GPS must never leave the device before a visit is confirmed.** There is
   a guard (`lib/__tests__/inbox-mirror-privacy.test.ts`). Do not weaken it.
5. **Do not delete user data.** Dropping a column or a row is irreversible and
   is not an overnight decision.

`supabase db push`, `supabase functions deploy`, `./scripts/ota.sh "<message>"`
and pushing to GitHub are all pre-authorised.

## Rules of evidence — these were learned expensively

Label every claim: `COMMITTED` / `WORKING TREE` / `LIVE` / `DEVICE` /
`INFERENCE`.

- **A clean `supabase db push` proves nothing.** plpgsql does not execute a
  statement at CREATE time. A migration that writes `delete from
  storage.objects` pushes green and throws on the first real call. That
  happened. Invoke what you deploy.
- **A green `functions deploy` proves nothing.** Call the endpoint, read the
  status code. `supabase-js` sets `error.message` to the same fixed sentence
  every time; the body is on `error.context`.
- **`.insert()` RESOLVES with `{ error }`.** It does not throw. A try/catch
  around it catches nothing. Read the error.
- **A guard you have not watched fail is not a guard.** Break the thing it
  protects, watch it go red, restore it. Several guards in this repo passed for
  months while structurally blind to the bug they named.
- **A guard that trips on its own documentation is a guard nobody keeps.**
  Strip comments before matching source.
- **Read the deployed artifact, not the migration file.** Migrations are a
  history, not a state. A gate that looks open in `0043` was closed in `0061`.
  `pg_get_functiondef` over the live database beats grep every time.

To inspect the database, write `supabase/migrations/9999_zz_probe.sql`
containing a `do $$ ... $$` block ending in `raise exception 'PROBE%', report;`
— the push fails, nothing is recorded, and the report comes back in the error.
Delete the file afterwards. Never leave a probe migration in the tree.

## What the numbers actually are (measured 2026-09-13/14)

- 19 accounts. **6 have ever logged a visit.**
- 66 visits. **5 carry a rating.** 13 are repeats of a place.
- Last 7 days: **1,226 stops detected → 401 qualified → 186 resolved → 11
  visits logged.** Unconfirmed detections are deleted at 48 hours.
- Confirmations all time: 36 confirmed, 68 dismissed, 6 wrong place.
- 4,946 restaurants, 603 neighbourhoods, **0 with any review text**.
- Background location granted by 3 of 9 who saw the prompt.

**Do not quote the "medium band is 36% accurate" figure.** It was computed from
an analytics event that logs the PRE-demotion band while the digest acts on the
POST-demotion one. If you need band accuracy, re-derive it from `confirm_yes` /
`confirm_corrected`, which carry the band actually displayed, and count
`wrong_place` as a capture rather than a refusal.

## Where the leverage probably is

Offered as hypotheses to test, not conclusions to implement. If the evidence
disagrees, follow the evidence and say so.

- **1,226 detections a week become 11 visits.** The discarded 99% is the
  largest untapped signal in the system. An unconfirmed detection is not
  nothing — consider retaining it as weak unlabelled evidence rather than
  deleting it at 48h. Repeat visits are a stronger preference signal than
  ratings and are free.
- **Context is cheap and underused.** Novelty appetite by weekday vs weekend,
  time since the last new place, cuisine variety pressure over recent days,
  revealed travel radius. All derivable from data already held.
- **"Archetypes" (trendy / status-seeking / experience-seeking) are worth
  deriving, not asking.** A starter quiz was built and deleted because it
  classified its own author wrongly. If you pursue this, compute continuous
  axes from behaviour, log them, and do NOT wire them into ranking yet — at 66
  visits you cannot tell whether they mean anything.
- **Attribution.** `dwellFit` now discounts dwell by venue format
  (`lib/passive-confidence.ts`) and it is tuned against exactly one real case.
  More real cases would help; `analytics_events` holds `visit_resolved` with
  accuracy, dwell, candidate count and band.

## What to leave alone

- The digest schedule (9pm, midnight Fri/Sat) was just set deliberately.
- The stretch slot ranks by `finalScore` descending, deliberately.
- `GMAIL_OAUTH_ENABLED` and `FORWARDING_LIVE` are false on purpose.
- The quiz is deleted. Do not reintroduce a questionnaire.

## Working rhythm

Small commits, each one shippable. Full suite green (`npx jest`, currently
1,025 passing) and `npx tsc --noEmit` clean before every commit. Ship with
`./scripts/ota.sh` when a change is user-visible and verified; batch the
riskier ones and say why.

Write commit messages that explain WHY, including what you got wrong on the way.

## Report back

Leave `docs/OVERNIGHT_LOG.md` containing, for each thing you touched: what you
changed, the evidence it was needed, how you verified it, and what you are
unsure about. Rank by what most deserves a human's attention in the morning.

Be honest about dead ends. A night that produced two real fixes and six
paragraphs of "I tried X and it did not hold up" is more useful than a list of
green checkmarks.
