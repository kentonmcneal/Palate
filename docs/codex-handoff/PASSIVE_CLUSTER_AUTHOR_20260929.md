# Passive detection: recurring coffee reproduction and bounded candidate

Source captured at Palate HEAD `b9b9bf746236548038b0b4ec0c3148499c08344c`; exact file SHA-256 in SOURCE_HASHES.json. Repo remained read-only. This is an author proposal requiring independent integration review, not a device accuracy result.

## Reproduced: recurring short coffee becomes work

Actual `recordForClustering` and `isHomeOrWorkSuppressed` source executed in a Node VM, with only in-memory AsyncStorage. Three 1, 2, 5, 8 or 15-minute observations at each weekday arrival hour 9, 10, 15 and 16 suppress the next visit. The 2-minute observation fails meal qualification but is still recorded by `runPipelineForRaw` (source inspection). Existing stored short points continue causing this until scoring changes; merely filtering future writes would not fix those users.

Also reproduced: retrying the same eight-hour observation three times supplies three work hits. Three coarse 400m observations likewise teach a specific 60m cluster despite poor positional evidence.

`COFFEE_CLUSTER_FIX.patch` proposes:
- Count work evidence only with known finite dwell >=120 minutes and the existing weekday/non-lunch hours. This is a conservative heuristic, NOT an empirically established distinction between offices and cafes. Two-hour cafe visits can still resemble work; short/shift workplaces may no longer be inferred.
- Deduplicate new records by raw visit ID, replacing an earlier version of that ID. Legacy records lack IDs and cannot be retroactively deduplicated.
- Refuse incomplete/invalid/coarse (>100m) observations as cluster evidence. Keep long stays, including those exceeding the four-hour meal ceiling.
- Preserve overnight logic and legacy overnight history; preserve five-minute local and twelve-minute away eligibility floors. Short late-night stops can still count as home under existing overnight logic; this patch does not claim to solve that separate inference problem.

No calls, pricing, recommendation eligibility, notification behavior or native code changed. New duration-rejected points do not enter history: the existing local/away minimum is applied before recording. Three rejected six-minute away stops therefore leave the next stop subject to twelve minutes. Existing already-contaminated travel histories cannot be reconstructed from the old schema (no original area context/timestamp); no destructive history reset is proposed. Deduplication handles sequential resolution retries, not concurrent AsyncStorage transactions or different native IDs for the same physical stay.

## Offline controls

`cluster-controls.cjs`: actual TypeScript source transpiled with the installed mobile TypeScript compiler; imports replaced by local mocks. No services loaded or called. This is function-level execution, not mounted UI, actual runner execution, full TypeScript project checking, or native execution.

- Original: **5/30 pass, 25 expected failures** (20 short-stop combinations, same-ID retry, coarse evidence, existing stored short history, rejected-away history contamination, local one-minute history contamination).
- Candidate: **30/30 pass**.
- Positive controls: three distinct eight-hour work observations and three 19:00–08:00 home observations suppress; legacy overnight history preserved.
- Eligibility controls: local four minutes rejected, five minutes accepted; with distant history eight minutes rejected and twelve accepted.

Run `/opt/homebrew/bin/node outputs/passive-detection-audit/cluster-controls.cjs [source-file]` from workspace. Optional `PALATE_MOBILE` selects the existing dependency root. RED.log/GREEN.log are the completed runs.

## Additional source findings: not fixed or device-proven

1. **Native early-emission versus travel floor:** native stop detector emits once around five minutes and latches `emitted`; departure only emits if not already emitted. JS travel qualification requires twelve minutes. Thus an early emitted away stop can be consumed as unqualified even if the person ultimately stays twenty minutes. Another CLVisit may rescue it, but the primary stop's later duration is not assured. Do not simply lower travel floor: preserve early observations for later duration reconciliation, or require stronger source/proximity evidence for any short-stop exception. Native integration needs separate tests/build review.
2. **Long-work control limitation:** a synthetic completed eight-hour observation remains useful evidence, but the primary native detector normally emits early. It does not guarantee that completed duration reaches JS. Keeping long CLVisit observations is necessary; this patch does not make native long-stay learning reliable.
3. **NYC attribution risk:** confidence uses raw GPS accuracy but not distance from the fix to the winning venue, and does not receive source. Ranking uses venue distance, but ranking a lone candidate does not prove presence inside it. A precise bus-stop fix can still yield confident restaurant attribution. Proposed next bounded control: execute resolution with a sole nearby venue versus a matched centroid, enforce source-aware evidence for high/prechecked status. No claim that identical GPS traces can distinguish bus waiting from coffee drinking. Venue centroids are not building footprints.
4. **Short coffee missing upstream:** sub-five-minute visits may never be emitted natively. Changing clustering cannot recover absent raw observations. No actual 7 Brew location, type record, visit trace or duration was available. `isLoggableVenue` deliberately allows chain/fast-food exclusion reasons, and catalogue reads request `recommendableOnly:false`; a recommendation exclusion alone does not establish a capture exclusion.
5. **End-of-day scope:** current `scheduleDigest` cancels prior notifications then returns if `isDigestWorthSending` is false. It is capture-driven, not an unconditional daily “ate somewhere?” safety net. Broader end-of-day behavior still needs dedicated mocked scheduling controls; this report does not certify it.

Remaining broader audit: actual runner/matched-venue confidence and digest scheduling regression suites. This package completes the latest requested recurring-coffee reproduction and provides a narrow tested proposal early for main review. No live, physical-device, calibrated accuracy or full pipeline claim.

## Laplace handoff

Packet ready: COFFEE_CLUSTER_FIX.patch, source/passive-pipeline.ts, SOURCE_HASHES.json, cluster-controls.cjs, RED.log, GREEN.log. Read STATUS.md in ../passive-detection-independent for independent baseline corroboration. Please review the 120-minute heuristic, legacy compatibility and incomplete/native emitted-duration limitation specifically. Patch application check passed against current repository; no source writes. Scope is clustering/history only; matched-venue confidence and native timer accuracy are not changed or certified.
