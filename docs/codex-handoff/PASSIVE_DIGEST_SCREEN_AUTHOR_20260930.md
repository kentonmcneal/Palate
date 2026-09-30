# Passive digest screen safety — READY for independent review

WORKING TREE / offline author proposal. Scope: mobile/app/digest.tsx and new mobile/lib/__tests__/digest-screen-safety.test.tsx only. No repository edits, live services, notification/native operations, deployment, installs or backend changes. Read against main20e0c1; HASHES.json binds exact component base and unchanged helper bytes. Independent review required.

## Passive-first journey

The nightly screen still starts from detected places and their times. High-confidence unambiguous stops retain the helper's preselection; other stops require the person's choice. Confirming writes visits to the diary using the selected place and original detectedAt. Venue correction and a reaction remain optional. No dish is guessed, required or written by this proposal. No manual-entry detour is added.

The existing six-stop cap and confidence/ambiguity rules are unchanged. After a successful batch, Review more stops appears if the builder held others back; it reads the existing inbox and presents the next batch. Confirmation remains the primary path to the diary.

## Read recovery and action ownership

getInboxReadResult is used directly. Initial unavailable/rejected reads show an honest error and retry, not an empty day. A failed refresh leaves prior rows visible but disabled until another verified read succeeds. Only a verified empty result shows “No stops waiting for confirmation.” Same-tick read retries share one slot.

The screen session keys to the existing account generation using personal-signal invalidation, matching the integrated inbox/toggle contract. Layout lifetime, focus identity and read tickets reject abandoned results. Null accounts neither read nor write; Close still works. A→B→A is a different session.

Each committed render owns editable row handlers. A synchronous admission slot rejects repeat Confirm and prevents selection/rating changes during submission. Old-render/old-session callbacks cannot grade a new selection or initiate writes. Each helper dependency and each next entry checks captured account, focus and lifetime before starting. Already-entered helper side effects cannot be cancelled by the screen.

Focus return during a pending save waits for that operation to settle before rereading. It does not start a second batch. An optional payoff summary no longer holds the submission lock or blocks Done; late summaries are discarded after exit/refocus/new read. Actual navigation and OS behavior remain device-unverified.

## Partial success and truthful outcomes

The shared confirmDigest helper is unchanged. The screen invokes it one entry at a time, retaining confirmed-before-skipped ordering, with guarded dependencies. This permits a boundary check before another entry begins.

A per-session map remembers acknowledged saveVisit results. If a visit saves but inbox removal fails, the row remains outstanding and locked against changing the already-saved venue; Retry uses that acknowledgement and retries cleanup without a second saveVisit call. Successful rating/decision acknowledgements also avoid repeat helper calls during this cleanup retry. Confirmed visits without a returned ID remain outstanding. Fully settled entries disappear from the active batch and are filtered from subsequent same-session reads.

Partial failure leaves only unresolved rows actionable. Saved results remain in the diary. The success message counts unique acknowledged visit IDs, so helper dedup returning the same diary ID for two stops does not invent two saved visits. All skipped, with removals acknowledged, shows “Stops reviewed” and “No visits were added to your diary,” without confetti. Failed skipped removals remain retryable; helper-swallowed removal errors are not mistaken for completion.

Original detection dates, chosen venue IDs, optional ratings, correction decisions and builder preselection are exercised with the actual local helper implementations. Native scheduling and shared helper policy are untouched. Existing digest_opened/digest_confirmed analytics remain guarded optional calls; telemetry cannot undo displayed acknowledgements.

## Evidence executed

FINAL.log: **67/67 tests,4suites pass** —23 new actual mounted screen controls, existing digest-confirm/passive-digest controls and strict inbox display-read API controls. TYPES.log: copied app no-emit TypeScript passes (empty log). Read-only patch application check passes.

The new harness uses installed React/react-test-renderer19.2.3, StrictMode, actual screen source, real confirmDigest, buildDigest, confidence classification/inbox policy and account-generation source. SDK/storage write, strict-read response, analytics, optional payoff/haptic, focus and navigation boundaries are synthetic. Unexpected imports throw; network fetch throws and is asserted unused. No model of confirmation replaces the real helper. Test transpilation preserves the source extension, including generic TypeScript helpers.

Controls include unavailable versus empty, thrown read/retry, disabled cached rows, duplicate admission, retained row callbacks, partial save and cleanup failures, skipped cleanup failure, missing save ID, B/ABA/null/blur/unmount during save, out-of-order focus reads, stale-account reads, refocus while saving, seven-stop continuation, original detection timestamp/venue correction/rating, unique-ID counts, payoff failure and unresolved payoff with working Done.

Negative evidence on these final23 controls:
- BASELINE.log:22fail/1pass on actual original screen. This includes absent recovery UI and focus-model differences, not22separate root causes.
- NO_ADMISSION.log:3fail when render/verified/busy admission checks are removed.
- NO_SAVE_CACHE.log:2fail when acknowledged save reuse is removed.
- NO_BOUNDARY_GUARD.log:6fail when per-helper ownership checks are removed.
- EMPTY_ON_ERROR.log:2fail when unavailable is converted to ready/empty.
- Original proposal restored; final67controls and types rerun afterward.

Run after integration, from mobile:

    node node_modules/jest/bin/jest.js --runInBand --watchman=false lib/__tests__/digest-screen-safety.test.tsx lib/__tests__/digest-confirm.test.ts lib/__tests__/passive-digest.test.ts lib/__tests__/passive-inbox-display-read.test.ts
    node node_modules/typescript/bin/tsc --noEmit

No full app-suite or device/rendering claim. Physical layout, VoiceOver, real focus transitions and notification opening should be checked after independent review.

## Boundaries that remain

- Global ownerless inbox/native payloads are not account-owned by this patch. A record captured under A and first loaded under B is not fixed by request-generation checks. Existing account-isolation namespace/migration work remains separate and high priority.
- Screen acknowledgements last only for this mounted session. They do not add a persistent operation journal, cross-screen mutex, cross-device dedup or transactional exactly-once writes. A lost response after a committed backend write is not proof that nothing saved; existing saveVisit dedup remains the cross-attempt safeguard. Durable transactional dedup is separate.
- A helper already entered can finish after blur/unmount/account change; wrappers suppress later calls but cannot revoke a sent request. Existing saveVisit/recordPromptDecision account guards remain essential. Shared rate/remove helper internals are not rewritten here.
- A confirmed visit may have saved even if its optional rating/learning operation fails, as under the existing helper contract. No fabricated rating or diagnostic success is shown.
- No detector eligibility changes or diagnosis of the reported7Brew short-stop issue. Places/times are preserved; no inferred dish data introduced.
