# Independent review: Metro debug-ID production

## Verdict

**WORKING TREE / independently executed local artifact gates:** no actionable correctness or privacy regression found in `METRO_DEBUG_IDENTITY_20260929.patch`. Approve its bounded production configuration and artifact test for integration. No corrective code patch needed.

This approval covers the supplied real iOS/Android JS exports and real iOS/Android Hermes compiled artifacts with the installed packages. It is not approval of source-map publication or evidence of native runtime execution, OTA packaging, uploaded artifact matching, ingestion, or server symbolication.

**COMMITTED / source baseline:** main HEAD was `ff4980c` during review. Main placed both proposed files in its working tree during this review. Their bytes match the proposed output files exactly (`CURRENT_PATCH_MATCH.json`); reverse apply-check passes. Forward apply-check now correctly reports that the new files already exist. This worker wrote only projectless work/output files.

## Independent execution

**WORKING TREE / RUN:** executed the delivered artifact gate with all six path arguments, including both Hermes exports and the default iOS control. **9/9 PASS**, exit 0. No identity was supplied to replace a missing runtime ID.

| Actual artifact | ID independently verified |
| --- | --- |
| iOS plain JS | `ff1819b7-4c23-4fd9-97a4-b373840971eb` |
| Android plain JS | `8aa873e5-9c0b-49dc-a160-8c962b0e9b37` |
| iOS default control | `7aceb401-fc4b-4be8-aa7d-5ea475041507` — comment/map present; runtime registry absent |
| iOS Hermes | `a6ffd90d-a371-463b-9762-fefaf4da4436` |
| Android Hermes | `ec003a5a-7d76-475b-9d6f-211636abc12d` |

**WORKING TREE / RUN:** independently written `independent-artifacts.cjs` also passes. It verifies:

- All five bundles/maps match the author's recorded SHA-256 hashes.
- All maps are version 3 with nonempty mappings and more than 2,000 sources; they contain the real root and both observability modules.
- Embedded `_layout.tsx`, `observability.ts`, and `observability-privacy.ts` contents match current main in all five maps; package/package-lock/app/Babel/observability input hashes match the recorded snapshot.
- Both Hermes files have real Hermes bytecode magic, the registry identifier, and their corresponding map UUID; composed maps have Hermes function offsets. This does not execute the bytecode.
- The actual installed Sentry Expo configuration, with the disclosed scratch watch-folder overrides, preserves Expo's actual transformer path, middleware implementation, serializer presence, asset extensions, and source extensions. It excludes both replay package names through the actual resolver.

The delivered artifact gate's small empty-base-config branch is a bounded options/plugin-registration check. It is **not** the source of production identity evidence. That comes from execution of the real emitted JS prelude and inspection of the actual compiled artifacts. The additional independent configuration check instantiates the real installed Expo default factory.

**WORKING TREE / RUN:** all **59 tests / 3 suites** pass for `observability-normalise`, `observability-privacy`, and `observability-resilience`, run in the copied mobile tree. These include actual Core/Browser in-memory envelope serialization, debug metadata retention, attachment and metadata removal, feedback/internal-event bypass filtering, and initialization-option regression checks. Native SDK initialization is mocked in the initialization suite; the actual Core/Browser envelope tests are not native SDK execution.

Both proposed JavaScript files pass Node syntax checks. No application source files changed during this review, so no new application TypeScript claim is attached to this configuration-only review.

## Installed-code reasoning

**COMMITTED dependencies / inspected installed code, corroborated by WORKING TREE exports:**

1. `@sentry/react-native/dist/js/tools/metroconfig.js:getSentryExpoConfig` passes the debug-ID plugin into Expo's `unstable_beforeAssetSerializationPlugins`. With `injectReleaseForWeb:false`, it omits the release-constants plugin. Component annotation and development source-context wrappers are conditional and remain uninstalled for the supplied false options. The LogBox frame-collapse wrapper is still installed; this is local development presentation, not collection or transport.
2. `sentryMetroSerializer.js:unstableBeforeAssetSerializationDebugIdPlugin` consumes the **Expo-provided** ID and prepends the registry module. It does not generate an unrelated runtime UUID. The plugin skips absent IDs and avoids duplicate debug modules.
3. `@expo/metro-config/build/serializer/serializeChunks.js` computes the debug ID, runs the supplied plugins, includes final premodules in code **and** mapping generation, and attaches the same ID after Hermes map composition. The actual artifact checks corroborate the UUID relationship rather than relying only on those branches being present in source.
4. Installed Core's `prepareEvent.js` obtains mappings from the generated registry and applies them before the final event/debug metadata pipeline. The artifact gate lets Core derive `debug_meta`, then inspects the actual serialized in-memory envelope after the production privacy transport. No event processor invents the ID for this gate.
5. Installed RN `integrations/rewriteframes.js` canonicalizes Expo native frames to `app:///main.jsbundle` and `app:///index.android.bundle`, the two identifiers permitted by the production filter. The artifact VM uses representative canonical filenames, not observed device stack strings. That limitation is correctly disclosed by the author.

## Privacy assessment

**WORKING TREE / inspected code and local tests:** the four Metro flags have the stated bounded effects:

- `injectReleaseForWeb:false`: does not add Sentry's web release-constant prelude.
- `includeWebReplay:false`: actual resolver excludes replay packages.
- `annotateReactComponents:false`: no Sentry annotation transformer is substituted.
- `enableSourceContextInDevelopment:false`: no Sentry development source-context middleware wrapper is installed.

The existing runtime JS-only initialization options are unchanged, as are native-disable, auto-session/log/metric/profile/replay settings and the final transport filter. The runtime registry necessarily contains locally generated error-stack text; it is not itself an outbound payload. Current transport retains only canonical code-file mappings and validated UUIDs, not the registry's freeform stack text, runtime function names, event-supplied SDK identity, release or dist. In-memory envelope regressions remain green.

These flags do not make source maps public-safe, remove Expo's own metadata, disable independently initialized native SDKs, or certify other transports. No blanket all-channel privacy claim is justified or made here.

## Execution boundary and evidence limits

**WORKING TREE / RUN:** used the existing isolated author's export artifacts. Did not re-export the whole app; re-executed the artifact gate and independently checked the bytes/configuration/source contents. Full export logs remain the author's execution evidence. These artifacts are actual app exports, not a synthetic single-module graph.

All independent Node runs used an allowlisted environment with dotenv/public environment loading disabled, offline/telemetry/upload guards, and the inspected Node preload blocking HTTP(S), sockets/TLS and global fetch. The Sentry transport tests use in-memory request executors. No uploader, cloud service, account operation, secret file, dependency installation, or live event was invoked.

**INFERENCE / explicitly unverified:** JS VM execution stops at the unavailable React Native bridge after the registry prelude. Hermes tests establish compiled presence and map agreement, not runtime registration on Hermes. Neither test proves a real device stack maps to the right source line, that artifacts have been uploaded, or that server symbolication succeeds. Web export/runtime behavior, development bundle identity, split bundles, and alternate build configurations are outside the tested artifact set. The current gate intentionally requires one native main bundle per platform.

The author report already states these limits; they do not block this bounded configuration change.

## Reproduction and deliverables

- `ARTIFACT_GATE.log`: independently rerun nine-check output, including generated IDs and hashes.
- `INDEPENDENT_ARTIFACTS.log` / `INDEPENDENT_EVIDENCE.json`: separate configuration, artifact, map, and embedded-source checks.
- `PRIVACY_TESTS.log`: 59 passing observability regressions.
- `CURRENT_PATCH_MATCH.json`: exact match of main's newly added working files to the proposal.
- `independent-artifacts.cjs`: reproducible additional review checker (workspace artifact, not a proposed product change).

Use the command in the author's report for `metro-debugid.test.cjs`, supplying `gate-mobile`, `ios-export`, `android-export`, `ios-baseline`, `ios-hermes`, and `android-hermes`. The independent checker accepts `MOBILE_REPO_ROOT WORK_EXPORT_ROOT REVIEW_OUTPUT_ROOT`. Keep the same offline environment and network-denial preload when repeating local checks.
