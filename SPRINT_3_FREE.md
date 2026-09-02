# Palate — Sprint 3: everything that costs nothing (autonomous brief)

**Paste this as the opening prompt of a Claude Code session opened from
`~/Claude Code/Palate`.**

Every workstream here has **$0 marginal API spend**. Read `SESSION_PROMPT.md`
first for the repo boundary, the peer check, and the permission split — this
document is scope, not process.

---

## 0. The number that should reorder your priorities

Before picking anything up, run this:

```sql
select detection_source, count(*) n, count(distinct user_id) users
  from public.visits group by 1;
```

As of 2026-09-02 it returns:

| source | visits | users |
|---|---|---|
| manual | 31 | **2** |
| auto | 16 | **1** |

**13 accounts. Two have ever logged a visit. One has ever had passive capture
produce one.** Passive capture — the product's whole differentiator, the thing
three sprints of engineering went into — is working for exactly one person, and
that person is the founder.

Everything downstream is starved by this. Palate Match needs 5+ visits on both
sides, so essentially no pair qualifies. Wrapped needs visits. The People
directory lists accounts with no data behind them. Recommendations have no taste
graph to rank against.

**So: activation outranks features.** W1 and W2 below are the two that address
it. Do them first, and treat the rest as what to build once people are actually
using the thing.

---

## W1 — Photos, taken by users (do this first)

The app looks like a list of text because it is one, and the fix everyone
reaches for — the Google Places Photo API — bills per request and therefore
scales with impressions. That is the wrong cost shape for a feed, and it is why
`PlaceArt` currently draws a cuisine-coloured gradient instead.

**The honest version is already 80% built and nobody noticed.**
`visits.photo_url` exists. The `visit-photos` bucket exists and is public. The
upload function is in `lib/visits.ts:314`. `photos.tsx` renders a grid and
`all-visits.tsx` renders thumbnails.

**0 of 47 visits have a photo**, because capture is buried on the visit-detail
screen where nobody finds it.

1. **Ask at the moment of logging.** After a visit is confirmed — the passive
   confirm flow and the manual add flow both — offer a camera/library step while
   the food is still in front of the person. One tap to skip; never a blocker.
2. **Make `PlaceArt` prefer a real photo.** If any visit to that place (the
   viewer's own first, then any public one) has a `photo_url`, render it in the
   art slot and keep the gradient as the fallback. The component is already the
   single place every card gets its art from, so this lights up Discover, the
   place-detail hero, and anything added later, in one change.
3. **Cost check:** Supabase storage on the current plan, no external API. Resize
   before upload (an unresized iPhone photo is ~5MB and the free bucket is not).

This is how Beli is photo-forward. Not licensed photography — its users'
photos.

---

## W2 — Activation: get the other eleven people to log anything

Two users out of thirteen is not a content problem, it is a first-run problem.

- **Instrument the passive-capture funnel end to end.** The pieces exist
  (`passive-misses.ts`, the debug screen, `confirm_notif_suppressed` events).
  What is missing is a per-user view of where people fall out: never opted in,
  opted in but no detections, detections but no prompts, prompts but no
  confirms. Until that exists, "passive capture works for one person" is a fact
  with no diagnosis attached.
- **The three-gate opt-in is where to look first.** Anyone who did not complete
  it never had a chance to log automatically.
- **Make the empty state do work.** A Home tab with no visits should be teaching
  the one action that unblocks everything, not showing empty recommendation
  cards.
- **Do not add a fourth permission prompt.** The problem is unlikely to be that
  we asked too little.

---

## W3 — Pairwise ranked rating

Your own strategy docs call this the #1 post-launch item, and it is the one
place Palate has a structural advantage over Beli: their ranked list is the best
food-identity artifact on the market, and it costs their users manual work
forever. Passive capture produces the same artifact for free.

- After a visit, occasionally ask **one** comparison: "Better than {a place they
  have already rated}?" One question, never a queue.
- Maintain the ranking from pairwise results — Elo or merge-insertion.
- Surface as an ordered list on the profile. This becomes the Wrapped
  centrepiece and the thing people screenshot.
- Pure DB and client. No external calls.

---

## W4 — The shareable match card

`computePalateMatch()` already produces the number and the reasons. What is
missing is a card good enough that someone posts it: two avatars, the big
number, three shared cuisines, one divergence line.

Reuse the `SharePalateCard` / `VisitShareCard` pattern — and note they are
`ViewShot` canvases, so text there uses `CanvasText` and must not scale. This is
the cheapest user acquisition available and it is design work, not engineering.

---

## W5 — Profile depth and directory filters

All computable from data already stored:

- Visit history and top places on a profile.
- "You've both been to 6 of the same places" — the Strava-segment equivalent,
  and the strongest compatibility signal we have.
- Filters on the People directory by school and city, now that those fields
  exist (migration 0056).

---

## W6 — Small debts, now worth paying

- **Feed posts don't link to places.** `top_restaurant` is a bare name string
  produced by the `generate_weekly_wrapped` SQL function. Thread a
  `google_place_id` through that function, the feed payload, and the renderer so
  the name opens `/restaurant/[place_id]` like everywhere else.
- **Batch the People/friends match RPC.** One round trip per person is fine at
  13 users and wasteful at 50. One RPC taking an array of ids.
- **Wrapped depth** — more cards from data already collected.

---

## W7 — Group recommendations (now mostly free)

Previously scoped as costing money because ranking needs nearby candidates from
Google. **The read-through cache deployed on 2026-09-02 changes that**: a group
session in an area someone has already browsed serves from `restaurants` and
costs nothing. Cold areas still cost one call.

Still blocked on the server side, and that part is not optional: computing this
on the client means shipping other users' taste vectors to a device. Build the
edge function described in `SOCIAL_DESIGN.md` — caller's JWT, friendship check
per member, returns only ranked restaurants plus per-person scores, never
vectors.

**Aggregate by MINIMAX, not mean.** Averaging taste vectors reliably picks the
blandest option; "best restaurant for everybody" means nobody has a bad night,
which is maximising the floor. Veto pass first: drop anything scoring below ~30
for any member before ranking. Show per-person scores under the pick — the
transparency is the feature.

---

## Not in scope — these cost money

- **Google Places photos.** Per-impression billing. W1 is the free answer.
- **Widening any search radius**, raising `GOOGLE_DAILY_CALL_CAP`, or removing a
  rate limit. If a fix seems to need more paid calls, write up the finding and
  stop.
- **Expanding the LLM classifier** beyond current usage.

---

## Definition of done

- `npx tsc --noEmit` clean, `npm test` green, no regression below **168 tests**.
- New tests for any pure logic (the ranking math in W3 especially — it fails
  silently and invisibly if wrong).
- `SPRINT_LOG.md` updated, including anything deferred and anything you could
  not verify.
- Migrations written, `--dry-run` checked, then applied. Next number: **0060**.
- Report what you could **not** verify — particularly anything needing a
  physical device — rather than implying it works.

---

## Appendix — who is actually on this thing (2026-09-02)

`analytics_events` is the closest thing to a "last opened" signal; there is no
`last_seen_at` on profiles. Adding one is trivial and free (W2 should do it —
one column, written on app foreground) but the events table already answers the
question today:

```sql
select coalesce(p.display_name, split_part(p.email,'@',1)) as who,
       p.created_at::date as joined,
       (select max(created_at)::date from public.analytics_events e where e.user_id=p.id) as last_seen,
       (select count(*) from public.visits v where v.user_id=p.id) as visits,
       (p.push_token is not null) as has_push
  from public.profiles p
 order by last_seen desc nulls last;
```

| metric | value |
|---|---|
| accounts | 13 |
| active in last 24h | 3 |
| active in last 7d | **3** |
| dormant 14d+ | **9** |
| have ever logged a visit | **2** |
| have a push token | 6 |

Three of thirteen have opened the app in the last week, and nine have been gone
for two weeks or more. Only two have ever logged anything, and one of those is
the founder with 29 of the 47 visits.

This is the context for every decision in this document. The product does not
have a feature gap so much as it has never been used. Build W1 and W2, get a
build into people's hands, and re-run the query before deciding what is next.
