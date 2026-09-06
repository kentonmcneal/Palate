Real data, pulled from the live database on 2026-09-06.

`memphis-pool.json` — the 200 recommendable restaurants inside the 8km box the
app actually searches around Memphis. 79 of them have no cuisine_region and no
cuisine_subregion; 55 of those DO have a cuisine_type. 168 have opening hours.

`founder-visits.json` — the founder's 35 visits, grouped by the cuisine and
format fields the scorer reads, with counts.

These exist so a ranking change can be measured against the real distribution
instead of a synthetic one. A fixture invented by hand would have had a
cuisine_region on every row and would have hidden the entire defect.
