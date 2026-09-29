# Google field-mask pricing review — 2026-09-29

WORKING TREE source inspection found that nearby/text searches and structural details requested rating, priceLevel, userRatingCount and regularOpeningHours while declaring Pro SKUs.

Google's [field table](https://developers.google.com/maps/documentation/places/web-service/data-fields) assigns these fields to Enterprise. The [global pricing table](https://developers.google.com/maps/billing-and-pricing/pricing), retrieved2026-09-29, lists first-paid-tier rates of$35/1,000 Enterprise search calls, $20/1,000 Enterprise details and$25/1,000 Details Enterprise + Atmosphere. The code now reserves those amounts. ID-only text search remains the documented free exception.

These are public list-rate estimates, not inspected account invoices. Free monthly allowances, discounts and credits are intentionally not subtracted. Tax, account-specific terms, future pricing changes, other services and deployed older callers remain outside this protection. The earlier claim that a historical total divided by assumed request counts confirmed a SKU price has been removed; that arithmetic was not invoice evidence.

The actual changed callers are places-proxy nearby/text, featured-lists-refresh text and reclassify structural details. Rich details retain their existing rate. Unknown and inherited-object SKU names now fail closed instead of using a guessed fallback price.

Offline evidence: actual helper tests cover reservations, failures, retries and concurrent mocked workers with updated rates. Source-AST tests inspect all six current paid mask variants and the Gmail ID-only exception. Any newly requested unreviewed field fails the contract test; this is a development check, not a runtime Google billing classifier. A skipped test run or an undeployed code change cannot protect a live fleet.

Integrated run:141 suites /1,266 tests passed, one existing skipped; TypeScript passed. No Google calls, invoice access, deployment or billing changes. LIVE controls remain unverified.
