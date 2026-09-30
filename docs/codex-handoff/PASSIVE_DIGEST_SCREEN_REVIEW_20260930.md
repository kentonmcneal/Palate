# Passive digest screen independent review — READY

Accept with ADDITIVE_FIX.patch, applied after Mendel's DIGEST_SCREEN_SAFETY.patch. Two reproduced behavior defects need the small corrections below. Repositories remained read-only. No services, permissions, installs, OS notifications, credentials or device operations.

## Findings and corrections

**1. Refocus discards explicit confirmation choices.** The new focus read reconstructs checked from preChecked alone. Reproduction: uncheck high stop A; rate/select medium stop B; blur/refocus. A becomes checked and B unchecked, although B still shows its rating. Confirm can now log the stop the user rejected and dismiss the one they accepted. Failed-refresh/retry does the same reset. The additive correction remembers explicit per-entry selections within this account/screen session; verified reads retain those choices and use builder defaults for new entries. Acknowledged saved rows stay checked/locked. Account-generation remount clears choices. This uses the inbox's stable entry IDs; it adds no cross-session or capture-owner ownership claim.

**2. Partial dismissal retry suppresses a changed decision.** Skipped removal fails after recordPromptDecision('dismissed') resolves. The editable row remains; user selects it or chooses an alternate and confirms. A visit is saved, but the entry-ID-only decided set suppresses 'confirmed' or 'wrong_place'. The additive correction caches the completed call's argument signature per entry, so an identical cleanup retry is still deduplicated while a changed outcome/place/position is sent. Actual recordPromptDecision appends: this does not retract the earlier dismissal or claim transactional replacement. It stops silently omitting the later user answer.

Production changes remain limited to digest.tsx. The patch also adds ten independent regression cases, using a copied version of the author's mounted harness and actual current local helper sources.

## Executed evidence

- ORIGINAL.log: final ten independent controls on exact author component — four fail, six pass. Four failures represent the two root causes above (refocus, failed-refresh retry, changed confirmation, changed venue).
- CORRECTED.log: **77/77 tests across five suites pass**: author23, independent10, existing helper/read suites44.
- TYPES.log: copied mobile app `tsc --noEmit` exits0.
- Installed Palate React/react-test-renderer19.2.3, StrictMode. This is the matching Palate runtime, not Groundwork ReactDOM19.2.8. No visual/native claim.
- Additional account transitions while rating, decision or removal awaits all block later helpers and next entries. Tests also retain acknowledged visit/rating across cleanup failure and refocus, keep identical-dismissal retries deduplicated, preserve defaults for genuinely new IDs, and reset selections on A→B→A.

Tests load the actual screen, confirmDigest, buildDigest, confidence/inbox policy and username generation implementation. SDK/write/read-response, navigation/focus, analytics and optional payoff boundaries are mocks. Actual function components mount; tests intentionally invoke retained handlers. Focus simulation exercises setup/cleanup, not Expo device navigation. Network is forbidden and asserted unused. Source parity hashes bind all local helper bytes used by this copy.

## Helper semantics and bounded acceptance

The author's core changes correctly distinguish unavailable reads from a verified empty inbox, synchronously admit one confirmation, retain saved IDs across partial removal failure, guard each subsequent dependency/entry, and release the lock before optional payoff. Saved ID counts are unique. Empty acknowledgements do not remove confirmed rows. All-skipped completion makes no diary-addition claim. The existing confidence/preselection, six-stop batch and original detectedAt/venue mapping remain unchanged except preserving explicit user answers on reload.

Important precision about 'acknowledgements':

- saveVisit validates its initiating account at await boundaries and uses its initiating authorization. Existing dedup is not an atomic exactly-once transaction; a lost response can still leave an unknown committed write. Screen caches only returned IDs and are lost on unmount/account replacement.
- rateVisit updates by visit ID, tolerates a missing rating column, and does not prove affected-row count. Its resolved promise is NOT evidence a rating persisted. It also lacks the full initiating-account authorization protocol of saveVisit. Once this helper has entered, screen checks cannot cancel or retarget-proof its request. This is a remaining helper boundary, not solved by mounted mocks.
- recordPromptDecision can return normally on abandoned-account work or a reported insert error. The cache records completed calls, NOT guaranteed durable decision writes. No new rating/decision-success claim appears in the screen. Retrying durable bookkeeping needs a different helper contract.
- removeFromInbox serializes local read/modify/write, starts asynchronous mirroring and then awaits notification rescheduling. It can reject after local removal succeeded. A retry must not be read as proof the row still exists remotely; fresh verified reads may legitimately omit it. Screen cannot cancel an already-entered removal or guarantee remote mirror completion.
- track catches failures in its real implementation. The screen's optional telemetry wrappers do not establish account provenance inside a sent analytics request.

The shared inbox/native records remain legacy ownerless data. Generation checks protect stale screen work, not ownership of a record first loaded under another account. No durable transaction, cross-screen mutex, cross-device dedup, account namespace migration, or native cold-start protection is supplied. Those explicit author limitations remain valid.

## Integration

Apply the author's patch first, then ADDITIVE_FIX.patch. Run installed Jest from mobile with `--runInBand --watchman=false` on digest-screen-independent.test.tsx, digest-screen-safety.test.tsx, digest-confirm.test.ts, passive-digest.test.ts and passive-inbox-display-read.test.ts under lib/__tests__; run the mobile no-emit typecheck. Preserve other pending helper and UI work.

HASHES.json binds input, correction, regression and unchanged dependency bytes. No full-app suite/build, real navigation, VoiceOver, server policy, device lifecycle or durable privacy proof is claimed. Main should perform its integration checks and review this additive correction.
