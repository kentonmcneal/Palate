# Independent attribution review

Accept the bounded patch as supplied; no corrective production patch needed. Applied only to a scratch copy of current integrated cluster sources. Exact before/after SHA-256 values are in HASHES.json. No repository writes.

Actual resolver/scorer/digest controls: **81/81 pass**, plus **3,575** direct evidence-envelope combinations. Author controls independently rerun: **26/26 pass**. Zero Google attempts. Mutation allowing two candidates fails the independent oracle. Controls exercise stop/visit/SLC/unknown sources; 19.99/20.01m and 49.99/50.01m distance boundaries; 10/50/50.01m accuracy; missing, nonfinite and out-of-range winner coordinates; filtered nearest row versus actual winner; ambiguity and same-centroid counterexample. Exact direct thresholds (20m,50m) are included in the envelope grid; geographic cases avoid floating-point equality assumptions.

The scorer uses the actual ranked winner's validated coordinates and full eligible count, not the displayed top-three count. Unknown source fails the high gate. Missing source retains the pre-existing legacy visit convention. The added ceiling cannot raise a finite existing score; closed penalty remains after capping. Dwell and clustering source remain intact. The mutable patch does not alter lookup, rank or storage behavior.

A test initially assumed a car-wash type alone was filtered. Actual isLoggableVenue uses eligibility/reason metadata. Corrected the fixture to explicit excluded metadata; this was a harness assumption, not a patch defect. No change to production eligibility proposed.

## Limits and compatibility

A synthetic bus stop at the restaurant centroid still prechecks (explicit passing counterexample). At 50m accuracy, a sole restaurant 49.99m away still prechecks. Thus this is a conservative heuristic improvement, not proof of attendance or a complete NYC fix. Stop source does not prove a fresh fix; legacy source default remains permissive. Centroid mismatches can demote true drive-through/table visits. Existing inbox scores are not rescored. Missing direct caller evidence now prevents high. Two eligible rows, even duplicates, demote conservatively. Nonfinite accuracy can still produce NaN in the pre-existing weighted scorer (band low), rather than a numeric medium score; this is not a new fail-open.

No device, notification delivery, full application typecheck or complete Jest rerun claimed here. Author framework results are separate. These VM controls execute actual source with local service stubs. No services/paid calls. Supplied patch remains the integration artifact; do not replace main pipeline with the author's older full copy.
