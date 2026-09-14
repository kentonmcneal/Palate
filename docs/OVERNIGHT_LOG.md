# Overnight log — 2026-09-14

Ranked by what most deserves attention in the morning.

---

## 1. I shipped a change today on a number I had been told not to trust, and reverted it

**What happened.** Earlier I moved unscored inbox entries from the Medium band
to Low, reasoning that Medium (36%) underperformed Low (45%) and therefore held
two populations. The audit that produced those figures had already flagged them
as invalid in its own disagreements section: they join `visit_resolved` to
`prompt_decisions`, and `visit_resolved` logs the **pre-demotion** band while
the digest acts on the **post-demotion** one. It said in as many words not to
quote the number. I quoted it.

**Re-derived** from `confirm_yes` / `confirm_corrected` / `confirm_no`, which
carry the band actually displayed, counting a correction as a capture because
the meal happened and only the name was wrong:

| band | captured | refused | precision |
|---|---|---|---|
| high | 12 | 13 | **48%** |
| unbanded | 3 | 6 | 33% |
| medium | 6 | 17 | 26% |
| low | 0 | 12 | **0%** |

Monotonic. The anomaly that justified the change does not exist. Reverted.

**Two things this surfaces that I did NOT act on, because 25 decisions is not
enough to decide at 3am:**

- **High runs at 48%, not 91%.** High is the only band that arrives pre-ticked,
  so one tap on Confirm writes a coin flip into the diary, the taste graph,
  Wrapped and the public profile. It may be that nothing should be pre-ticked.
- **Low has produced zero captures in twelve decisions.** If that holds,
  asking about low-band stops is pure cost.

---

## 2. Location-scoped learning had never recorded a single location

110 `prompt_decisions` rows. Every one has a null `lat` and `lng`.

Migration 0145 added those columns so a refusal would be evidence about a venue
**at a position** rather than about a brand. Its own comment predicted the
failure exactly: *"prompt_decisions.lat stays null forever and nothing is ever
learned about a spot."*

The realtime confirm screens do pass a position. But `REALTIME_PROMPTS_ENABLED`
is false, so those screens never run — and the digest, the only confirmation
path in production, was the one that dropped it. `ConfirmableEntry` did not
declare the coordinates, and `digest.tsx` passes entries through `as never`, so
nothing complained.

The data was present the entire way: `InboxEntry` carries them, `toDigestEntry`
spreads them, `DigestEntry` is `InboxEntry & {…}` so they are even typed at the
boundary. A cast erased them one line before use.

**Fixed and shipped.** This is what makes "the Panda Express across the Walmart
car park" learnable, which is the shape of the Winchester Road complaint.

---

## 3. A risk I introduced today and want flagged

Notification permission is now requested **provisionally**. That trades loud
delivery to ~40% of people for quiet delivery to ~100%.

The evening digest is the **only** confirmation path in production. Quiet
delivery means no banner and no sound — it lands in Notification Center. The
digest open rate is already thin (12 opens by 3 people in 7 days against 186
resolved venues), and provisional could reduce it further for new users.

The upgrade path exists — the full permission is asked for after a first
confirmed visit — but a new user has to get through the digest at least once to
reach it. **Worth watching, and reversible in one line.**

---

## 4. The detection funnel, measured rather than assumed

Last 7 days, 5 active users: **1,226 stops → 401 qualified → 186 resolved → 11
visits logged.**

Where it goes, with the reasons the code actually records:

- **`open-visit` 576** — a stop still in progress. Not a loss; the same stop
  reported repeatedly before it ends.
- **`dwell-too-long` 109** — over the 4-hour ceiling. I checked this expecting a
  bug and it is fine: those are homes, offices and long stays, not meals.
- **`no-venue-found` 211** — no food venue in range. Plausibly correct: shops,
  friends' houses, petrol stations.
- **`suppressed-duplicate` 115** — the same place detected again. Will rise now
  that dedupe is same-place-same-local-day rather than within-the-hour, which
  is the intended direction.

**The loss is not detection. It is confirmation.** Of 186 resolved venues, 20
were confirmed, 48 refused, and 41 expired unanswered. More entries expire than
get confirmed.

That points at two things, in order: attribution precision (48% at the band we
pre-tick), and whether people see the digest at all (see §3).

---

## 5. Not done, and why

- **Personalised novelty appetite ("weekend warrior").** Computable, but at 66
  visits with 13 repeats total it would be fitting noise. The brief I was given
  says to compute-and-log rather than rank on it; I did not start it because
  half-built telemetry is worse than none.
- **Pre-resolution deduplication.** 115 duplicate suppressions happen *after*
  resolution, so the lookup is already spent. Deduping by position before
  resolving would save them, but most resolutions are free catalogue hits, the
  payoff is small, and it is the hot path. Not an unattended change.
