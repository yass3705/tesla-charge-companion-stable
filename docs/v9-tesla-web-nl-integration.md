# Tesla web + Netherlands V9 test candidate

This candidate reuses the existing DOT-NL catalogue (78,528 stations, snapshot
2026-08-29), direct offers, geographic shards and subscription rules. It selects
SuC Tracker as the Tesla source for V9. The production runtime on `main` remains
pinned separately; this branch starts integration testing only.

## Reproduce

```sh
python3 scripts/v9/refresh-tesla-web.py
python3 -m unittest discover -s tests/suc_tracker -p 'test_*.py' -v
node tests/v9-tesla-web.test.cjs
node tests/v9-real-eindhoven.test.cjs
```

The converter and refresh checks are reused from `tesla-stations-updater-test`,
`scripts/suc_tracker/core.py` (blob `e1e1c0ac42539fc2d9d5f20684a1b72040b1c8ce`)
and `update.py`. The existing weekly updater continues independently. No Mac
extraction, account or Tesla API is needed for this test. The test workflow also
downloads the website snapshot afresh and exports the results as an artifact;
it does not automatically publish new prices to production.

## Initial evidence

- Website: `https://suc-tracker.eu/data/europe.json`, generated 2026-09-18.
- 1,184 Tesla stations in the 11 configured countries, including 54 in NL.
- The V9 loader preserves two legacy-only stations, yielding 1,186 total.
  Web records always win for matching canonical IDs; a failed web download is
  surfaced, never silently replaced with the old catalogue.
- Eindhoven within 25 km: 4,321 stations, 41 operators, 80 routing candidates.
  Tesla Eindhoven survives operator filtering and the routing budget.
- Eindhoven sample: 20 kWh at 2026-09-19T10:00Z, 30 minutes: EUR 8 charge estimate.
  This is a calculation check, not an independent official tariff confirmation.

## Data semantics

Observation timestamps, native currency, local timezone and SuC provenance are
preserved in offers. Station EVSE IDs are scoped to the station. Web availability
is unknown; source lifecycle is not live availability. Missing access hours
(17 stations), unavailable tariffs (2 stations) and inactive/stale source rows
cannot create comparable web offers. These categories may overlap.

The website does not supply connection, parking, idle or congestion fees. The
estimate covers the supplied charging tariff only. Post-charge parking is
non-comparable because its fee is unknown. Non-Tesla-vehicle prices remain in
the source file but are not automatically offered to a Tesla vehicle. New web
stations have no inferred opening hours. Existing verified access metadata is
retained with its original reference date.

The legacy Mac snapshot and comparison process remain available; a future Mac
comparison must still be restricted to countries completed in that Mac run.
DOT-NL is a reused snapshot, not a new collection or a claim of fresh live data.

## Remaining release gate

Run the GitHub web/NL workflow, inspect its artifact and test the candidate in
the application, including Eindhoven and a station with time-window pricing.
Keep official price verification distinct from the extraction/conversion tests.
Production promotion is a separate operation after the test result is accepted.
