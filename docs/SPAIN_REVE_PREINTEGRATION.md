# Spain REVE pre-integration

This project builds an auditable Spanish charging-station source before any TCC v8 integration.

## Goal

Use Spain's official MapaREVE public API as the national station source, preserve the raw OCPI-shaped payload, then layer verified direct-operator and subscription tariffs on top.

No file in this project is loaded by TCC v8 yet.

## Source

Base API: `https://www.mapareve.es/api/external/v1`

Relevant resources documented by MapaREVE:

- `/cpos`
- `/locations`
- `/evses/{evse_id}`
- `/evses/{evse_id}/status`
- `/connectors/tariffs`

The API requires an API key and documents a maximum of 5 requests per hour.

## Required GitHub secret

Create a repository Actions secret named:

`REVE_API_KEY`

Do not commit the key in the repository.

## Collection model

`collect-spain-reve.yml` is designed for monthly or on-demand full passes.

Each short run fetches 4 pages of 100 locations by default. The fifth hourly request is intentionally kept unused as safety margin.

Progress is persisted under `data/spain_reve/`:

- `state.json`: current full-pass cursor and completion status
- `metadata.json`: human-readable progress/status
- `reve_locations_raw.json.gz`: cumulative raw national snapshot keyed by REVE location id
- `operator_tariffs_seed.json`: separately verified operator/subscription layer

### Monthly mode

The workflow is scheduled hourly. It only starts a new cycle in the first 48 UTC hours of a new month; while a cycle is incomplete it advances the cursor. After completion, subsequent invocations exit without consuming REVE calls until a new cycle is started.

### On-demand mode

Run **Collect Spain REVE pre-integration** manually with `force_new_cycle=true` before a trip or whenever a complete refresh is wanted.

## Why raw data is stored first

Station-to-TCC normalization is intentionally separated from collection. If operator naming, tariff mapping or connector interpretation needs to change, TCC can rebuild the final Spain catalog from the stored REVE snapshot without spending another full API cycle.

## Validation gates before TCC integration

1. Complete one national `/locations` pass.
2. Verify stored count against REVE `total-count`.
3. Build and validate CPO normalization (`party_id` / owner / display name).
4. Probe `/connectors/tariffs` with the real API key and map its tariff components into the existing TCC pricing model.
5. Cross-check a sample of real stations for Iberdrola, Endesa, Repsol, Wenea, Zunder, Moeve, Powerdot, Eranovum, Electra, Atlante and IONITY.
6. Reuse the existing Tesla Spain source rather than replacing it with REVE.
7. Produce a final compressed Spain runtime catalog only after the checks above pass.

## Expected first-pass duration

With 4 pages per hourly run and roughly 145 pages, a national pass needs about 37 hourly executions. Actual duration depends on the current REVE total page count and API availability.
