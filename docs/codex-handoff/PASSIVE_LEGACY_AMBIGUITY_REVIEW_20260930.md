# Independent legacy ambiguity review

## Assessment

**Main's current count-bearing fix is correct, but the broader legacy-ambiguity contract still has one actionable gap.** Do not claim every known-ambiguous legacy entry is now unchecked.

Captured HEAD was `e22348c98e8659c73cff3a429779963dad900ecd`, with the reviewed passive-digest working-tree changes applied. HASHES.json binds the executed base/current/proposed files. No repository writes, live reads, notification delivery, installation or permission requests occurred.

### P2 — missing/stale candidateCount can override known alternate/cluster evidence

At `toDigestEntry`, ambiguity still derives solely from `(entry.candidateCount ?? 1) >= 2`. `InboxEntry.candidateCount` and `cluster` are optional, while `alternates` carries independent candidate information. A structurally supported stored entry with `confidenceBand:"high"`, `confidence:0.9`, one alternate and omitted `candidateCount` therefore produces:

- `ambiguous:false`, `preChecked:true`;
- actual mounted DigestScreen footer **Confirm 1**, without a Which one? affordance;
- a named notification with `passive_confirm` direct-action category.

The same happens when a stored count says one but an alternate is present, or when a stored cluster flag is true and count absent. These are synthetic supported/mismatched-metadata cases; no claim is made about how many real stored rows have these shapes. Inspecting actual history would require separate authorized evidence, not this offline audit.

**Bounded correction:** retain the count test and also treat nonempty alternates or `cluster === true` as known ambiguity. `LEGACY_AMBIGUITY_FOLLOWUP.patch` makes this additive change against main's current working tree. It intentionally preserves legacy high entries with missing count and no other ambiguity evidence. It does not infer new candidates or rescore old GPS data.

## Confirmed consistency of main's change

- `bandFor` recognizes both a stored high band and a score-only high entry.
- `toDigestEntry` now leaves count-bearing ambiguous high entries in the high section but sets `preChecked:false`.
- Actual `app/digest.tsx` initializes its checked set from `preChecked`, not the high section; count-bearing ambiguous rows therefore render unchecked.
- Explicit alternate choice marks the entry selected and actual `confirmDigest` saves the alternate ID. No mandatory alternate-choice requirement is invented: intentionally toggling the top guess is still allowed.
- In a mixed digest, initial footer is Confirm 1 and actual confirmation saves only the clear venue. The ambiguous unchecked row follows existing skipped/dismissed/removal behavior; this is unchanged by the patch.
- Notification title counts only prechecked high rows. Two unambiguous high rows retain the two-place title; medium rows stay unchecked.
- For count-bearing ambiguity, scheduling continues to omit direct action category and place/inbox payload. Clear high entries retain explicit direct answers.

No separate regression was found in the title/selection caller relationship. Remaining comments describing every high entry as prechecked are stale prose, not another behavioral defect.

## Executed independent controls

`controls.cjs` executes actual TypeScript for the digest builder, score-to-band conversion, notification ownership helper, DigestScreen and confirmDigest. React **19.2.3** and react-test-renderer **19.2.3** are the existing Palate versions. Native visual components are host stubs; inbox reads, visit writes, notification operations, telemetry and payoff/haptics are synthetic boundary functions. Real scheduling/services are never loaded. The scorer's unused meal-window dependency is closed with a throwing stub; stored-score band conversion is actual code.

Fourteen controls cover stored band+score, score-only, mixed selection/save, two clear high rows, medium row, explicit alternate save, notification direct-action presence/absence, absent/stale counts, cluster flag, and legacy missing-count clear compatibility.

| Source | Result |
| --- | --- |
| HEAD digest before current patch | **5 pass / 9 expected failures** |
| Current working-tree digest | **9 pass / 5 failures**, all the one metadata-gap family |
| Main change plus suggested follow-up | **14/14 pass** |

BASELINE.log, CURRENT.log and PROPOSED.log preserve the runs. Negative assertions require the actual screen/footer and synthetic saved IDs, not a replacement selection model. React's renderer emits its upstream deprecation warning; no renderer change or new package was used.

Main's existing digest and digest-actions Jest suites were also rerun against copied current source (MAIN_JEST.log). Patch application check passed against main without applying to the repository.

This is rendered component-state/handler evidence under a host-stub renderer, not device layout, accessibility certification, delivery proof, inbox migration proof or account/session-race review. The narrow proposed follow-up is independently authored and still needs main's review before integration.

## Reproduction

From the shared workspace:

```
/opt/homebrew/bin/node outputs/passive-legacy-ambiguity-independent/controls.cjs work/passive-legacy-ambiguity-independent/candidate/mobile
/opt/homebrew/bin/node outputs/passive-legacy-ambiguity-independent/controls.cjs work/passive-legacy-ambiguity-independent/proposed/mobile
```

The review runner uses the installed Palate dependencies; it is an audit artifact, not proposed durable repository tooling. Vocabulary batch seven was not edited.
