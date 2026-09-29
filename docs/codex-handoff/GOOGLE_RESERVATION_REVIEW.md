# Conservative Google reservations

WORKING TREE: the helper now calls existing bump_google_spend before fetch and admits only a valid returned total <= the configured cap. The migration locks the day row and returns the increment result. A preliminary read does not authorize spending.

For a fixed cap and reservation day, nonnegative serialized increments give each admitted request a reserved cost in a prefix no greater than that cap. Denied and uncertain reservations consume headroom rather than authorizing extra requests. Lost RPC responses may double-reserve on retry, but fetch is never inside the retry loop. Failed fetches retain their reservation because whether Google served them is uncertain.

The counter is now a conservative reservation total, not an invoice. Rejected races and uncertain replies can exhaust it early. Existing column names remain for compatibility. Alert copy says reserved, not billed.

Independent read-only reviewer checked the migration and proposed algorithm. No new schema change is needed for this limited source guarantee. Remaining limitations:
- Mixed old post-fetch or legacy callers break a fleet-wide guarantee; every spender must adopt this helper.
- Different caps across workers cannot enforce an instantaneous new lower global cap. A tripped flag stays closed until reset even after raising the cap.
- Day is captured once for reservation retries; requests admitted near midnight may finish on the next calendar day. Reservation day is not Google invoice day.
- Lost threshold-crossing RPC replies can lose one-shot alerts. No durable alert delivery is claimed.
- Zero-priced calls obey the shared preflight shutdown; a concurrent zero-price request admitted before shutdown may still proceed. It cannot add dollar spend.
- SKU table remains estimated for four entries. A cap on assigned costs is not independently verified real billing.
- SQL lock behavior is source-reviewed only; no local Postgres tool or live database test was run.

Tests execute actual helper code with mocked fetch and a shared serialized meter across isolated worker modules. They establish helper behavior, not deployed SQL, pricing, or fleet adoption.
