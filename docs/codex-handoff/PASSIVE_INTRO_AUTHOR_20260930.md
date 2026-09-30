# Passive intro journey — ready for independent review

WORKING TREE proposal in copied source only. Targets findings 1/2/5 of `outputs/palate-journey-review/REVIEW.md`. Base repository HEAD was 2fd0e53; the copied passive-capture.ts includes main's working-tree, independently reviewed consent/start-stop candidate (hash in HASHES.json). No core helper, native, backend, configuration, or repository edits. Main-reported LIVE release facts are accepted as context, not independently verified here; no deployment or services were invoked.

## Deliverables and integration

Apply `PASSIVE_INTRO_JOURNEY.patch` additively. Five production files: passive-capture-intro.tsx, onboarding/why-location.tsx, visits.tsx, ProfileBody.tsx, settings.tsx. The last four are copy-only. One new durable test: mobile/lib/__tests__/passive-intro-journey.test.tsx. Source copies are provided for inspection, **not wholesale overwrite**. Read-only `git apply --check` succeeded against main's working tree (APPLY_CHECK.log). HASHES.json records before/after bytes and unchanged core helper.

## Behavior

The intro now distinguishes real StartResult outcomes:

| Outcome | Presentation / action |
| --- | --- |
| started | “Background checks started”; suggestions may miss stops, and reminders depend on permission/delivery. No guarantee of a future prompt or automatic diary entry. |
| flag-off | Saved preference, checks did not start, feature temporarily unavailable; explain later resume eligibility and Settings opt-out. |
| native-module-unavailable | Saved preference, unsupported build, check for an update; no promise that an update exists or automatically fixes it. |
| no-always-permission | Saved preference but checks did not start; phone Settings plus explicit retry. |
| not-opted-in | Start cancelled or consent off; no claim of saved active consent. Retry calls only start, never setPassiveOptIn(true). |
| thrown / uncertain | Distinguishes confirmed consent-write completion from unknown setup. No silent dismissal or false success. A partial consent/timestamp write is explicitly uncertain. |

One synchronous operation ticket prevents duplicate enable/repair/retry sequences. Focus cleanup invalidates UI continuations; each awaited permission/consent/start step checks its ticket. Old finalizers cannot clear new busy state after blur/refocus. Returning from phone Settings does not enable anything automatically. Opening Settings failure is handled. Initial permission repair requires an explicit “Check permission and enable” action; retry after a start result never rewrites consent.

Not now and denied foreground permission preserve manual continuation and next-route behavior. Busy controls are disabled; leaving by external navigation suppresses future intro continuations but is not itself an opt-out. Consent already persisted and core start already dispatched remain owned by the core helper, not revoked by screen cleanup. The root account-unmount boundary is assumed, not reimplemented or newly proven here.

The explicit product sequence is possible stop → user confirmation → diary visit. Dish details are optional; location is not evidence of an order. Mounted assertions cover both disclosures.

Copy separates foreground checks from optional background suggestions, includes coffee, and consistently reserves “diary visit” for confirmed/manual entries. Expanded intro disclosure explicitly allows pre-confirmation server/provider location lookup and syncing suggested-place/detection metadata. Removed “location never leaves”, “nothing is saved”, guaranteed home/work filtering, exact iOS timing, and automatic logging promises. No assertion about retention, all-channel privacy, native stop completion, or perfect detection is added. Product/privacy review should also align policy/native permission strings separately; those are outside this five-file patch.

## Executed offline evidence

* FOCUSED_CANDIDATE.log: **18/18 mounted controls pass**, actual installed React/react-test-renderer 19.2.3, copied actual intro/why-location, actual passive-capture and passive-permissions helpers. UI primitives, router, analytics, notifications, OS/native, flags and AsyncStorage are mocked; network forbidden. These tests do not merely mock StartResult.
* FOCUSED_BASELINE.log: original intro against the **same current core helper** gives **16 fail / 2 pass**. Failures include expected new copy/state assertions as well as reproduced double admission, late permission writes, swallowed failures and missing safe retry; not all 16 represent different runtime defects. The two unchanged controls are Not now and denied foreground continuation.
* TSC.log: copied mobile tree `tsc --noEmit` **exit 0**, with installed dependencies and current modified files. No native build or installation.
* Exact cases: successful start despite notification denial; flag-off; missing native; permission revoked during flag await; opt-out during flag await plus retry; flag recovery without consent/timestamp rewrite; failed consent write; failed first timestamp write; native start throw; same-tick repeat; unmount continuation; blur continuation; old completion/new operation ownership; disclosure + foreground distinction; return from phone Settings without implicit enable; failed Settings link recovery; Not now; foreground denial.

Use `node node_modules/jest/bin/jest.js --runInBand --watchman=false --runTestsByPath lib/__tests__/passive-intro-journey.test.tsx` in mobile after integration, plus normal tsc. During scratch verification a broad test-name filter also matched the scratch directory and selected unrelated copied suites; that run was interrupted and is **not** full-suite evidence. The final logs use explicit test paths. No new dependencies.

## Boundaries

No DEVICE evidence: actual prompt timing, provisional permission behavior, background delivery, VoiceOver/layout and monitoring stop require device validation. Tests render actual screen logic using host primitive mocks, not physical native UI. Copy-only diary/profile/settings changes are source-reviewed and type-checked, not separately mounted here. No digest save/recovery work (findings 3/4), passive detector changes, paid resolution, ownerless capture migration, cold-restart consent guarantees, or server release work is included.
