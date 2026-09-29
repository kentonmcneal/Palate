# Independent observability diagnostics review — 2026-09-29

**WORKING TREE / local execution:** imports and canonical Expo filenames are compatible with the installed dependency tree. The primary remaining diagnostic risk is source-map **identity production**, not the transport's preservation of an identity already supplied. Recommend resolving that gap before claiming symbolication is preserved. Native-disabled documentation is appropriately bounded. No repository changes or device/live-service verification occurred; adversarial privacy review remains Mendel's scope.

## Findings

**WORKING TREE — high-impact source-map coverage gap.** The patch removes release/dist, runtime function names, and all but two canonical bundle names. Debug IDs become the only retained artifact discriminator. Its Core pipeline test supplies `frame.debug_id` with a synthetic event processor. Palate has no Metro configuration, while the installed Sentry Expo config plugin handles native build/upload configuration and does not install the Sentry Metro serializer plugin.

**WORKING TREE / local execution — concrete reproduction:** invoking installed Expo's `baseJSBundle` with a debug ID produces a `//# debugId=...` comment. Executing that synthetic generated output does **not** populate `_sentryDebugIds`. Invoking installed Sentry's `unstableBeforeAssetSerializationDebugIdPlugin` creates a virtual module which **does** populate that registry. These are distinct mechanisms. A no-debug-ID error through the proposed filter retains coordinates but loses both `release` and `dist`; neither `debug_meta` nor release-based artifact identity remains.

**INFERENCE — shipped impact:** this demonstrates an untested/default-serializer failure mode, not proof that a specific shipped bundle lacks injection. Native build tooling may transform the final bundle; current EAS artifacts, OTA bundles, and uploaded maps were not inspected. Obtain a final build/OTA artifact demonstrating runtime debug-ID injection and a matching source-map ID, or explicitly configure and test the installed Sentry Metro integration. Do not merely add another manually injected debug-ID fixture. Adding `getSentryExpoConfig(__dirname, { injectReleaseForWeb: false })` is a concrete candidate for a separate reviewed Metro change; it is not bundled or certified here. Its serializer/bundle output must be checked for both platforms and the project's export path without uploading anything.

## Compatibility controls

**WORKING TREE / local execution:** RN SDK **7.11.0** pins Browser and Core **10.37.0**; those exact versions exist in node_modules and package-lock. `@sentry/browser.makeFetchTransport` resolves and executes. Browser/Core are transitive dependencies, not direct entries in mobile/package.json. This is not an immediate missing-dependency failure under the current npm lock/hoisting layout. A stricter future package manager or SDK change should either declare these direct imports explicitly at compatible versions or reconsider the boundary; no installation or manifest change was made.

**WORKING TREE / local execution:** actual installed `createReactNativeRewriteFrames` processes six synthetic inputs: iOS/Android × hashed `.hbc`, `address at ...main.jsbundle`, and a Metro URL. With the SDK's Expo/Hermes environment predicates supplied as true, output filenames match `app:///main.jsbundle` and `app:///index.android.bundle`; column 407 becomes 408 once. The proposed filter preserves those coordinates and names. The test calls the actual integration rather than reimplementing its regex. Environment predicates are simulated, so this does not verify their value on a device.

**WORKING TREE / local execution:** the actual installed Browser fetch transport, with an injected memory-only fetch function, serializes the wrapped event and retains canonical frame coordinates plus its supplied sourcemap debug ID. No network request occurs.

**WORKING TREE:** non-Expo/custom bundle filenames, split chunks and web bundles are not generally retained by this filter. That limitation is already disclosed and should remain explicit. Do not generalize the six Expo controls to those formats.

## Native-disabled documentation

**WORKING TREE:** `enableNative:false` causes installed SDK initialization to bypass native scope synchronization and native initialization; the JS fetch transport is the intended fallback. Default integrations still include React Native JS error handlers, ReactNativeInfo and RewriteFrames. Disabling native therefore does not mean disabling every uncaught JS diagnostic.

**WORKING TREE:** no native crash/ANR coverage or native disk-backed offline transport is supplied by this initialization. Sessions, profiling and other envelope types are deliberately absent, and release/environment-based deployment diagnostics are reduced. The supplied report accurately states that historical native queues and an independently initialized native SDK are not erased/disabled. It also correctly avoids claiming delivery from SDK acceptance. Keep these caveats; neither installed-source inspection nor these tests verifies a binary's independent initialization or queue state.

## Results and limits

**WORKING TREE / local execution:** **11/11 independent diagnostic controls pass** (`diagnostics.cjs`, `DIAGNOSTICS.log`). Some passing controls intentionally prove the missing-registry/no-fallback limitation. Independently reran the proposed privacy/resilience/normalization suites in a separate scratch mirror: **51/51 pass, 3 suites** (`REGRESSION.log`). This rerun is regression evidence, not a competing adversarial privacy sign-off. Initial mirror setup lacked the module targeted by the repository's global Supabase mock; copying that source into the mirror allowed the unchanged mock to resolve. No service code was executed.

**INFERENCE / unverified:** actual Metro app export, Hermes compilation, artifact uploads, server symbolication, RN fetch on a handset, SDK fatal-error flushing during process death, and device behavior. No build, installation, permission request, paid/live call, source edit, or device access occurred. Review applies to the supplied additive output patch; local HEAD during review was `5ea8b2f`, not a claim that the output patch is committed.

Reproduce from the projectless workspace:

```sh
/opt/homebrew/bin/node outputs/palate-observability-independent/diagnostics.cjs
/opt/homebrew/bin/node '/Users/kentonmcneal/Claude Code/Palate/mobile/node_modules/jest/bin/jest.js' --config outputs/palate-observability-independent/jest.config.json --runInBand
```
