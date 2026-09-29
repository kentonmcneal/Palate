# Independent review: bounded JS observability correction

## Verdict

**WORKING TREE / offline execution:** The candidate addresses the original ordinary-JS egress and source-map-identity findings, with appropriately bounded native/server claims. One **P2 validation defect** remains in its final transport filter: coercible objects and changing property accessors can carry unvalidated freeform data into retained fields. Apply the accompanying small follow-up before treating this as the reviewed JS transport boundary.

`OBSERVABILITY_VALIDATION_FIX_20260929.patch` is additive to the author's `observability-js-privacy.patch`. It changes only:

- `mobile/lib/observability-privacy.ts`
- `mobile/lib/__tests__/observability-privacy.test.ts`

**WORKING TREE:** At review start, the four repository files matched the author's original prototype hashes. During review main applied the author's candidate: all four now exactly match its proposed hashes. The author's patch consequently no longer applies a second time. **The independent follow-up applies cleanly to the latest repository state.** Both hash observations are recorded in BASE_COMPARISON.json and LATEST_BASE_COMPARISON.json. The original base → author patch → independent fix chain was also applied in workspace scratch and matches the tested final four files exactly. No application repository writes were performed by this review.

## P2 — Validate and forward the same primitive

**WORKING TREE / reproduced through installed SDK serialization:** The original `exception()` lets a non-string `value.type` reach a regular-expression test. JavaScript coerces that object to a string for validation, but the function then returns the original object as `type`. A synthetic object whose `toString()` returns `SupabaseError 23505` and whose `private_field` holds the sentinel is therefore serialized with that field intact.

Several other fields validate a getter result and then read the getter again to produce output: exception type, timestamp, level, engine, frame `in_app`, mechanism type/handled, and Hermes debug-info boolean. A changing getter supplies an allowed value for validation and a private string for the later read. The final guard is after the last hook, but the guard's own repeated reads defeat its validation.

**Actual reachability demonstrated:** A synthetic `beforeEnvelope` hook supplies the malformed fields after ordinary event preparation. Installed Core constructs the envelope; the configured filter runs; installed Browser `makeFetchTransport` and Core `createTransport` serialize the body; a supplied in-memory fetch executor records it. The candidate leaks the sentinel in eight regression variants. No real fetch, native initialization, credentials or private events are involved.

**Severity boundary:** This is one validation defect with eight controls, not eight distinct production leaks. No current Palate call site producing such objects/accessors was identified. These are malformed/adversarial JavaScript values, not ordinary JSON event fields. The result does not imply an attacker can install SDK hooks remotely or that the filter can sandbox arbitrary executable JavaScript. It does contradict the stronger malformed-field/final-allowlist claim and is inexpensive to fix.

**Fix:** Snapshot the relevant values once, require a primitive string before exception-name matching, and reuse boolean/enum/numeric validation results. No diagnostic allowlist is widened. The follow-up preserves the existing canonical bundle identities, coordinates, accepted error categories, mechanisms, debug IDs, engine enum and infer-IP policy. It adds eight durable tests to the existing real-Core envelope suite. Throwing getters still fail closed through the existing outer catch.

## Original findings: disposition

| Original concern | Independent disposition |
|---|---|
| `.jsbundle` rejected / canonical URI lost | **WORKING TREE:** Corrected. Exact `app:///main.jsbundle` and `app:///index.android.bundle`, plus their exact bare forms, retain canonical identity. Unknown basenames, paths and query-bearing strings are not accepted. |
| Core-prepared sourcemap IDs dropped | **WORKING TREE:** Corrected locally. The author's test supplies a frame debug ID at processor time and lets Core move it into `debug_meta.images`; the ID and canonical code file survive serialization. My separate Browser-transport test retains both platforms' mappings and coordinates. This proves preservation, not upload or server symbolication. |
| Native collection bypasses JS `beforeSend` | **CODE / WORKING TREE:** `enableNative:false` prevents this RN init from enabling scope synchronization and makes the native wrapper return before its native-init call. Explicit native crash/session flags reinforce intent. Independently initialized native clients and historical native queues remain outside this change. |
| Arbitrary SDK/build/path/function fields survive | **WORKING TREE:** Candidate removes those ordinary freeform slots. Fixed `sdk.settings.infer_ip:"never"` is reconstructed; release/dist/environment and SDK identity are omitted. The primitive-validation follow-up closes the demonstrated malformed-field exceptions. |
| Attachments, feedback and internal SDK bypass paths | **WORKING TREE:** Final transport reconstructs envelopes/items, admits only event items, removes attachments, drops feedback and unsupported channels, and filters internal events even when `beforeSend` is skipped. Late ordinary metadata/attachment mutations are removed. |
| Raw extras/breadcrumb helper data enters SDK scope | **WORKING TREE:** `reportError` no longer uses scope extras/context; breadcrumb helper is a no-op. `toError` remains compatible locally. This does not mean raw Error objects/messages never exist in SDK memory: captureException still receives the local Error before event filtering. |
| Grouping and diagnostic loss | **CODE / INFERENCE:** Deliberately remains: generic messages and omitted runtime names/build metadata reduce detail/grouping. Structured categories, positions and sourcemap identities survive, but actual dashboard grouping/symbolication are unverified. |

## Installed SDK source checks

**CODE:** Versions remain RN 7.11.0, Core/Browser 10.37.0. Paths below are relative to Palate `mobile/node_modules/` and are primary implementation evidence, read locally without live documentation calls.

- `@sentry/react-native/dist/js/sdk.js`: lines 57–65 derive native enablement and gate scope synchronization; around 99–112 the explicitly supplied transport wins over native/fetch defaults. Using Browser's installed fetch transport matches the native-disabled transport implementation exported through React; no dependency install is required.
- `@sentry/react-native/dist/js/wrapper.js:119–131`: false native enablement returns before bridge initialization. This is not a shutdown of an already-running independent native SDK.
- `@sentry/react-native/dist/js/client.js:25–30`: RN itself sets `infer_ip` from `sendDefaultPii`; around 106–118 its `beforeEnvelope` hook precedes `_transport.send`, so the configured transport wrapper is after that hook.
- `@sentry/react-native/dist/js/integrations/rewriteframes.js`: canonical Expo bundle names and Hermes column adjustment precede filtering. The filter preserves, rather than re-adjusts, prepared coordinates.
- `@sentry/react-native/dist/js/integrations/reactnativeinfo.js`: runtime engine and Hermes debug-info flag are diagnostic inputs; existing event context can override integration-provided context, so the filter's enum/boolean validation is not proof of trusted provenance.
- `@sentry/core/build/cjs/utils/prepareEvent.js:94–98,150–196`: processor-stage debug IDs move into `debug_meta.images` before beforeSend.
- `@sentry/core/build/cjs/client.js:467–477,577–578,807`: event/envelope hooks and the internal-event bypass confirm that beforeSend alone is not the final boundary. The candidate tests also exercise the feedback bypass rather than assuming it is covered.
- `@sentry/browser/build/npm/cjs/dev/transports/fetch.js`: real `makeFetchTransport` delegates serialization/buffering/rate-limit handling to Core `createTransport`, and accepts the fetch implementation supplied by the independent runner. All recorded requests use `example.invalid` and stay in memory.

## Collection versus egress and diagnostic tradeoffs

**CODE:** Do not strengthen the report into “all collection/instrumentation disabled.” In `integrations/default.js`, a numeric `tracesSampleRate`, including zero, still activates the SDK's `hasTracingEnabled` configuration branch; with the defaults, JS stall/automatic tracing/time-to-display integrations can be installed. Replay integration selection also checks whether numeric replay options exist, even when they are zero. Native enablement and zero sampling constrain their behavior, and the final transport refuses their non-event item types. The demonstrated guarantee is the configured **JS envelope policy**, not absence of transient instrumentation or in-memory data. No extra configuration changes were silently added for this distinct scope.

**WORKING TREE:** The transport can turn an ID-bearing, type-undefined payload into a generic message event even if it originally contains no error/message. It does not strictly require an original ordinary error/message body. This is harmless to the tested freeform-data policy, but “ordinary payload only” should describe intended usage rather than a structural gate enforced here.

**INFERENCE:** Actual native crash reporting, native cache/offline delivery and native images are intentionally unavailable through this prototype. Previously queued native data is not erased. Unknown/web/multi-bundle filenames are stripped, and removing release/dist also removes their potential fallback for source maps. A representative built app with matching uploaded artifacts would settle device/server compatibility; it was not invoked for this task.

**WORKING TREE / limits:** Allowed UUIDs, event IDs, numeric coordinates/timestamps and short database codes can encode data and are shape-checked, not authenticated against a trusted artifact manifest. This patch is not a general JavaScript-object sandbox, protection against hostile executable hooks making their own requests, anonymity from the endpoint, or a policy for other clients/transports. The DSN/configured URL and ordinary network metadata still exist; fixed infer_ip requests an SDK policy rather than proving receiver behavior.

## Execution evidence

- **WORKING TREE / RUN:** Candidate's original 51 tests pass while the eight new regressions fail: `CANDIDATE_JEST_NEGATIVE.log` reports **51 passed / 8 failed**. The first discovery run selected two real test paths and one mistakenly named path; it yielded 46 passes plus ENOENT. This was corrected to the actual unchanged `observability-normalise.test.ts`, copied into scratch so Jest discovers the symlinked baseline test.
- **WORKING TREE / RUN:** Candidate plus follow-up: **59/59 tests in 3 suites**, `FIXED_JEST.log`. Includes original 38 privacy, 8 resilience, 5 normalization tests and 8 new validation tests.
- **WORKING TREE / RUN:** Separate actual Browser-fetch/Core-serialization controls: candidate **3 passed / 8 failed**; fixed **11/11 passed**. Positive control intentionally serializes the sentinel without the filter. Guarded controls retain both bundle/debug identities while excluding it. See CANDIDATE_CONTROLS.log and FIXED_CONTROLS.log.
- **WORKING TREE / RUN:** Full scratch-mobile `tsc --noEmit --incremental false`: exit 0, TSC.log empty. Tests are excluded by the app tsconfig but executed by Jest.
- **WORKING TREE / RUN:** Original base + author patch + follow-up matches tested mirror; follow-up `git apply --check` succeeds against main's newly applied author state. Source hashes attached.

Reproduce the independent transport controls from this workspace:

```sh
/opt/homebrew/bin/node outputs/palate-observability-independent/independent-controls.cjs work/obs-independent/mobile/lib/observability-privacy.ts
```

No repository writes, permissions, package installation, native/device execution, production event inspection, Sentry dashboard, external API, deployment or paid cap change occurred. Recommended integration is the two-file follow-up plus its durable regression tests; retain the original report's device/server limits and the narrower collection language above.
