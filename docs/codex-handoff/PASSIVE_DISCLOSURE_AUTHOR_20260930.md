# Passive disclosure audit — ready for review

**WORKING TREE / source-only.** Proposed three-file copy patch; no repository edits, runtime changes, version changes, builds, live calls or policy drafting. Landing and the externally hosted policy were excluded as requested. Hashes bind the inspected copy. The integrated intro already provides the more accurate disclosure.

## Exact mismatches

| Source | Current promise | Finding / proposal |
|---|---|---|
| mobile/app.json:20 | “only when the app is open”; “We never share or sell your location.” | Background capture contradicts the blanket foreground limitation; pre-confirmation server/provider lookup contradicts blanket non-sharing. Replace with purpose, possible transmission and separate optional background choice. No assertion that selling occurs. |
| mobile/app.json:21 | “sends one evening digest”; “Nothing late at night” | Unqualified delivery/timing guarantees exceed source evidence and OS control. Use “can send,” preferences and no delivery guarantee. Whether this custom plist key is displayed by iOS is not established. |
| mobile/app.json:22 | photos “only” for profile picture | Visit photo and feedback pickers also exist. Name profile, visits and feedback. Camera meal-photo wording is consistent with inspected camera callers; unchanged. |
| mobile/app.json expo-location plugin | detects a restaurant; disable anytime | Not itself a demonstrated falsehood, but omits background use and possible transmission. Align purpose with optional suggestions and confirmation. |
| mobile/app/onboarding/permission.tsx:79–95 | exact two-step iOS flow; “logs where you eat without you doing anything”; “you get one summary”; otherwise “typing every meal” | Permission timing is not guaranteed; passive detection is not a confirmed diary entry. Foreground discovery and manual entry remain available. Replace with optional background suggestions, fallibility, confirmation and qualified reminders. |
| mobile/app/onboarding/privacy.tsx:29–36 | “what shows up in any feed. All your call”; “Single visits, a week, or everything”; “Restaurants don't see your name or email” | Broad audience control and restaurant non-access cannot be certified from these controls, especially public sharing; no dedicated week-deletion control found. Use concrete profile/visit settings, existing individual/all-history/account deletion, and pre-confirmation lookup/sync disclosure. |

The onboarding no-sale/no-ad statements are **not proven false by this audit**; they are business-policy assertions that source review cannot establish. The proposal replaces that paragraph/row with verified product behavior rather than creating a new policy promise. Main may retain separately verified business commitments in the actual policy. This screen is not a complete privacy notice.

## Provider and confirmation evidence

- mobile/lib/passive-pipeline.ts:607–663: local cache first, then server catalogue lookup using raw stop latitude/longitude, then nearbyRestaurantsDetailed fallback. Cache/catalogue use can reduce paid requests; it does not establish on-device-only processing.
- mobile/lib/places.ts:60 and following: nearby lookup forwards location to the places-proxy boundary.
- supabase/functions/places-proxy/index.ts:312–332: source shows spendGoogle and locationRestriction coordinates. This is evidence of a possible paid provider request, not evidence that a particular request was sent, a deployed budget is effective, or a hard account-wide cap exists. No field masks, prices, caching or admission paths changed.
- mobile/lib/passive-inbox-sync.ts:53–96: mirror includes place identity/address, detection time, dwell, accuracy, confidence and cluster metadata. Raw stopLat/stopLng are deliberately absent, but that omission does not make all earlier location handling local or prevent pre-confirmation sync.
- mobile/app/feedback.tsx:33, app/edit-profile.tsx:107, components/PhotoPrompt.tsx:56–64, app/visit/[id].tsx:118–119 support picker-purpose correction.
- mobile/app/settings.tsx:130–178, 313–315 exposes whole-history/account deletion; single-visit UI exists. A full deletion/retention guarantee was not audited or added.

## Validation and remaining limits

JSON parsing succeeded; app version, runtimeVersion and buildNumber are unchanged. Patch contains text changes only in app.json and two onboarding screens. No prose-mirroring tests or duplicate full suites were run. No native/generated files were edited.

Installed expo-location/plugin/build/withLocation.js maps the configured Always-and-When-In-Use string into native permission configuration. This proposal does **not** change already-installed binary strings; main must handle native release compatibility separately. No OTA/native rollout is claimed. Legacy Always fallback, effective generated Info.plist, notification-system presentation and physical permission flow need release/device verification; no prebuild was run.

Settings links to an externally hosted privacy policy. That landing-hosted content, App Store privacy labels, third-party contracts, retention promises, notification schedule copy elsewhere and complete social audience enforcement remain outside this bounded patch. Historical handoff/worklog statements were not rewritten. Copy does not certify provider licensing, prohibit all sharing, promise automatic diary entries or infer food ordered.
