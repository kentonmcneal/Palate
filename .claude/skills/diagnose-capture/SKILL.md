---
name: diagnose-capture
description: Diagnose why Palate's passive visit capture did not fire. Use when a visit was missed, no prompt appeared, or the digest was empty.
---

# Diagnosing passive capture

Detection is invisible by construction — background, over minutes, with
nobody watching. Every failure looks identical from outside: nothing
happened. Work the evidence in this order.

## 0. A stale note is not evidence

Three times in one week, work was started on something already shipped
because a note said "pending". Other sessions move faster than the notes.

```bash
git ls-files mobile/modules/palate-visit-monitor/ios/   # is it even committed?
git log --oneline -3 -- <the file>
```

The worst bug in this project's history was a bare `ios` line in
`mobile/.gitignore` excluding the entire native module, so no build ever
contained it. `git ls-files` would have found it in seconds.

## 1. Read the Detector log first

**Settings → Admin → Passive capture.** Native detector events and JS
pipeline outcomes share one timeline.

| Line | Meaning |
|---|---|
| *(empty)* | Monitoring never started, or the native module is absent |
| `monitoring_started` / `_resumed` | Armed |
| `candidate_started` / `_extended` | A stop is accumulating |
| `emit_threshold_reached` / `emit_via_timer` | 5 minutes reached |
| `precise_fix_ok` / `_timeout` | The one-shot GPS fix that names the venue |
| `prompted: <name>` | Worked |
| `miss: <reason>` | Detected, then dropped — the reason is the answer |

`miss:` reasons: `home/work suppressed`, `unqualified: <gate>`,
`no food venue in range`, `<suppression>: <venue>`.

## 2. If the log is empty

Check the three gates, all required:

1. **User opt-in** — Settings → Passive tracking toggle
2. **Remote kill switch** — `feature_flags.passive_capture_detection`
3. **CoreLocation reporting `always`**

The debug screen shows `Always (CoreLocation)` and `Always (expo-location)`
side by side. **They disagree under a provisional grant** — native says
`always`, expo says `denied` — because expo's requester waits ~1.5s for a
dialog that provisional never shows. Native is the source of truth; that
disagreement means provisional is working correctly.

`Native module: unavailable` means the binary lacks it. No OTA fixes that.

## 3. Settled — do not redesign

- **CLVisit is dead.** `didVisit` stopped firing reliably on iOS 26. It stays
  registered as a free secondary signal and is never depended on.
- **Geofencing was rejected.** `CLMonitor` still caps at 20 simultaneous
  regions and fails silently past that.
- **Floor is 5 minutes**, not 20. Long dwell raises confidence, it does not
  gate capture.
- **Confirmation is the nightly digest**, not per-visit prompts.
  `REALTIME_PROMPTS_ENABLED = false`.
- **"Don't recommend" is not "didn't happen."** Chains and nightclubs are
  excluded from recommendations and still logged — `isLoggableVenue`, not
  `recommendation_eligibility`.

## 4. Verify the artifact, not the intent

Reading source and concluding what it does produced four wrong OAuth fixes
in a row. Every fix that actually landed came from reading something real:
`git ls-files`, `node_modules` source, the live Supabase schema, the actual
inbox. When stuck, find the artifact.

## 5. Nothing beats a real meal

Sit 5+ minutes somewhere that is not home or work, then read the log. No
amount of code reading substitutes. Report two things separately: **did it
fire** (detection) and **did it name the right place** (attribution).
Different problems, different fixes.
