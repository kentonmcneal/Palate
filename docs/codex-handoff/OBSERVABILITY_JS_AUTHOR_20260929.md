# Bounded JavaScript observability correction

**WORKING TREE / local execution:** additive patch against main's current four-file prototype, held unchanged during this implementation. The application repository was only read. No native SDK initialization, service request, paid call, dependency installation, build, deployment, or production payload was used.

Apply `observability-js-privacy.patch` on top of the current prototype, not instead of it. It changes exactly:

- `mobile/lib/observability.ts`
- `mobile/lib/observability-privacy.ts`
- `mobile/lib/__tests__/observability-resilience.test.ts`
- `mobile/lib/__tests__/observability-privacy.test.ts`

The baseline/proposed copies and SHA-256 manifest are included. `git apply --check` passed against the working tree at HEAD `854cd8c7075755a1dfcc0ec7c1fb5eb86fc3d7c7`.

## Changes

**WORKING TREE:** configuration explicitly sets `enableNative:false`, `enableNativeCrashHandling:false`, `enableAutoSessionTracking:false`, `enableLogs:false`, `enableMetrics:false`, `profilesSampleRate:0`, and `sendClientReports:false`. Existing trace/replay/screenshot/view-hierarchy exclusions remain. The installed browser fetch transport is reused, as in RN's native-disabled default path; no new dependency is installed.

**WORKING TREE:** the event filter preserves the exact canonical RN identities `app:///main.jsbundle` and `app:///index.android.bundle` (and maps only their exact bare forms to these identities). It retains line/column numbers, in-app booleans, bounded exception categories/mechanisms, UUID-shaped sourcemap debug IDs, validated event IDs/timestamps/levels, fixed JavaScript platform, and the `hermes`/`jsc`/`v8` engine enum. `hermes_debug_info` survives only as a boolean for Hermes. Unknown paths, arbitrary basenames, runtime function names, source context, native image records, component stacks, and unknown debug-image properties are omitted.

**WORKING TREE:** event-supplied SDK, release, dist, environment and arbitrary metadata are omitted. No application build metadata is added: the source-map debug IDs are the retained artifact identity. The sole reconstructed SDK payload field is the constant `sdk.settings.infer_ip:"never"`. Installed RN uses this setting to express its no-IP-inference policy; neither SDK name/version nor application release metadata is copied from the event. The normal SDK transport URL/configuration still exists; this is not anonymity from the receiving network service.

**WORKING TREE / local execution:** a final transport wrapper permits only `event` items with a valid event ID and an ordinary JS error/message payload. It reconstructs event payloads again after Core processors/hooks, strips all attachment and non-event items, and reconstructs envelope/item headers. It drops feedback rather than relying on `beforeSend`, which the installed SDK bypasses for feedback. Internal error events that bypass `beforeSend` still receive the final filter. A late `beforeEnvelope` hook cannot reintroduce the tested metadata or attachments through this transport. Unsupported/malformed/empty envelopes are not forwarded; SDK acceptance is still not delivery confirmation.

**WORKING TREE:** `reportError` no longer places arbitrary context or normalized extras into SDK scope. Breadcrumb helper calls are no-ops before entering SDK memory. `toError` retains its existing local API and normalization tests, but its documentation now distinguishes local fields from deliberately withheld remote payloads.

## Validation

**WORKING TREE / local execution: 51/51 tests passed in 3 suites**, with `/opt/homebrew/bin/node`, installed Jest, no real transport:

- **38 privacy tests:** canonical filenames and unknown-path rejection; debug IDs; strict metadata/position/engine validation; malformed inputs; actual SDK event preparation and transport serialization; feedback/internal bypass cases; late hook mutations; 18 unsupported envelope types; malformed transport inputs.
- **8 resilience tests:** concurrent/retry initialization, contained capture failures, test-event acceptance, required disabled-channel options, no raw extras/breadcrumbs entering scope, and actual init-to-guarded-transport wiring.
- **5 unchanged normalization tests:** existing local `toError` behavior remains compatible.

The envelope regressions use installed Sentry Core `Client` **and** `createTransport`, with a memory-only request executor. Core merges scope/hint attachments, applies its actual `beforeSend` bypass behavior, prepares debug metadata, constructs envelopes, and serializes request bodies. A test processor supplies a synthetic bundle debug ID at the integration stage; Core performs its real transfer into `debug_meta.images`. The assertions inspect the serialized bodies, including preserved code-file/ID/coordinates and fixed `infer_ip` policy. The unfiltered positive control serializes the synthetic private sentinel; the guarded controls exclude it. No claim of actual bundle upload or server symbolication is made.

**WORKING TREE / local execution negative control:** restoring the original two production modules in the scratch mirror while retaining the final tests yields **38 failed, 13 passed**. These include expected missing-transport/API contract failures, not 38 independent security findings. Proposed source was restored afterward.

**WORKING TREE / local execution:** full scratch-mobile `tsc --noEmit --incremental false` passed. The project excludes tests from TypeScript checking; Jest executes them. The first typecheck identified a union-of-envelope-items typing issue; the final implementation uses typed `EventItem[]` and refuses invalid/missing event IDs before constructing the event envelope.

Logs: `jest.log`, `baseline-red.log`, `tsc.log`. Installed versions: React Native SDK 7.11.0; Core and Browser 10.37.0. `jest.config.json` points to this workspace's copied-source mirror and isolated cache.

## Limits and diagnostic tradeoffs

- **INFERENCE — shipped/native boundary unverified:** these init options bound this JS initialization. They do not remove previously queued native envelopes or disable a native SDK independently initialized by the host binary. A representative device capture and binary initialization review would settle that separate boundary.
- **INFERENCE — source-map lookup unverified:** the local regression proves Core-prepared debug IDs and canonical filenames survive serialization. Actual uploaded build artifacts and a matching dashboard event are needed to prove server symbolication. Release/dist fallback and nonstandard/web/multi-bundle code paths are deliberately not restored without a reviewed artifact manifest.
- **WORKING TREE:** UUID/event-ID/numeric validation is structural, not proof of trusted origin or absence of covert data in allowed structured values. Engine enum validation similarly proves shape, not runtime provenance. No blanket “all data is private” or “all Sentry channels are filtered” claim is made.
- **WORKING TREE:** the final guard covers envelopes sent through this configured JS transport. Another client, direct network code, independently initialized native transport, or historical cache is outside it. Browser/native internals are not live-tested here. Feedback, sessions, logs, profiles and other item types are unsupported by design.
- **WORKING TREE:** generic messages, omitted function names and release metadata can reduce grouping/detail. Structured database codes, exception class/mechanism, positions, canonical bundle identity and debug IDs remain. The existing ten-exception/100-frame bounds remain. No native crash reporting or native offline transport is provided by this prototype.
- **WORKING TREE / local execution:** all payloads are synthetic. No credentials, environment files, user events, Sentry dashboard, paid service, or device was accessed.
