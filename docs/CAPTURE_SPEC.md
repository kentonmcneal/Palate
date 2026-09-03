# Capture & Notification Spec

How passive visit capture works, how captures get confirmed, and which
design decisions are settled. Reconciles the product spec with what the
code actually does and what two months of field failure taught us.

**Status key:** ✅ built · 🟡 partial · ⬜ planned · ❌ rejected (with reason)

---

## Product thesis

Passive capture is the thesis. Manual logging is the fallback, not the product.
Two decisions follow and should not be quietly reversed:

1. **The private ledger and the public profile are separate objects.** Passive
   capture feeds a complete private history — fast casual, coffee, routine
   meals included. The user curates what is publicly visible. Recommendations
   use the complete data; identity uses the curated slice. ⬜ *Today there is a
   single `profile_visibility` toggle, not two objects.*
2. **The differentiating signal is repeat visits, not ratings.** Everyone else
   measures first visits and opinions. Revealed loyalty — who goes back, how
   often, with whom — is the metric no competitor can compute and the only
   objective one in this category.

---

## Detection

### ✅ Settled: coarse continuous location + on-device stop detection

The detector reads location continuously at `kCLLocationAccuracyHundredMeters`
with a 40m distance filter, accumulates a "stop candidate" within a 120m radius,
and **emits the moment dwell crosses the threshold — while the user is still
there.** One high-accuracy fix is taken at that instant to name the venue.

### ❌ Rejected: OS visit monitoring (CLVisit) as the primary detector

This was the original design and it is why the feature was dead for weeks.
`didVisit` stopped firing reliably on iOS 26 — widely reported, inconsistent
across 26.0 / 26.0.1 / 26.1. CLVisit remains registered as a free secondary
signal; it is not depended on.

The battery concern that motivated CLVisit is real and is addressed differently:
coarse accuracy uses wifi/cell rather than GPS, an adaptive power profile
throttles once a stop has been reported, and GPS fires exactly once per
qualifying stop.

### ❌ Rejected: exit-triggered capture

The argument for exit is that it reveals dwell time. We get dwell without
waiting for exit, sooner, by emitting at threshold. Every exit-triggered build
felt dead to the user because nothing arrived until they had travelled away.

### ❌ Rejected: geofencing a rolling set of nearby restaurants

`CLMonitor` still caps at **20 simultaneous conditions** (verified — iOS 17's
API did not lift the old `CLRegion` limit). A rolling-region design misses any
restaurant outside the current 20 and fails *silently*, which is the worst
failure mode available here.

### ⚠️ Correction: there are no polygons

The product spec is written in terms of "dwell inside a restaurant polygon."
Google Places returns **centroids, not building footprints** — we store no
geometry. Every containment rule must be restated as *distance to centroid vs.
the accuracy radius*.

This reshapes dense-retail handling too. The ambiguity is not "which polygon
contains me" but "which of these N centroids within R metres is it" — which the
pipeline already computes and logs as `candidate_count`.

### ✅ Capture floor: 5 minutes, not 20–25

A five-minute counter-service stop is a real meal and must be captured. The
product requirement is explicit: *sit for 10 minutes, or five at a Shake Shack,
and it should register.*

Long dwell is not discarded as a signal — it moves to **confidence** rather than
eligibility. 20+ minutes scores high; 5–15 minutes is captured at lower
confidence. That is the reconciliation: the spec's 20-minute instinct is right
about *certainty* and wrong about *eligibility*.

Current gates: dwell 5 min – 4 hr, accuracy ≤ 100m, on-device home/work
suppression.

---

## Loggable vs. recommendable

`recommendation_eligibility` answers "should we recommend this?". Capture asks a
different question. Chains and fast food are deliberately eligibility 0 so the
gems-first recommender never suggests them — but they are places people eat, and
a diary that refuses to log them is broken.

`isLoggableVenue` keeps fast food, chains, food courts and bars. It drops only
stops where eating is not the plausible reason: `not_a_food_venue`,
`not_a_restaurant`, `non_food_primary_type`, `event_venue`, `airport`,
`captive_venue`, `lounge_gated`, `hotel`, `hotel_generic`. ✅

---

## Confidence scoring ✅

Every candidate carries a score 0–1 driving ordering, pre-check state, and
whether a real-time prompt is permitted.

| Signal | Direction | Available? |
|---|---|---|
| Dwell inside the stop radius | Longer = higher, saturating ~60 min | ✅ |
| Location accuracy | Tighter = higher | ✅ |
| Venue density within 50m | More candidates = sharply lower | ✅ `candidate_count` |
| Meal-window fit | Inside window = higher | ✅ |
| Prior confirmed visits to this venue | Repeat = higher | ✅ |
| Venue category | Restaurant/bar > mixed retail | ✅ `primary_type` |
| **Venue open at visit time** | Closed = near-zero, strong veto | ✅ migration 0070 |

Opening hours landed in migration 0070. `regularOpeningHours` sits in the same
Places "Enterprise" SKU tier as `rating`, `userRatingCount` and `priceLevel` —
all already requested — and Google bills the highest tier in the field mask, so
this cost nothing extra.

Hours are used twice: as the closed-venue veto in scoring, and as a demotion in
candidate ranking. Closed venues are pushed down, never removed — hours data is
imperfect and dropping the sole candidate on a bad record would turn a
resolvable stop into `no-venue-found`. Missing hours mean UNKNOWN and are never
penalised: that would punish exactly the small independent places this product
exists to surface.

Existing rows have no hours until they are refreshed by the classifier.

**Bands:** High ≥ 0.75 (pre-checked) · Medium 0.4–0.75 (shown, unchecked) ·
Low < 0.4 (collapsed).

### Calibration is what makes this falsifiable

Record the band on every prompt and every outcome. Of entries scored High, what
fraction get confirmed? **Below ~85%, pre-checking is costing trust and the
threshold must rise.** Without this, confidence scoring is guesswork with
decimal points.

---

## Confirmation UX ✅

**Default: a nightly digest, 8–9pm local.** Pre-filled and declarative —
"Chipotle, 12:40pm", not "Did you eat at Chipotle?". One tap confirms all, with
a search field to add anything missed. Confirmation is far cheaper cognitively
than input.

### Ordering: band first, chronological within band

Confidence ranking and chronological order pull against each other, and
chronology is how people actually reconstruct a day. Sorting purely by
confidence would destroy the recall scaffold that makes confirmation fast.

1. **High** — pre-checked, in time order. On a typical day this is the whole
   interaction.
2. **Medium** — unchecked, in time order, under "Also nearby today?".
3. **Low** — collapsed behind "Anything else?". Dense-retail ambiguity appears
   here as a "Which one?" picker, never a yes/no.

A user who only ever touches section 1 still ends up with an accurate ledger.
Sections 2 and 3 are upside, not obligation.

### Real-time prompts: the narrow exception

High band only, capped at **2–3 per week**, and only when: first visit to this
venue, long dwell, high location confidence, not dense retail. Novel visits
carry the richest taste signal and decay fastest from memory. Everything else
waits for the digest.

### Surfaces show confirmed entries only

Weekly recap, profile, history: **confirmed entries only**. An unconfirmed
Medium or Low candidate never appears as fact anywhere.

---

## The digest is the engagement loop

Strategic, not cosmetic. Perfect passive capture means the user has no reason to
open the app — the digest is that reason, so it must return value rather than
only request a chore.

Every digest carries at least one of: a recommendation informed by the day's
captures, a repeat-visit fact ("4th time at X this month"), streak state, or
progress toward an unlockable summary.

**Open risk:** the digest asks for a small daily action in exchange for a
benefit that only materialises weeks later, once the model has data. That gap is
the most likely failure point of the whole design. Watch confirmation rate over
each user's first 14 days — a decline curve means the give-back is too weak or
too late.

---

## Notification budget ✅

**1 digest per day. Real-time prompts are OFF** —
`REALTIME_PROMPTS_ENABLED = false` in `passive-confirm.ts`. Flipping that one
constant restores them, additionally gated to the High band.

---

## False positives vs. misses — resolved

The product spec says false positives cost more. Earlier implementation work
biased the other way. Both are right about different stages:

- **At detection, bias toward capture.** A missed meal is invisible and
  unrecoverable; nothing enters the taste model unconfirmed, so an extra
  candidate is cheap.
- **At pre-check, bias toward precision.** Pre-checking is exactly what makes a
  false positive dangerous: one tap confirms all, so a wrong High entry enters
  the model without anyone deciding to include it.

The 85% calibration bar polices the boundary between the two.

---

## Metrics

| Metric | Definition | Threshold |
|---|---|---|
| Location grant rate | **% still holding Always at day 7** | > 40% |
| Capture rate | % of actual out-of-home meals captured | > 70% |
| Opens per capture | app opens generated per logged meal | > 0 and rising |
| Notification opt-out | % disabling push | watch — unrecoverable |
| M3 cohort retention | % of cohort active at week 12 | > 30% |

### ⚠️ Correction: grant rate cannot be measured at onboarding

The funnel uses **provisional Always** — iOS grants silently, shows no dialog,
and asks the user days later at a moment it chooses. Measuring "granted at
onboarding" would report ~100% and mean nothing, while the real attrition
(people tapping "Keep Only While Using" later) would appear nowhere.

Measure **day 7**. The silent-downgrade path is already instrumented
(`perm_always_revoked`).

### Capture rate needs ground truth

There is no way to know the denominator without one. Have 5–8 testers keep a
manual diary for two weeks and reconcile against detected visits.

---

## Instrumentation

Already emitted ✅: `visit_detected` (source, accuracy), `visit_qualified`,
`visit_unqualified`, `visit_suppressed`, `visit_resolved`, `visit_unresolved`,
`confirm_yes` / `_no` / `_corrected`, `inbox_confirmed`, `confirm_notif_sent` /
`_suppressed`, the full `perm_*` funnel including `perm_always_revoked`.

Every confirm/dismiss already carries dwell, accuracy, source and
candidate_count — the learning-loop training data.

Added ✅: `confidence` + `confidence_band` on every prompt and outcome
(calibration), `visit_ignored` when an inbox entry expires unanswered (without
it the denominator counted only answered prompts, so ignored bad prompts scored
as excellent), `digest_scheduled` / `_opened` / `_confirmed`, and
`perm_always_day7`.

Still needed ⬜: nothing for the capture loop. The open instrumentation gap is
capture-rate ground truth, which no event can supply — see below.

---

## A/B note

At n=30 you cannot A/B this cleanly. Split 15/15 on digest-only vs.
digest-plus-real-time and read opt-out and capture rate qualitatively. **Do not
compute significance on this sample.**

---

## History backfill ✅

"History backfilled before first open" is already built: Gmail receipt import
scans 90 days on connect across 12 reservation/delivery/receipt senders. It is
manual-trigger today; migration 0051 adds a nightly cron, deliberately
unscheduled.
