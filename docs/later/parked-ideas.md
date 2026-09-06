# Parked ideas, and what would earn each one back

Things removed or deliberately not built, with the condition that would make
them worth revisiting. Written so a future session does not rediscover them as
new ideas, and does not rebuild them too early.

---

## Top Palates in <city>

**Removed from the Wrapped tab on 2026-09-05** (founder's call). Code kept:
`mobile/lib/area-palates.ts`, `components/PalateExplainer.tsx` and the
`population_*` views from migration 0021 are all still there and still work.
Deleting the block was a UI decision, not a data one.

**Why it came off.** It rendered "TOP PALATES IN PHILADELPHIA · preview" over
a distribution computed from a handful of accounts. `population_total` reports
5 users. A ranked list of a city's palates, drawn from five people, is a claim
the data cannot support, and the word "preview" does not rescue it — it reads
as a real leaderboard with a hedge attached.

**What would earn it back:** roughly **100 classified users in one metro**,
which is the point at which a top-three has more signal than noise, and where
the existing `REAL_DATA_THRESHOLD` in `lib/population-stats.ts` was already
trying to draw the line. Bring it back per city, not globally: show it in
Philadelphia when Philadelphia has the users, and stay silent elsewhere.

**Better version when it returns.** "Top palates" is a fact about strangers.
The same data answers a more interesting question: *where you sit among them*.
"You explore more than 78% of Philadelphia" is the same computation, is about
the reader, and is the shape Spotify and Strava both use.

---

## The isometric hype map

See `docs/HYPE_MAP.md`. v1 (pitched Apple map, heat glows, crowd dots) ships
today; the walking-figures version needs `@shopify/react-native-skia`, which
is a native module and therefore a new binary the founder builds. Earn-back:
the founder wanting a build cycle for something else anyway, so the Skia
addition rides along rather than costing a TestFlight round trip of its own.

---

## Review-mined qualitative tags

Vibe, crowd, occasion and "who goes and why", read out of Google review text.
The classifier prompt for it is already written and has never run: the
`details` action in `places-proxy` that fetches review text has zero callers,
so `review_snippets` is 0 rows across 1,480 restaurants.

**Cost, measured 2026-09-05:** Google Place Details at the tier that includes
reviews and atmosphere attributes is roughly 2 to 2.5 cents per place, and the
model reading it about 0.3 cents. Google is ~90% of the cost, so the lever is
how many places you enrich, not which model.

**The cheap shape when it happens:** never the whole catalogue. Only 350
distinct places have ever been surfaced to any user and only 19 tapped, so a
full sweep would pay for ~1,100 places nobody has seen. Seed the ~200 to 350
that actually get ranked in the live cities (about $6 to $10), then enrich
lazily and capped as places enter someone's top 12.

**Earn-back:** a second city with real weekly usage, or a tester saying the
recommendations do not distinguish two restaurants of the same cuisine — which
is exactly the gap occasion tags close.
