# App Store launch prep — Palate

Drop-in copy + answers for every App Store Connect field. Open this side-by-side
with App Store Connect when you fill in the listing.

---

## 1. App Information

| Field | Value |
|---|---|
| **App name** | `Palate` |
| **Subtitle** (30 chars max) | `See what you actually eat.` |
| **Bundle ID** | `app.palate.ios` |
| **SKU** (your internal ref) | `PALATE001` |
| **Primary language** | English (U.S.) |
| **Category — Primary** | Food & Drink |
| **Category — Secondary** | Lifestyle |
| **Content Rights** | I have / acquired all rights |

---

## 2. Pricing & Availability

| Field | Value |
|---|---|
| **Price** | Free |
| **Availability** | All territories |
| **Pre-order** | Off |

---

## 3. App Privacy (the big one — "Privacy Nutrition Label")

App Store Connect → **App Privacy** → **Get Started**.

### Data Types You Collect

For each, mark "Yes, we collect this data" and answer follow-ups:

#### 1. Email Address
- **Used for app functionality** ✅
- **Linked to user identity** ✅
- **Used for tracking** ❌ NO
- **Why**: Account creation + login

#### 2. Coarse Location
- **Used for app functionality** ✅
- **Linked to user identity** ✅
- **Used for tracking** ❌ NO
- **Why**: Detecting which restaurant you're near

#### 3. Precise Location
- **Used for app functionality** ✅
- **Linked to user identity** ✅
- **Used for tracking** ❌ NO
- **Why**: Restaurant detection. Collected while the app is open, and — only
  for users who explicitly opt in and grant "Always" — in the background, to
  detect that they stopped at a restaurant and ask them to confirm the visit.
  Background detection is OFF by default and can be turned off at any time in
  Settings. No continuous location trail is recorded: iOS reports discrete
  stops (Apple's visit-detection service), and stops are filtered on-device
  (dwell 20 min–4 hr, accuracy threshold, home/work suppression) before any
  coordinate is transmitted.

#### 4. User Content (notes on visits)
- **Used for app functionality** ✅
- **Linked to user identity** ✅
- **Used for tracking** ❌ NO

#### 5. Other Diagnostic Data (analytics events)
- **Used for analytics** ✅
- **Linked to user identity** ❌ (we anonymize)
- **Used for tracking** ❌ NO

### Data Types You DO NOT Collect
- Contact info (other than email)
- Health & Fitness
- Financial info
- Photos / videos
- Audio
- Browsing history
- Search history
- Identifiers (advertising ID etc.)
- Purchases
- Sensitive info (race, religion, sexuality, etc.)

### Tracking
- **Does your app or third-party SDKs use data for tracking purposes?** → **NO**
  (You don't run ads. You don't sell data. You don't share with data brokers.)

---

## 4. App Store Description

Paste this verbatim into the **Description** field (4,000 char limit).

```
Palate quietly notices when you eat out — and turns your week into a beautiful, shareable Wrapped.

One tap when you arrive at a restaurant. Every Sunday, get a personality reveal: are you The Loyalist, The Explorer, The Café Dweller, The Comfort Connoisseur, or The Fast Casual Regular?

WHAT MAKES PALATE DIFFERENT

Other apps measure your opinions. Palate measures your patterns.

· No reviews to write
· No followers to grow
· No public feed to scroll
· Just a quiet record of where you actually went

WEEKLY WRAPPED

Every Sunday morning, Palate generates a Wrapped of your week — your top spots, your dominant cuisine, your dining personality. Share it with friends or keep it for yourself.

PRIVACY-FIRST

· No ads, ever
· We never sell your data
· No public profile, no friend requests
· Pause tracking anytime, delete everything in two taps
· Restaurants don't see your name or email

HOW IT WORKS

1. Tap "Check now" when you arrive somewhere food is served
2. Confirm the spot — Palate uses Google Places to find what's nearby
3. Your week builds into a Wrapped that lands every Sunday morning

WHY PALATE EXISTS

Most people radically underestimate where their money, time, and attention actually go. McDonald's counts. Coffee counts. The fancy place counts. All of it. Palate shows you the truth — privately, with no judgment, just clarity.

Free during beta. Always a free tier.

Built by Kenton McNeal — Wharton MBA '26, Memphis-raised.
```

---

## 5. Promotional Text (170 chars, can be updated without app review)

```
Free during beta · iOS first · Three taps and you'll see what your real eating week looks like — privately, with no judgment, just clarity.
```

---

## 6. Keywords (100 chars max, comma-separated)

Optimize for discovery — pick terms users actually search:

```
food tracker,restaurant log,wrapped,dining diary,food journal,personality,foodie,palate,visits,memories
```

(95 characters, room to swap if you find something better.)

---

## 7. Support URL & Marketing URL

| Field | Value |
|---|---|
| **Support URL** (required) | `https://palate.app/about` (or `mailto:hello@palate.app` while site is bare) |
| **Marketing URL** (optional) | `https://palate.app` |
| **Privacy Policy URL** (required) | `https://palate.app/privacy` |

---

## 8. App Review Information

| Field | Value |
|---|---|
| **First name** | Kenton |
| **Last name** | McNeal |
| **Phone number** | (your real number) |
| **Email** | hello@palate.app (or your personal until forwarding is set up) |
| **Demo account username** | (Apple may require this — see note below) |
| **Demo account password** | (see note below) |
| **Notes for the reviewer** | See template below |

### Notes for the Reviewer (paste into the field)

```
Hi Apple Review Team,

Palate is a privacy-first food-logging app. Sign in is via 6-digit
email code (no password). To test:

1. Tap "Send code" with any email — code arrives within 10 seconds.
2. Walk through onboarding (welcome → why-location → permission → privacy → taste preferences).
3. The Home tab has a "Check now" button that uses location to find nearby restaurants.
4. The "+ Add" tab lets you search and log a visit manually if you'd prefer to test indoors.
5. The Wrapped tab generates a weekly summary after at least one visit is logged.
6. Settings → Delete account fully removes the test account and all visits.

Location use: foreground location powers the "Check now" flow above.

This build also includes OPTIONAL background visit logging, which is OFF by
default. To review it: Settings -> Passive tracking -> "Log visits in the
background". That runs an explanation screen first, then requests "Always"
location access. When enabled, the app uses Apple's visit-detection service
(CLVisit) to learn that the user stopped somewhere; stops are filtered on the
device (20 min-4 hr dwell, accuracy threshold, and home/work suppression)
before any coordinate is sent to our server to identify the restaurant. The
user then gets a notification asking whether they ate there, and NOTHING is
saved to their diary unless they confirm it. It can be switched off at any
time in the same place, and the feature is additionally behind a
server-side flag we can disable remotely.

The app does not sell or share location data, and does not use it for
tracking or advertising.

Thanks!
— Kenton
```

### About the demo account
Apple usually wants a working test account so they don't have to receive
your magic-link email. Easiest path: create a throwaway like
`apple-review@palate.app` (if your email forwarding accepts wildcards) OR
add a hardcoded review-only login bypass in the next build (skip for v1).
For first review, leaving the demo fields blank with the note above is
usually fine for email-OTP apps.

---

## 9. Version Information ("What's New")

For the **first release**, leave it short:

```
First public beta of Palate.

· Tap once when you arrive at a restaurant
· Get a beautiful weekly Wrapped every Sunday morning
· Discover your eating personality

Privacy-first. No ads. No public profiles.
```

---

## 10. Screenshots required

Apple wants screenshots at these device sizes:

| Device | Size | Required? |
|---|---|---|
| **6.9" iPhone (Pro Max)** | 1320×2868 | ✅ Required |
| **6.5" iPhone (Plus)** | 1284×2778 | Recommended |
| **5.5" iPhone (older)** | 1242×2208 | Optional |
| **iPad Pro 12.9"** | 2048×2732 | Only if iPad-supported (we're not) |

Minimum: 3 screenshots, max 10. Recommended: 5–6.

**Suggested screenshots (in order):**
1. Home tab with "Check now" hero card + recent visits
2. Confirm-visit flow ("We think you're at Joe's Pizza")
3. Wrapped tab showing the dark personality card
4. Weekly Palate Insights with "Try next" recommendations
5. Wishlist tab with saved restaurants
6. Settings showing privacy controls + Sunday reminder toggle

How to capture: install the build on your iPhone via TestFlight, take real
screenshots, and crop in Preview. Or use the iOS Simulator + the
"Save Screen" feature for cleaner pixel-exact captures.

---

## 11. App Icon (already done ✅)

`mobile/assets/icon.png` is your 1024×1024 App Store icon. EAS uploads it
automatically — no separate App Store Connect upload needed.

---

## 12. After your first build is approved

- **TestFlight Public Link** — turn on under TestFlight tab. Anyone with the
  link can install (capped at 10,000 testers). This is your soft-launch URL.
- **Production release** — only when you're ready for the open App Store. Can
  happen weeks after TestFlight is up.

---

## Section quick-reference for App Store Connect

When you click around App Store Connect after creating the app, you'll fill these out in roughly this order:

1. **My Apps → + → New App** → fill bundle ID `app.palate.ios`, name `Palate`
2. **App Information** → categories, content rights → from §1 above
3. **Pricing and Availability** → from §2 above
4. **App Privacy** → answer the questionnaire from §3 above (huge time-saver)
5. **Prepare for Submission** (under your version) → §4 description, §5 promo, §6 keywords, §7 URLs, §8 review info, §9 What's New, §10 upload screenshots
6. Submit for Review when build is uploaded
