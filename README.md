# Palate

> See what you actually eat.

This repo contains everything for the Palate MVP:

- `landing/` — Next.js landing page (deploys to Vercel)
- `mobile/` — React Native + Expo mobile app (iOS first)
- `supabase/` — Database schema, Row Level Security policies, and the Places API proxy edge function
- `SETUP.md` — **Start here.** Step-by-step setup for a non-technical founder. Read this first.

## Tech stack

| Piece | Tech |
|---|---|
| Mobile app | React Native + Expo + Expo Router |
| Landing page | Next.js 14 (App Router) + Tailwind |
| Auth + DB + Storage | Supabase |
| Restaurant data | Google Places API (proxied via Supabase Edge Function) |
| Hosting | Vercel (landing), Expo / TestFlight (app) |

## Build philosophy

This is an MVP. The order of priorities is:

1. **The core loop works:** sign in → onboarding → at a restaurant → "Did you eat here?" → saved visit → Wrapped at end of week.
2. **Foreground detection only** in v1. Background location is real, but it's the riskiest, slowest, App-Store-touchiest piece. We add it in v1.1 once you have real users.
3. **Manual add is a first-class citizen.** Even with perfect background detection, users will want to log past meals.
4. **iOS only at launch.** Expo means Android is a flag flip away when you're ready.

Read `SETUP.md` next.
