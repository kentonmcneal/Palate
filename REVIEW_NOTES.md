# Palate — Session Review Notes

Everything changed in this working session, what it does, and what you need to run. Nothing here has been committed or deployed (this environment can't reach your git/Supabase/EAS credentials), so all of it is sitting in your working tree ready for review.

---

## ⚠️ Do this first, before any build

```
cd mobile && npx expo install @expo-google-fonts/fraunces
```

A distinctive display typeface (Fraunces) was wired into the theme and added to `package.json`. The build will fail on a missing-module error until this package is installed. It's the only blocking step.

---

## Run when you're ready (each is one decision)

**Commit everything** — working tree only, nothing staged:
```
rm -f .git/index.lock                 # stale lock from this environment
git add -A
git commit -m "Discover filters, engagement loop, design system unify + red sweep"
```

**Deploy the backend** (P1 classifier + P5 map are in the SAME `places-proxy` function, so they ship together — P5 raises Google Places usage):
```
cd supabase && supabase functions deploy places-proxy
```

**Ship to users** — mobile changes only reach devices via a build/update (both are paid EAS commands; your call):
```
cd mobile && eas update   # or eas build
```

---

## What changed, by area

### Bug fixes (cost-free, safe)
- `mobile/tsconfig.json` — `module: esnext` + `moduleResolution: bundler`; cleared 14 dynamic-import (TS1323) errors.
- `mobile/lib/palate-insights.ts` — fixed a real Supabase join-shape bug (TS2352): the `restaurant` join is typed as an array but was cast to a single object; now normalized.

### Discover / recommendations
- **Exclude lounges, fast food, hotels** (`supabase/functions/_shared/classifier.ts`) — all lounges now hard-excluded (was gated-only); true `fast_food_restaurant` chains excluded; hotels unchanged. New `ineligibility_reason` labels surfaced on the restaurant page. ⚠️ Eligibility is written at ingest, so **existing restaurant rows keep their old value until re-classified** — a backfill is still needed to apply this retroactively (not yet written).
- **Casual / Boutique filter** (`discover.tsx`) — chip row filters all three tabs by format/price without changing match scores.
- **Saves-only mode** (`taste-vector.ts` + `discover.tsx`) — toggle rebuilds the taste vector from saved restaurants only and re-ranks instantly.
- **Find similar** — already existed (button on restaurant page → `/similar/[id]`); no work needed.

### Map (`map.tsx` + `places-proxy`)
- Surfaces fetch errors instead of freezing silently (cost-free, already in code).
- Root-cause fix (⚠️ raises Google Places cost, needs deploy): radius cap 500m→3000m, results 10→20, rate limit corrected from ~5 to 40/min.

### Engagement loop (Tier-1)
- **Re-engagement notifications** (`notifications.ts` + `index.tsx`) — local streak-at-risk nudge at 8pm if not logged; clears on log. Local only, free.
- **Milestone feed events** (`index.tsx` → `feed.ts`) — crossing a streak milestone now posts to the friend feed + push (was dead code), deduped across restarts.
- **Share CTAs** — `FirstVisitCelebration` + milestone now offer share (doubles as invite via referral link).
- **Incentivized invites** (`referrals.ts` + `wrapped.tsx`) — social-comparison copy ("compare palates") + an invite button on Wrapped.
- **Quiz persona → recs** (`persona-prior.ts` + `taste-vector.ts`) — onboarding quiz now seeds the taste vector for cold-start users (<3 visits), so session-one recs are personalized.

### Design system
- **Unified two clashing theme files** (`theme.ts` + `palateTheme.ts`) onto one warm palette — pure white → warm white, cool grays → warm grays, one shared red.
- **De-DoorDash'd the red** — `#FF3008` (pixel-identical to DoorDash) → ember `#E5391C` everywhere, including hardcoded hexes in charts, tints, and constants that had bypassed the token.
- **Accessible red text** — `redText` token (`#B82E12`) clears WCAG AA; applied to red links.
- **Secondary palette** — `categoryColors` for cuisine tags / data viz.
- **Display typeface** — Fraunces for titles/identity, Inter for body/UI.
- **Red overuse sweep** — `primary` role token added; red eyebrows → mute (13 surfaces); leftover `#FFF1EE`/`#FFD7CE` tints → `redTint`/`redTintBorder` tokens (10 files). Red now reserved for: match scores, primary CTAs, identity/persona words, destructive actions, active states.

---

## What to eyeball in a build
1. The warm-white shift across every screen (most visible change).
2. Fraunces titles/identity headlines vs the old Inter.
3. Calmer red on Home (no more competing `+` / streak / "Check now" reds) and the nudge/insight cards.
4. The Casual/Boutique + Saves-only toggles on Discover.
5. Map: pan around and confirm pins keep loading (only true after the `places-proxy` deploy).

---

## Known non-issues
- **~30 Expo Router type errors** (`tsc`) — these are **stale typed-route artifacts**, not real bugs. `app.json` has `typedRoutes: true`; the types regenerate on `expo start`. They predate this session and need no fix.

## Deferred (deliberately not done)
- **Food photography** as a first-class surface — multi-screen redesign *and* uses the paid Google Places Photo API. Needs your go.
- **Collaborative filtering / "people with your palate loved this"** — the Tier-2 data-moat build.
- **Media-forward discovery feed** + **collaborative lists / "send a place"** — the TikTok-displacing surfaces.
- **Classifier backfill** to retroactively apply the new lounge/fast-food exclusions to existing rows.
- See `PRODUCT_STRATEGY.md` and `DESIGN_REVIEW.md` for the full reasoning.
