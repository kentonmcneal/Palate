# Palate Persona Engine — test cases

These are the canonical scenarios from the product spec. They're written as
"given these visits this week, expect this persona" so anyone can verify
behavior by hand or wire them up to a test runner later.

The engine = `generateWeeklyPalatePersona(weekStart, weekEnd)` from
`mobile/lib/palate-persona.ts`. Restaurant signals come from
`deriveRestaurantProfile()` in `mobile/lib/restaurant-profile.ts`.

---

## Test 1 — McDonald's × 3 (Convenience Loyalist)

**Setup:** Three visits to McDonald's (any day), no other visits.

**Brand profile:**
- decisionIntent: `no_friction`
- flavorSignature: "salty, highly consistent, engineered fast food"
- format: quick_service · brandTier: value

**Expected persona:** `convenience_loyalist`

**Expected output:**
```
label: "The Convenience Loyalist"
tagline: "Speed and familiarity, no thinking required."
description: "You leaned into consistency and convenience. You chose
  McDonald's 3 times this week — that wasn't random. Salty, highly
  consistent, engineered fast food. You optimized for friction, and
  there is nothing wrong with that."
evidence:
  - 3 visits to McDonald's
  - High repeat rate
  - Mostly no friction choices
  - Dominant flavor: salty
recommendationStrategy: "convenience"
confidence: ~0.8
```

---

## Test 2 — Burger King × 3 (Flavor Loyalist, NOT Convenience)

**Setup:** Three visits to Burger King.

**Brand profile:**
- decisionIntent: `preference_driven` ← *the key difference vs McDonald's*
- flavorSignature: "smoky, flame-grilled, heavier fast food"

**Expected persona:** `flavor_loyalist`

**Expected output:**
```
label: "The Flavor Loyalist"
tagline: "You know what you want, and you go get it."
description: "You showed a preference for smoky, flame-grilled, heavier
  fast food. 3 visits to Burger King this week — this wasn't convenience,
  you had a specific craving and you fed it."
evidence:
  - 3 visits to Burger King
  - High repeat rate
  - Mostly preference driven choices
  - Dominant flavor: smoky
recommendationStrategy: "flavor_loyal"
confidence: ~0.8
```

This validates the critical distinction: **identical visit counts to
two value-tier burger chains produce different personas** because
their decisionIntent differs. McDonald's = no_friction. Burger King =
preference_driven (you went out of your way for the flame-grilled).

---

## Test 3 — Sweetgreen + Panda Express + McDonald's (Practical Variety Seeker)

**Setup:** One visit each to Sweetgreen, Panda Express, McDonald's.

**Brand profiles:**
| Restaurant     | intent              | health  | behavior tags                     |
|----------------|---------------------|---------|-----------------------------------|
| Sweetgreen     | intentional         | high    | healthy_leaning, elevated         |
| Panda Express  | no_friction         | low     | convenient, indulgent             |
| McDonald's     | no_friction         | low     | convenient, routine, budget       |

The week stacks **healthy + indulgent + convenient** signals, which is the
match condition for `practical_variety_seeker`.

**Expected persona:** `practical_variety_seeker`

**Expected output:**
```
label: "The Practical Variety Seeker"
tagline: "You eat a little bit of everything — on purpose."
description: "You balanced the week: bright and fresh on one day,
  indulgent on another, fast and easy when you needed it — moving
  between Sweetgreen. You're choosing different modes on purpose."
evidence:
  - High variety
  - Mostly no friction choices  (since 2/3 visits are no_friction)
  - Mix of healthy and comfort choices
  - Dominant flavor: salty       (2 of 3 brands lean salty)
recommendationStrategy: "balanced"
confidence: ~0.55
```

---

## Other personas worth knowing

| Trigger | Persona |
|---|---|
| ≥3 visits to a premium_fast_casual chain (Sweetgreen, Cava) | Premium Comfort Loyalist |
| ≥60% high health signal across 3+ visits | Healthy Optimizer |
| ≥5 unique restaurants, ≤20% repeat rate | The Explorer |
| ≥50% café format visits | The Café Dweller |
| Bar visit OR ≥2 social-tagged | The Social Diner |
| Default fallback | The Comfort Food Connoisseur |

---

## How to run these manually

There's no Jest harness wired up yet. To validate by hand:

1. Run the app in Expo Go (`cd mobile && npx expo start`).
2. Sign in, complete onboarding.
3. Use the **+ Add** tab to manually log the visits described in a test.
4. Open the **Wrapped** tab → **Generate now**.
5. Scroll to the "YOUR PALATE THIS WEEK" section.
6. Compare label / tagline / description / evidence against the expected output above.

To wire these up as automated tests later: add Jest + `@testing-library/react-native`,
mock `supabase.from('visits').select(...)` to return canned visit rows, and assert
`generateWeeklyPalatePersona` returns the expected persona key.

---

## How to extend to menu-level data

Right now the engine reads at the **restaurant level**. To go deeper:

1. **Add a `dish_visits` table** keyed `(visit_id, dish_name, category)`.
   Capture from a manual-add UI extension or future POS receipts integration.
2. **Extend `deriveRestaurantProfile`** to accept an optional `dishes` param
   and override `tasteTags` / `flavorSignature` based on what the user actually
   ordered (e.g. "Sweetgreen × 3, but always the spicy bowl" → add `spicy` tag,
   override flavorSignature).
3. **Add a `dishProfile` field to `RestaurantProfile`** for caching the
   inferred per-user dish-level signature.
4. **Add new persona conditions** like:
   - `>=3 spicy dishes this week` → "The Heat Seeker"
   - `>=80% under-700-cal estimate` → "The Macro Optimizer"
5. The persona engine's classifier just needs new entries in `PERSONAS[]` —
   the rest of the pipeline is already structured to handle richer signals.

The cleanest path: don't store derived dish meaning in the DB. Store raw dish
events; let the same client-side logic enrich at read time. Same pattern we
use for restaurant-level signals today (which works because the heavy lift is
heuristics, not ML).
