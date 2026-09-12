# Palate: from here to end state

Written 2026-09-12. Every number below was measured against the live system.

**End state, in the founder's words:** the ultimate food recommendation and
tracking app, one that tracks patterns, whose data is eventually extremely
sellable, that is addictive and a first choice, with a feedback loop.

Four capabilities sit under that, and they have a strict order. Tracking
accuracy is the foundation: pattern data built on wrong visits is wrong data,
recommendations built on wrong patterns are wrong recommendations, and data
nobody trusts is not sellable at any price. **Everything below is ordered by
that dependency, not by effort.**

---

## Where we actually are

| | measured |
|---|---|
| Accounts | 16, of which 6 active in 30 days |
| Visits | 57, **2 rated** |
| Detections, last 7 days | **987** → 324 qualified → 270 resolved → **7 logged** |
| Most-resolved place | **Momoya Chelsea, 24 times in one week** |
| Catalogue | 3,859 places, up from 1,720 in five days |
| Decision events, all time | 21 clicks, 1 save, 3 dismissals, 0 directions |
| Missing `occasion_tags` | 45% of recommendable places |
| Missing `flavor_tags` | 46% |

Two numbers explain most of the founder's complaints. **987 detections
producing 7 logged visits** is a 0.7% yield — the prompt is mostly noise. And
**one place resolved 24 times in a week** is not a restaurant problem, it is a
suppression problem: home/work suppression learns from overnight clusters and
only knows Memphis, so a week in New York turns it off entirely.

---

## Phase 1 — Tracking accuracy. Nothing else counts until this works.

Target: **90% of prompts are a place the person actually ate**, and the
detection rate for real meals does not fall.

### 1.1 Travel-aware suppression — FREE, biggest single win
Home/work suppression is learned from overnight clusters in one place. Travel
disables it silently, which is exactly when detection volume explodes. Detect
"no known cluster within N km" as its own mode and raise the bar in it: longer
minimum dwell, tighter accuracy, and suppress a venue already resolved today.
**This alone should remove most of 987.**

### 1.2 Learn from "No" — FREE, and the missing half of the loop
Today a "No, I wasn't there" writes `prompt_decisions` and suppresses that
place for six hours. It teaches the resolver nothing. It should: a rejection at
a location must permanently down-weight that venue *at that location*, so the
Panda Express you can see from inside Walmart stops being offered. This is the
feedback loop the founder is asking for, and it does not exist yet.

### 1.3 Dwell shape, not just duration — FREE
A drive-through and a sit-down meal are both "8 minutes". Arrival and departure
patterns differ, and the raw fixes are already on the device. Use the shape.
The airport run produced prompts because stop-and-go traffic looks like a stop.

### 1.4 Resolution confidence should gate the prompt — FREE
`confidence` is already computed per resolution (0.54 on a recent one, banded
low/medium/high) and is not used to decide whether to ask. Ask confidently when
confident; stay silent when not; batch the uncertain ones into the digest
rather than interrupting.

### 1.5 Radius is a trade, not a bug — needs a decision
75m is what reaches the Panda Express. Dropping to 40m removes that class of
error and will also miss real meals in dense blocks. **Do this last**, after
1.1–1.4, and measure the miss rate before and after rather than guessing.

---

## Phase 2 — Personalisation depth. The "American but not fried" problem.

The ranker knows `cuisine_type`. It does not know preparation, richness, or
format beyond a coarse class — so "I eat a lot of American but not much fried
food" is a distinction it cannot currently represent.

### 2.1 Backfill the qualitative fields — PAID, a few dollars, needs approval
`flavor_tags`, `occasion_tags` and `vibe` are the fields that carry this, and
they are empty on nearly half the catalogue. The classifier that fills them is
built, the eval to measure it is built, and the cost is measurable before
committing. **This is the single change that makes "not fried" expressible.**

### 2.2 Score on those tags — FREE, follows 2.1
The taste graph already has `flavors` as a dimension and almost nothing to put
in it. Once the tags exist, the existing machinery uses them.

### 2.3 Ratings are the other half — FREE, already shipped, needs use
53 of 57 visits are unrated. With two ratings the cuisine cross-learning term
is mathematically dead. The backlog card exists; the number to watch is whether
it moves.

---

## Phase 3 — Should we recommend places people have not been?

Currently Home hides places visited 3+ times and Discover hides all visited
places. The founder is right to question it, and the honest answer is that
**the data cannot settle it yet**: 21 clicks and 1 save in the app's history.

What is knowable: this founder's own repeat rate is 20%, and 6 of 6 visits last
week were somewhere new. One person is not a distribution.

**Proposal:** make it a measured question rather than an argument. The slate
logging shipped last week records what was shown and what was chosen; add a
"somewhere you loved" row to Home, and let `rec_funnel_weekly` say whether
people take it. A returning favourite is also the strongest possible
recommendation when confidence elsewhere is low.

---

## Phase 4 — Addictive, and first choice

Ordered by how much each depends on Phases 1–2 being true.

- **Wrapped** is the viral artifact and already exists. Weekly, shareable,
  improves as the data improves. Nothing else has that property.
- **The daily question** — "where should I eat tonight" answered in one tap —
  is the habit. It only works when Phase 1 is done, because a person who has
  been asked 141 times a week about places they did not eat will not open it.
- **Streaks and nags are not the answer here** and were deliberately removed.
  The pull is the app being right.

---

## Phase 5 — Sellable data

The asset is not "restaurant reviews". It is **verified visits**: who actually
walked in, captured passively, with no self-reporting bias. Nobody else has it.

`visits_7d` in `rec_funnel_weekly` already proves a recommendation led to a
real visit within seven days. That is the number a restaurant pays for, and the
number an aggregate-insights buyer pays for.

Two conditions before any of it is sellable, and both are engineering:
1. **Accuracy** — Phase 1. Attribution built on wrong visits is fraud, not data.
2. **A promoted flag on the slate** — one field, must exist before the first
   paid placement, or the feedback loop learns that people like whoever paid.

Aggregate only, never individual. The privacy posture is currently good: RLS on
all 39 tables, raw location never leaves the device until a visit is confirmed.
That is worth protecting deliberately, because it is also the thing that makes
the data defensible to sell.

---

## What is blocked on the founder

| | |
|---|---|
| Sign in with Apple | 3 account steps, then a build. Guideline 4.8 — a rejection, not a risk. |
| Gmail | One tap. The 502 now reports which of four causes it is. |
| `palate.app` DNS | 5 minutes. Every shared Wrapped currently points nowhere. |
| Backups | 2 GitHub secrets. |
| Crash alerts | 1 Supabase secret + 1 URL. |
| Classifier backfill | Approval to spend a few dollars. |
| Radius change (1.5) | A product decision about the trade. |

---

## The order, in one line each

1. Travel-aware suppression — free, removes most of the 987
2. Learn from "No" — free, the loop that does not exist
3. Dwell shape — free, kills the airport class
4. Confidence gates the prompt — free, already computed
5. Classifier backfill — a few dollars, makes "not fried" expressible
6. Score on the new tags — free, machinery already there
7. Radius, measured — after 1–4, not before
8. Familiar-places row, measured — settles Phase 3 with data
9. Promoted flag — before any money changes hands
