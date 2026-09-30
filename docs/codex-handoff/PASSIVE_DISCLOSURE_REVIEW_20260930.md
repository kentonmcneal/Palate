# Independent disclosure review — approve two JS screens with correction

**WORKING TREE / source-only**, 2026-09-30. Reviewed Chandra's permission.tsx and privacy.tsx proposals only. app.json is excluded and not approved by this packet. No repo writes, installs, live services, deployment or native build.

## Actionable finding: restore documented commitments

Chandra's proposal removes “We never sell your location” from permission.tsx and “We don't sell your data and we don't show ads” from privacy.tsx. Lack of a code-level proof is not evidence these policy commitments should disappear. They are repeated in the existing policy source and app materials:

- `landing/app/privacy/page.tsx:97`: no data sales; describes infrastructure providers used to operate the app. Section 1 at lines 47–53 also contains no-sale/no-ad commitments, although its blanket no-sharing language is broader than current data flow supports.
- `APP_STORE.md:90,118–119`: no ads, no data sales/data brokers, no ads ever.
- `mobile/app/settings.tsx:364` and current onboarding privacy: same commitments.
- `LAWYER_REVIEW.md:45–46,147`: no advertising/data sales. This document also has outdated “no social features” descriptions, so it is corroborating policy history, not evidence of current implementation as a whole.

**Correction:** preserve “We never sell your location” on permission, and “We don't sell your data and we don't show ads” on privacy. These are existing business commitments, not new technical guarantees or an independent audit of compliance. No-sale and service-provider processing can both be stated without contradiction. Added “Dish details are optional” keeps the user-confirmation journey explicit.

## Remaining copy approved / meaning retained

| Original meaning | Corrected disposition and evidence |
| --- | --- |
| Location helps detect nearby places | Retained, including foreground use and separately optional background access. `passive-permissions.ts` and the permission route support the separate steps; no precise iOS dialog schedule is promised. |
| Passive tracking makes keeping a diary easier | Retained as possible stop → confirmation → diary, with optional dish details and manual entry. `confirm-visit.tsx` asks whether the user got food/drink and saves after confirmation; no order can be inferred from location. |
| Evening review | Retained as a possible reminder, not certain delivery. Scheduler and notification permission/OS constraints justify the qualification. |
| User control | Retained as actual visibility settings and separate foreground/background choices. “What shows up in any feed. All your call” is too broad: it implies universal audience/content control beyond the named settings. |
| Delete visits/history/account | Retained as individual visits and Settings whole-history/account operations. Removed the dedicated “a week” implication because no such grouped control was identified. Does not promise verified backend erasure or retention timing. |
| No selling / no ads | Restored as documented commitments. Not dropped simply because source cannot prove commercial practices. |
| “Restaurants don't see your name or email” | The no-sale commitment is preserved, but this absolute non-access claim is not reinstated. Current public profiles/social visibility mean a restaurant operator could view information as an ordinary member of the public; source cannot enforce a category-wide “never see your name” promise. This is a concrete audience mismatch, not merely absence of proof. It does not establish a restaurant data-sharing program. |

Pre-confirmation disclosure is necessary: `passive-pipeline.ts` catalogueCandidates/resolveVenue passes stop coordinates into server catalogue/nearby queries; `places.ts` calls places-proxy; the proxy can send locationRestriction coordinates to Google. `passive-inbox-sync.ts` mirrorPayload includes suggested venue, address, detectedAt, dwell, accuracy and confidence metadata while omitting raw stopLat/stopLng. Omitting the latter from the mirror does not make all processing local. Chandra's provider/sync wording accurately permits these flows without claiming every stop is transmitted.

The corrected screens do not claim automatic logging, complete detection, perfect venue matching, guaranteed reminders, exact permission-prompt timing, no service-provider sharing, or inferred dish/order details. No business commitment is converted into a claim of independently verified compliance.

## Integration and executed checks

- If Chandra's JS hunks are already applied, use **CORRECTION_AFTER_CHANDRA.patch**.
- Otherwise use **TWO_JS_FILES_COMBINED.patch** (exactly the two JS screens, no app.json hunk). Do not apply both.
- Read-only `git apply --check` of the combined patch against current main succeeded.
- TypeScript parser accepts both corrected TSX files. AST comparison to Chandra confirms **only JSX text differs**; event handlers, routes, imports, hooks and attributes remain identical. CHECKS.log and HASHES.json bind this evidence.
- No mounted rerun/full typecheck: this correction changes prose only. Prior intro mounted controls are separate evidence and are not attributed to these two screens. Physical layout/VoiceOver and the hosted policy's current deployment were not inspected. Repository policy text is documentary evidence; no LIVE compliance or legal certification is asserted.
