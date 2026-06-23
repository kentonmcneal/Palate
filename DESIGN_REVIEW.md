# Palate — Design, Color & UX Review

*Grounded in the actual theme tokens (`mobile/theme.ts`, `mobile/lib/theme/palateTheme.ts`) and the shipped screens.*

---

## The headline finding: you have two design systems, and they disagree

There are two parallel token files, and they define the *same* brand primitives with *different* values:

| Token | `theme.ts` (diary/discovery) | `palateTheme.ts` (Wrapped/identity) |
|---|---|---|
| Brand red | `#FF3008` | `#FF2D16` |
| Background | `#FFFFFF` pure white | `#FAF7F4` warm white |
| Light neutral | `#F6F6F6` cool gray | `#F4F1EF` warm gray |
| Mid gray | `#6B6B6B` cool | `#77706C` warm |
| Border | `#EAEAEA` cool | `#E7E2DF` warm |

The comment in `palateTheme.ts` even says "don't try to merge the two." The result is that **Palate looks like two different apps stitched together**: the Home/Discover/diary surfaces are cool, clinical, pure-white with a bright safety-red; the Wrapped/identity surfaces are warm, premium, wine-and-oxblood. A user crossing from Discover into Wrapped feels a subtle brand whiplash — the white shifts temperature, the red shifts hue, the grays shift undertone.

This is the single highest-leverage aesthetic fix: **unify on one system.** And the warm, wine-forward identity system is the better spine — it's distinctive and delivers the "behavioral luxury" positioning. The cool utility system is generic.

---

## Color

**The bright red is your weakest brand asset.** `#FF3008` is, to the pixel, essentially **DoorDash red**. For an app trying to *own* a category and feel like a destination, launching on the most recognizable food-delivery red works against you — it reads as "another food utility," not a new place people go. Worse, red is used as the *only* accent: CTAs, match badges, streak chips, active tabs, section accents, "View all" links. When everything is red, nothing is — the color stops signaling importance.

Recommendations:

1. **Demote bright red to an accent, promote wine/oxblood to the brand spine.** Your `palateGradients` (wine → oxblood → near-black) are genuinely distinctive and premium. Make *that* the signature, with the ember red reserved for one thing: the single most important action/score on a screen.
2. **Shift the red off DoorDash.** Even a small hue move toward crimson/vermilion (or a deeper ember) buys distinctiveness for free.
3. **Adopt the warm white (`#FAF7F4`) everywhere.** Pure `#FFFFFF` reads clinical; warm white reads hospitality. This one swap warms the entire app.
4. **Add a small secondary palette** for cuisine categories and data viz. Right now charts, category shelves ("Top 10 Burgers"), and cuisine tags have no color language — they're all mono. A restrained 4–6 hue set (earth/spice tones, on-brand) makes the discovery surfaces legible and ownable.
5. **Accessibility:** `#FF3008` text on white is ~3.4:1 contrast — below WCAG AA (4.5:1) for body/small text. You use it for small accent text ("View all", links). Either darken it for text use or restrict red to fills-with-white-text (which is fine).

---

## Typography

You use **Inter** for everything (`theme.ts` `fonts`). Inter is clean, modern, and *the* default startup typeface — which is the problem. `palateType` aspires to "bold, editorial, premium," but rendering that in system-weight Inter delivers competent, not distinctive. Spotify Wrapped, Letterboxd, and the boutique-hospitality references you're invoking all lean on *characterful* display type.

Recommendations:

1. **Introduce one distinctive display face** for identity words and headlines (the 56–72px "Forager" hero, Wrapped titles, big section heads). A high-contrast serif or a characterful grotesk here would do more for "premium editorial" than any other single change. Keep Inter for body/UI — that pairing (distinctive display + neutral body) is exactly the editorial formula.
2. **Ease off the uppercase eyebrows.** The `micro` style (uppercase, letter-spaced, on nearly every card) is a 2018 SaaS tic. Used everywhere it flattens hierarchy and dates the look. Reserve it; let sentence-case subheads carry more.

---

## Layout & UX

**Strengths (keep these):** a coherent 4px spacing scale and radius scale shared across both systems; restrained, uncluttered screens; strong use of dark hero cards (the `#111` restaurant hero, the wine Wrapped hero) for contrast and focus; genuinely premium Wrapped/share surfaces; clear tap targets and good empty-state copy.

**The big gap: there's almost no food photography.** Nearly every surface is a bordered, rounded card of *text* on faint/white — a "list of boxes" rhythm that gets monotonous and, more importantly, is the wrong medium for restaurant discovery. People decide where to eat with their eyes. TikTok wins food discovery on *imagery and motion*. Discover is text-forward (name · cuisine · neighborhood · rating); the map is pins; even restaurant detail leads with a text hero, not a photo. This is both an aesthetic and a strategic gap (it ties directly to the "media-forward discovery feed" in the product strategy review).

Recommendations:

1. **Make photography a first-class surface element.** Restaurant cards and detail should lead with imagery; Discover should have at least one large, visual, edge-to-edge browsing surface. You already capture `photo_url` on visits — that's a content supply you're not displaying.
2. **Break the card monotony.** Vary rhythm: full-bleed hero imagery, a horizontal media rail, then compact list rows — instead of an unbroken column of equal bordered boxes.
3. **Replace emoji-as-iconography over time.** 🔥 streaks, ✦ confetti, and food emojis are warm but read as low-fidelity next to the premium Wrapped surfaces. A small custom icon set would lift perceived quality.
4. **Let the red badge mean one thing.** Today match-score badges, CTAs, and chips are all red; the compatibility score — your core differentiator — should own the accent, while secondary actions go neutral/ghost.

---

## Priority order

1. **Unify the two theme systems** onto one warm, wine-forward spine (highest leverage, removes the "two apps" feel).
2. **Re-balance red** → accent only, shifted off DoorDash red; warm-white backgrounds everywhere.
3. **Add food photography** as a first-class element on Discover and restaurant detail.
4. **Introduce a distinctive display typeface** for identity/headlines.
5. **Add a secondary palette** for cuisine/data-viz, and fix red-on-white text contrast.

*None of these require new infrastructure — they're token consolidation, a font addition, and surfacing imagery you already collect. The foundation (spacing, radius, component patterns, motion timings) is already solid and coherent; the work is unifying the color/type language and making the discovery surfaces visual.*
