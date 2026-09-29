# Local SQL security regression report

Evidence: **WORKING TREE / LOCAL EXECUTION** for the scratch proposal and tests. No repository writes, package installations by this worker, credentials, network requests, cloud database calls, or deployment. Main's source was at **COMMITTED `708ec6f`**, with no working diff under `supabase/migrations` at inspection. This is not LIVE evidence.

## Result

**57/57 cases pass** on PostgreSQL 18.3, PGlite 0.5.8, using `/opt/homebrew/bin/node` and the already installed workspace module. This comprises 8 baseline controls (7 reproductions of vulnerable behavior and 1 feed-selection snapshot), 43 patched SQL cases, and 6 current group-handler cases backed by actual SQL authorization reads. Separately, **26/26 offline mocked handler cases pass** against main's current source.

The exact names/results are in `local-sql-results.json`; console output is in `local-sql-run.log`. `edge-current-run.log` records the separate 26 handler cases.

## Proposed integration

Use `security-readers.proposed.sql` as a new additive migration, subject to main's review. It was executed in full, including its transaction and ACL statements, in the accompanying fixture. Historical migrations must remain unchanged.

Compared with the first candidate:

1. `list_feed` retains the original 0148 selection predicate verbatim and adds a separate visit-owner integrity condition. It does not delegate selection wholesale to `can_view_feed_event`.
2. The comment trigger makes `id`, `feed_event_id`, and `parent_id` immutable on UPDATE, including privileged writes. This prevents moving a root while leaving children behind, turning a root with children into a reply, or moving/reparenting a reply. Root/reply insertion still validates same-post, one-level, non-self, non-blocked parents. This deliberately rejects structural moves even for empty roots; the app already has no comment UPDATE policy. Body updates by privileged maintenance are not prohibited by this trigger. Deleting a root still cascades its replies and their likes.

Other candidate protections remain: block-aware taste readers; private-mutual exclusion from shared/ranked readers; public-visit-only city summaries; forged event insertion denial and legacy forged-event visibility denial; visible-event requirement for post likes; public-visit and reciprocal-friends requirements for visit-push recipients.

## Feed selection finding

**COMMITTED source:** 0077 is explicitly titled “everyone sees everyone, without adding friends first.” The latest `list_feed` definition is 0148. Its gate uses `can_view_feed_author`; 0116's current implementation permits signed-in viewers to see public authors without following them. `mobile/lib/feed.ts` invokes that RPC. Therefore the inspected source does **not** implement a follows-only feed.

The baseline snapshot contains a public non-followed author's event. The patched snapshot matches the original ID set exactly. Own hidden posts remain visible to their owner; others' hidden posts remain excluded. This is a selection-preservation change, not approval of a new product contract. If main has a separate intended follows-only rule, that would be a separate feed-selection change and requires its own test; changing the shared visibility helper would incorrectly narrow other readers.

## Cases exercised

- Seven original vulnerabilities reproduced using original function/policy definitions: forged own event exposes another user's hidden visit; blocked taste reader; private mutual shared/ranked readers; hidden visits in city counts; hidden-post like plus notification; cross-post reply; hidden-visit friend notification.
- Forged links denied for both public and hidden victim visits. A legacy forged event seeded by the owner is hidden from direct reads, list_feed, can_view_feed_event and comments, and cannot receive new likes/comments.
- Owner retains hidden-post visibility and full taste history; other authorized users receive only public visits.
- Both block directions deny taste/shared/ranked/city/feed/like reads or writes, even with reciprocal follows retained. Batch taste results deny the blocked target independently while preserving authorized/self results.
- Private mutual and friends one-way targets denied; friends mutual allowed. Private mutual cities denied independently.
- Zero, one, and two public visits with newer hidden visits: city threshold/count/month reflect public rows only.
- Hidden/private/friends-one-way/blocked posts reject likes; a denied like creates neither a like nor outbox row. Visible likes enqueue a notification; spoofed liker identity rejected.
- Cross-public-post, cross-hidden-post, nonexistent, self, nested and blocked-parent replies rejected. Valid top-level comments/replies accepted. Blocked commenter excluded from list_feed_comments; hidden/blocked comment likes rejected; visible comment likes accepted; spoofed identity rejected.
- Authenticated comment UPDATE affects no rows. Service-role moves/reparenting/ID changes with existing children rejected. Empty-root moves and existing-reply moves/reparenting rejected. Root deletion cascades children and child likes. Unrelated viewer cannot delete another comment; post owner can.
- Visit push cases: hidden, friends-one-way, private mutual and blocked public produce no outbox entry; public one-way and friends mutual produce one.
- Anonymous reader RPCs denied by ACL, anonymous direct feed empty. Authenticated role without JWT subject has no reader data and cannot like. Internal parent trigger and are_friends execution denied to authenticated.
- Actual current group handler with SQL-backed service-role authorization: both block directions, private mutual, and friends one-way return 403 before any visit query; friends mutual and public one-way return 200 and reach visit reads. Authentication/transport and the empty candidate/dislike sources are mocked. No recommendation-score claim is made.

## Fixture fidelity and limitations

- Tables contain the columns/FKs/checks needed by these functions, including actual meal/feed enums, same-table cascading reply FK, unique likes, unique push dedupe keys, profile visibility check, and enabled RLS. Relevant feed/comment/like/follow/visit policies and functions are extracted from migrations. Security-definer bodies run as the database owner. Tests explicitly switch to non-owner `authenticated`/`anon`, or to `service_role BYPASSRLS`; setting auth.uid alone is not used as a substitute for role testing.
- `auth.uid()` is a local implementation reading the JWT subject setting. There is no Supabase Auth token verification, PostgREST schema cache, SDK serialization, HTTP/RLS integration, deployed grant/default-privilege inventory, or full migration-chain replay. Profile/block/rating own-row policies are minimized equivalents; table grants are explicit fixture grants, not a proof of deployed ACLs.
- Restaurant/cache schemas and unrelated columns/indexes/triggers are omitted. Automatic visit-to-feed creation, analytics, cron, extensions, feature-flag push dispatch and external sends are absent. Real notification-enqueue functions and real next_sendable_at execute into a local outbox; no sender exists in the fixture.
- PGlite is PostgreSQL 18.3 in a single embedded engine, not proof against the deployed server version, connection pool, or multi-session timing. Structural immutability removes the mutable-parent check-then-act path by construction, but these tests do not prove concurrent transaction interleavings. Authorization changes concurrent with a statement retain normal statement-snapshot semantics.
- The trigger does not repair already malformed reply trees, and adding it does not scan existing rows. `existing-data-preflight.sql` is an unexecuted read-only inventory for main's separately authorized integration process. Cross-post or nested legacy rows need an explicit repair decision. Legacy forged events are hidden by the candidate but not deleted.
- Group authorization tests mock successful authentication and translate the handler's needed query shapes into SQL. They verify actual block/follow/visibility table reads under service_role and absence of visit reads on refusal. The separate 26 tests cover injected SDK errors, but neither suite proves live authentication or PostgREST behavior.

## Reproduce

From the scratch workspace root (no dependency install required):

```sh
/opt/homebrew/bin/node outputs/palate-security/local-sql.test.cjs "$PWD/work/pglite/node_modules/@electric-sql/pglite"
/opt/homebrew/bin/node outputs/palate-security/edge-authorization.test.cjs '/Users/kentonmcneal/Claude Code/Palate'
```

The first command writes only scratch result/log artifacts beside the tests. `PALATE_ROOT` optionally redirects the current group-handler source. The fixture and proposed migration are loaded from files beside the runner.

## Main integration
Candidate integrated as0183_social_privacy_integrity.sql and rerun from scripts/security-sql/local-sql.test.cjs against that exact migration:57 passed,0 failed. Runner prints results to stdout and resolves the repository automatically. Use scripts/security-sql/README.md for the committed reproduction command; earlier scratch paths above describe worker evidence only. No LIVE application.
