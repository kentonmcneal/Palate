# Palate — social design

Written 2026-09-02, from tester feedback #9: *"I want to start seeing your
ideas for allowing us to connect and create profiles… things like 'Palate
match' such as Spotify showing you how much your genres overlap. Listing out
top users that you match palates with. And a feature where restaurants are
suggested based on what everyone in a group say 3 friends go out. Best
restaurant for everybody."*

This doc covers the model. Phase 1 is built; Phase 2 is specified and
deliberately not built yet, because it needs server-side work that shouldn't be
rushed into a tester build.

---

## What already exists

Not a greenfield. Before this sprint:

- Friend requests, accept, decline, block, unfriend, leaderboard — `mobile/lib/friends.ts`
- A friend-compatibility screen gated at 5 visits each side — `mobile/app/compatibility/[id].tsx`
- Pair compatibility math returning a **qualitative** verdict — `mobile/lib/palate/pairCompatibility.ts` → `compareProfiles()` gives an axis distance, a type, and a summary sentence
- Restaurant-level compatibility (the "% match" on every card) — `mobile/lib/recommendation/compatibility.ts`
- Taste vectors per user — `mobile/lib/taste-vector.ts`
- A server-side `friend_taste_features` RPC that enforces the friendship check before returning another user's visits

The gap wasn't capability. It was that the pair result had no **number**.

---

## What we're borrowing, and what we're not

**Spotify Blend — the number is the object.** Blend works because one figure
carries the whole idea: *78%*. It is screenshot-shaped. The breakdown underneath
is what makes it believable, but the number is what travels. Our existing pair
model returns a type and a sentence, which is the honest shape of the data and
completely unshareable. So we now compute both and keep them side by side —
`palate-match.ts` produces the number, `pairCompatibility.ts` keeps the nuance.

What we do **not** borrow: Blend's playlist. The equivalent — a merged "you two
should eat here" list — is Phase 2, and it needs the group math below rather
than a naive intersection.

**Strava — the social object is the activity, not the profile.** Strava's loop
is a friend's *run* appearing in a feed, with a reaction on it. The profile is
where you land after you care. Palate already has the activity (a logged visit)
and a feed. The thing worth stealing is **segments**: "you've both been to 6 of
the same places" is our version of a shared segment, and it is a stronger
compatibility signal than any cuisine histogram, because it is behavioural
rather than declared. It is in the score at 15%, deliberately capped because it
is the sparsest signal we have.

What we do **not** borrow: leaderboards as the primary loop. Palate's leaderboard
already exists and should stay a secondary surface — ranking people by visit
count rewards volume, and this app's premise is that *what* you eat is the
identity, not how much.

**Beli — ranked lists as identity.** Their ranked list is the best expression of
"this is who I am, in food" on the market. Their weakness is that ranking is
work: every place has to be placed by hand, forever. Our passive capture
produces the same artifact for free, which is the one structural advantage we
have over them. Pairwise ranked rating stays the #1 post-launch item.

What we do **not** borrow: their onboarding-heavy taste quiz as the source of
truth. Ours comes from behaviour.

---

## Phase 1 — built this sprint

### `computePalateMatch(mine, theirs, { sharedPlaceCount, unionPlaceCount })`

`mobile/lib/recommendation/palate-match.ts`. Pure function, no network, no
React, unit-tested with fixtures — the thing a growth loop depends on shouldn't
only be observable in production.

Weights:

| Signal | Weight | Why |
|---|---|---|
| Cuisine region | 45% | What people *mean* by "we eat the same" |
| Cuisine subregion | 15% | Separates "both like Asian" from "both like Sichuan" |
| Format class | 15% | Dive-bar regular vs tasting-menu regular |
| Price tier | 10% | How you eat, not what — real but secondary |
| Shared places (Jaccard) | 15% | Strongest signal, sparsest data — capped for that reason |

Cosine similarity per axis, weighted composite, then the same `^0.7` shaping the
restaurant match score uses (a linear map makes even a strong pair read
lukewarm). Floored at 20 and capped at 99: never claim two people eat nothing
alike, never claim they are identical.

Returns the number **and** the reasons — shared cuisines, shared place count,
and the single axis where the two of you diverge most. The divergence line is
not a caveat, it's the interesting half: "Mexican is where you split" is what
makes the number feel observed rather than generated.

Below 5 visits either side it returns `ready: false` with what's missing, and
the UI says "4 more visits to unlock" rather than hiding the feature. A locked
thing you can see is a reason to log; a hidden thing is nothing.

### Surfaces

- **Friends list** — a match chip on every row, list sorted by match descending.
  That sort *is* the "top users you match palates with" the tester asked for; it
  needs no separate screen.
- **Friend profile** — the number as a hero, with the reasons underneath.
- **Share card** — two avatars, the number, three shared cuisines. This is the
  growth mechanic and should get real design attention.

---

## Phase 2 — specified, NOT built

### Group recommendations — "best restaurant for everybody"

Select 2–4 friends → rank nearby places against the group.

**The aggregation rule is the whole design question.** Given per-person match
scores for a candidate restaurant:

- **Mean** optimizes the average and reliably picks the blandest option. The
  place nobody objects to is not the place anybody wanted. This is the obvious
  choice and it is wrong.
- **Minimax — maximize the least-happy member's score — is the right default.**
  "Best restaurant for everybody" means nobody has a bad night, which is exactly
  what maximizing the floor produces. It also degrades gracefully: with one
  wildly different palate in the group, minimax finds the genuine common ground
  instead of averaging that person out of existence.
- **Veto pass first.** Any candidate scoring below ~30 for any member is
  removed before ranking, regardless of how it scores for everyone else.
  Allergies and hard dislikes are not a scoring problem.

Show per-person match under the pick — *"Marcus 82 · Dana 74 · You 79"*. The
transparency is the feature: a group pick people can audit is a group pick
people accept. It also makes the app the neutral party in a decision that is
usually social friction.

### Privacy — the blocking prerequisite

**Do not compute this on the client.** Group recs require reading every member's
taste vector, and shipping other users' vectors to a client is a data leak
whatever the UI does with them.

Required before any of Phase 2 ships:

1. A Supabase edge function that takes the caller's JWT and a list of user ids.
2. It verifies an **accepted** friendship between the caller and every id.
3. It computes the group ranking server-side and returns **only** the ranked
   restaurants plus per-person scores — never the vectors.
4. Rate limited: it is a fan-out read across users.

`friend_taste_features` already models the right pattern for one user; this is
that, generalized, with the scoring moved server-side. RLS design work, not an
afternoon.

### Deferred beyond Phase 2

- **Group sessions** ("we're eating together tonight") with live voting. Wait for
  evidence people use static group picks first.
- **Palate match with non-friends** — the "top users you match with" discovery
  case across all users. Interesting, and a privacy question we should not
  answer while the user base is three people who all know each other.

---

## Open questions

1. Does the match number update live, or freeze weekly like Wrapped? Freezing
   makes it an event and shareable; live makes it feel true. Leaning weekly, to
   ride the Sunday Wrapped moment that already exists.
2. Should the share card show both names, or only the score? Both names is more
   personal and leaks a friendship to whoever sees the screenshot.
3. Minimax needs a tiebreak. Distance is the obvious one; "whoever has been
   overruled most recently" is the interesting one and requires history we
   aren't keeping yet.
