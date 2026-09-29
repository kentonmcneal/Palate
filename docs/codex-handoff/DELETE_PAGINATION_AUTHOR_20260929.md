# Separate endpoint correction: deletion pagination and listing failures

Evidence: PROPOSED SOURCE + LOCAL EXECUTION, 2026-09-29. No live Storage/Auth/Edge calls, repository edits, or deployment.

`delete-pagination.patch` changes only `supabase/functions/delete-account/index.ts` and adds `scripts/test-delete-pagination.cjs`. It is independent of the mobile remaining-writes/auth patches. Captured baseline and SHA-256 manifest are included.

The endpoint now lists offset 0 after removing each page. Increasing offsets against a shrinking list skipped objects (250 objects left 100 behind). A listing error or missing data now throws into the existing storage_delete_failed response, preventing the row-deletion RPC. Successful empty arrays still mean the folder is empty. Existing removal-error handling remains fail-closed.

**10/10 tests pass** against the actual transpiled endpoint with mocked server registration, SDK, and storage: 0, 99, 100, 200, 250, 1,000 objects; initial list error, missing list data, list error after deleting page one, and removal error. The tests check account-prefix selection, removal count, and whether the row RPC runs. No remote imports execute. **Original endpoint: 7 fail / 3 pass**; the 100-object case fails the offset invariant, while larger cases also expose skipped objects. Logs are included. Patch apply-check passed against captured source.

Run from repository root: `/opt/homebrew/bin/node --test scripts/test-delete-pagination.cjs`. It uses installed mobile TypeScript to transpile the endpoint and fixture every external dependency. This is execution of the handler's control flow, not a Deno deployment/typecheck or real Storage contract test.

Limits: flat per-user object listing only, preserving the existing uploader layout. This does not implement recursive folder deletion or serialize uploads against account deletion; concurrent uploads can still defeat an exhaustive erasure claim. A late list failure can leave earlier pages deleted while retaining account rows, intentionally allowing retry rather than falsely reporting complete erasure. No backend secrets, token policies, or observability files changed.
