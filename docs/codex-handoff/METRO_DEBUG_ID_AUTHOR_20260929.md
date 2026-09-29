# Palate Metro source-map identity production — 2026-09-29

## Result

**WORKING TREE / actual offline exports:** The proposed installed Sentry Expo Metro integration produces a runtime `_sentryDebugIds` registry and matching source-map ID for **both iOS and Android**. Installed Sentry Core consumes those generated registry values and the current privacy transport preserves the resulting canonical bundle/debug-ID mapping. No manually supplied frame debug ID or synthetic serializer graph establishes this result: the IDs come from exported app artifacts.

The default-config negative control is an actual iOS app export: Expo emits a debug-ID comment and map ID, but executing the emitted prelude does not create the Sentry runtime registry. This reproduces the production-identity gap identified in Laplace's diagnostic review.

**WORKING TREE / actual offline Hermes compilation:** Both normal Expo Hermes exports also succeed. Each emitted `.hbc` contains the registry identifier and the exact debug ID in its composed `.hbc.map`. These are local JavaScript/bytecode exports, not EAS builds, Xcode builds, native binaries, installed apps, uploads or server-symbolication tests.

## Patch and exact scope

`METRO_DEBUG_IDENTITY_20260929.patch` adds only:

1. `mobile/metro.config.js` — `getSentryExpoConfig(__dirname, { injectReleaseForWeb: false, includeWebReplay: false, annotateReactComponents: false, enableSourceContextInDevelopment: false })`.
2. `mobile/scripts/metro-debugid.test.cjs` — durable artifact/configuration gate using the installed SDK and supplied export directories.

No package changes, uploader, account operation, source-map upload step, telemetry hook, native project change or observability-filter widening is added. The Expo config plugin already present in app.json is unchanged. Existing native upload/build configuration is not globally rewritten; upload disabling below applies explicitly to these isolated runs. Main retains control of future release workflows.

**RUN:** Node syntax checks pass for both added files. Read-only `git apply --check` passes against the repository, which still has no Metro config. Key app/config/dependency/observability hashes match the snapshot (INPUT_HASHES.json). Other agents' unrelated uncommitted work was preserved; no repository file was written.

## Actual exports and generated IDs

| Output | Generated debug ID | Evidence |
|---|---|---|
| iOS production-mode plain JS | `ff1819b7-4c23-4fd9-97a4-b373840971eb` | Runtime registry value = bundle comment = map `debugId`; Core-derived event mapping survives final transport. |
| Android production-mode plain JS | `8aa873e5-9c0b-49dc-a160-8c962b0e9b37` | Same executed registry/map/transport checks. |
| iOS default-config control | `7aceb401-fc4b-4be8-aa7d-5ea475041507` | Map/comment exist; runtime registry absent. |
| iOS Hermes bytecode | `a6ffd90d-a371-463b-9762-fefaf4da4436` | Compiled bytecode contains this ID and `_sentryDebugIds`; composed map carries the same ID. |
| Android Hermes bytecode | `ec003a5a-7d76-475b-9d6f-211636abc12d` | Same compiled-artifact/composed-map check. |

**WORKING TREE:** These are distinct artifacts, so a plain-JS export's ID need not equal the bytecode export's ID. The gate checks each corresponding pair, not equality across different output formats. Current Expo maps use `debugId` rather than a duplicate `debug_id` field; the gate accepts either and checks consistency if both occur.

Installed versions: Expo 57.0.7, Expo Metro config 57.0.6, Metro 0.84.4, Sentry RN 7.11.0, Core/Browser 10.37.0. Actual router app export module counts were 2,571 iOS and 2,662 Android for the plain-JS runs. Maps include actual `app/_layout.tsx` and both observability production modules. This was not a one-module app standing in for Palate.

Full byte hashes, actual scratch artifact paths and per-platform evidence are in ARTIFACT_EVIDENCE.json. Full app bundles/maps stay under the workspace's `work/palate-metro-debugids/` directories; the review outputs contain the patch, tests, reports, hashes and command logs rather than another copy of all application source-map contents.

## What was executed

**WORKING TREE / RUN:** Nine durable checks pass (ARTIFACT_TESTS.log):

- Production Metro options disable the four unrequested additions and register the installed debug-ID serialization plugin.
- The actual configured resolver maps both Sentry replay package names to empty for web and delegates ordinary modules; no annotation transformer or source-context middleware is added to the supplied base config.
- For each native platform, execute the **actual generated plain-JS bundle** in an isolated Node VM with a representative canonical Expo bundle filename. Its generated prelude creates the registry; registry value, trailer comment and map ID agree.
- Feed the emitted registry into installed Core, use the actual Browser stack parser and a synthetic error at that canonical code file, then inspect the actual Browser-fetch/Core-serialized body recorded by an in-memory executor. Core itself produces debug_meta; no event processor inserts the ID. The current privacy filter retains the mapping and fixed infer-IP policy while omitting release/dist.
- Execute the actual default-config iOS export and confirm no registry was produced despite its map/comment ID.
- For each compiled Hermes artifact, compare its embedded generated ID against the composed map and verify the registry identifier is present.

The VM stops when React Native requires its unavailable native bridge (`__fbBatchedBridgeConfig`). The debug prelude runs before that stop. This is execution evidence for registry production, **not app boot or native crash verification**. The canonical filenames and event location are representative test inputs; actual Hermes stack formatting and device initialization remain unverified.

Core caches registry mappings by entry count. The durable test accumulates the genuinely generated entries while checking two platforms in one Node process, matching the registry's additive design; it does not replace one same-sized registry with another and mistake stale cache output for a platform failure. The initial test attempt exposed that test-harness issue; the final test retains both emitted entries without inventing IDs.

## Offline/no-secret execution boundary

**WORKING TREE / RUN:** Created a scratch project by copying only application source/asset/module directories and explicit non-secret config/package files. `.env*`, native build output, caches and dependency directories were excluded from that copy. Existing node_modules was linked read-only; no reinstall occurred. Expo was invoked with `/opt/homebrew/bin/node`.

The subprocess environment was a fresh allowlist, not the user's inherited environment. It contained:

- `EXPO_OFFLINE=1`, `EXPO_NO_TELEMETRY=1`, `EXPO_NO_TELEMETRY_DETACH=1`;
- `EXPO_NO_DOTENV=1`, `EXPO_NO_CLIENT_ENV_VARS=1`, `EXPO_NO_DEPENDENCY_VALIDATION=1`;
- `SENTRY_DISABLE_AUTO_UPLOAD=true`, `SENTRY_SKIP_AUTO_UPLOAD=true`, `SENTRY_CLI_NO_DOTENV=1`, `SENTRY_DISABLE_TELEMETRY=1`;
- an isolated temporary directory and Expo's installed `__UNSAFE_EXPO_HOME_DIRECTORY` setting pointed at empty workspace storage, avoiding the user's Expo account/settings cache; HOME was not repurposed;
- a Node preload that throws on HTTP(S), socket/TLS connections and global fetch. This preload also reaches spawned Node workers via NODE_OPTIONS.

The supported Sentry native build upload gate `SENTRY_DISABLE_AUTO_UPLOAD=true` was confirmed in installed scripts; no uploader or native upload script was invoked at all. The extra skip/telemetry variables are defense in depth, not a claim that every installed tool recognizes every name. Sentry Metro's inspected tools perform local serialization and contain no telemetry path; Expo's installed telemetry code explicitly returns early for offline/no-telemetry.

No environment secret file, user event, auth token, real Sentry endpoint, Google endpoint, EAS command or Xcode command was accessed. Source maps inherently contain source text and local build-path information; this task keeps them local and does not claim maps are safe to publish.

Scratch-only Metro settings add the real linked node_modules directory to watchFolders and disable Watchman. They make the external read-only dependency layout usable and avoid a daemon connection; they are **not included in the production patch**. The production integration/options are otherwise the tested ones. Hermes compilation uses the already installed local compiler, not a native project build.

## Release/web privacy review

**CODE / RUN:** Installed `@sentry/react-native/dist/js/tools/metroconfig.js` defaults `injectReleaseForWeb` to true and registers `unstableReleaseConstantsPlugin` before its debug-ID plugin. That release plugin's installed implementation constructs a `SENTRY_RELEASE` global from Expo app name/version for web. The proposal explicitly omits it. Both executed native plain-JS VM contexts also leave SENTRY_RELEASE undefined.

`includeWebReplay:false` uses the installed resolver to exclude Sentry replay packages. `annotateReactComponents:false` avoids introducing a Sentry annotation Babel transformer. `enableSourceContextInDevelopment:false` avoids adding Sentry's development source-context middleware. These flags keep the change focused on artifact identity; they do not promise that Expo's own application metadata is absent from bundles or that other libraries collect nothing.

**INFERENCE / unverified:** No web application export, browser boot or web symbolication was performed. The existing event allowlist still only retains the two canonical native Expo bundle names; arbitrary web/chunk filenames remain unsupported. Do not broaden that filter on the strength of the Metro option checks. No component names, release/dist values, arbitrary paths or freeform diagnostic fields were restored to event payloads.

## Reproduction

The delivered isolated runner takes the existing scratch work root and launches only the installed Expo CLI, with the controls above:

```sh
python3 outputs/palate-metro-debugids/ISOLATED_EXPORT_RUNNER.py "$PWD/work/palate-metro-debugids" export --platform ios --source-maps --no-bytecode --max-workers 2 --output-dir ../ios-export
python3 outputs/palate-metro-debugids/ISOLATED_EXPORT_RUNNER.py "$PWD/work/palate-metro-debugids" export --platform android --source-maps --no-bytecode --max-workers 2 --output-dir ../android-export
```

For Hermes, omit `--no-bytecode` and use `../ios-hermes` / `../android-hermes`. The default-config control used the same copied app with Expo getDefaultConfig alone plus the identical scratch watch settings; proposed config has since been restored. Logs: IOS_EXPORT.log, ANDROID_EXPORT.log, IOS_BASELINE_EXPORT.log, IOS_HERMES_EXPORT.log, ANDROID_HERMES_EXPORT.log.

The durable test accepts the source mobile directory and exported artifacts. In this workspace the small gate-mobile directory supplies the **exact production Metro config**, copied package.json and linked scratch observability source/dependencies:

```sh
/opt/homebrew/bin/node outputs/palate-metro-debugids/metro-debugid.test.cjs \
  "$PWD/work/palate-metro-debugids/gate-mobile" \
  "$PWD/work/palate-metro-debugids/ios-export" \
  "$PWD/work/palate-metro-debugids/android-export" \
  "$PWD/work/palate-metro-debugids/ios-baseline" \
  "$PWD/work/palate-metro-debugids/ios-hermes" \
  "$PWD/work/palate-metro-debugids/android-hermes"
```

After integration, use `mobile/scripts/metro-debugid.test.cjs` with `mobile` as the first argument and new isolated export paths. No fixed UUID is expected; each generated artifact supplies its own ID. Baseline/Hermes paths are optional as documented in the test. This is an artifact gate, not a source-text-only assertion.

## Acceptance boundary

**WORKING TREE:** This closes the demonstrated missing-runtime-registry mechanism for the tested installed Expo/Metro app export paths, including generated ID presence in compiled Hermes artifacts. Patch remains an author proposal for main/independent review.

**INFERENCE / explicitly unverified:** Executing the bytecode on a native runtime/device; shipped-binary initialization; OTA artifact packaging; source-map upload and retention; Sentry ingestion/Relay behavior; matching uploaded artifacts; server-side symbolication/grouping; human dashboard verification. None is implied by local export success. No broader native observability, web diagnostics, SDK privacy or all-build-configuration certification is made.
