# The hype map

What the founder described: a map on the Feed like Instagram's, Snapchat's or
Find My, drawn 2.5D, with little people crowding the restaurants that have
traffic and the hottest ones lighting up, almost on fire.

Two versions. The first is live. The second needs a build.

## v1 — shipped (`components/HypeMap.tsx`, migration 0095)

On the Feed, above the posts. Apple Maps at a 45° pitch with buildings on,
which is the 2.5D iOS gives away. Twelve places from `place_heat`, each a
glow that breathes on a loop; size and warmth scale with heat, the top place
carries a flame, and the "people" are dots clustered at the marker, one per
recent visit or save, capped at five. Tap a marker or a legend row to open
the place. No native code, no Google call.

**What heat is.** Built only from what is ours and free:

| signal | source | weight |
|---|---|---|
| Palate visits, last 7 days | `visits` (public only) | 30 each |
| Palate visits, last 30 days | `visits` | 8 each |
| saves | `wishlist` | 5 each |
| feed likes on that place | `feed_likes` | 3 each |
| review-count velocity, 30 days | `restaurant_rating_snapshots` | up to 99 |
| baseline | `rating × ln(review count)` | fallback |

The snapshot table is filled nightly at 03:30 UTC from the counts already on
`restaurants` (1,016 rows on the first run). It only moves when
`places-proxy` refreshes a row, so velocity is a signal that grows over
weeks, not one that exists today.

**What heat is not.** With 14 accounts and five visits this week, "hot" is
not something the data can say. So `place_heat` reports a `regime` and the
card's headline follows it:

- `palate` — "Where Palate is eating." Someone here has been. Real.
- `velocity` — "Picking up steam." Google review counts climbing.
- `baseline` — "Popular near you." Nobody on Palate lately; the crowd's
  picks. This is what most cities will show until the beta grows, and it
  must never be labelled trending.

Heat is normalised within the returned set so the top marker is always 100
and the map has something to light.

**Social APIs are out, and not for lack of trying.** Instagram's Graph API
returns your own business account's media plus a hashtag search capped at 30
hashtags a week with no location aggregation; TikTok's Research API is
academic-access only; Facebook does not expose place check-ins. Scraping any
of them breaks their terms and risks the App Store account.

## v2 — the isometric one (needs a build)

The picture in the founder's head is not a map with markers; it is a little
city. That means drawing it ourselves:

- `@shopify/react-native-skia` for the canvas — isometric blocks for the
  buildings, a warm radial gradient under each hot place, particle sprites
  for the flame on the top one
- figures that walk: a handful of 2-frame sprites per place, count from
  `palate_visits_30d + saves`, wandering on a Reanimated shared value so they
  drift rather than sit
- the block grid comes from the same `place_heat` rows projected onto an
  isometric plane; no map tiles, no Apple Maps, so it looks like a game
  board instead of a map
- tap a block to open the place; pinch to zoom the board

**Cost:** Skia is free. Nothing here calls Google. Per view it costs what
v1 costs, one RPC.

**Why it needs a build:** Skia is a native module. That is a new binary,
`version` bumped to 0.1.9 so it gets its own runtime, and `eas build` run
by the founder. Do not add the package to `package.json` until that build is
the plan, or every OTA to 0.1.8 breaks on import.

**Ship plan:**
1. `npx expo install @shopify/react-native-skia`, bump `version` to 0.1.9
2. `components/HypeBoard.tsx` behind a feature flag `hype_board`, default
   off, so the build can go to TestFlight with v1 still showing
3. build, TestFlight, founder flips the flag from Admin
4. OTAs to 0.1.9 from then on; 0.1.8 keeps v1
