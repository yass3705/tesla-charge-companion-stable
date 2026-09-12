# Spain REVE pre-integration

This project builds an auditable Spanish charging-station source before any TCC v8 integration.

## Goal

Use Spain's official MapaREVE public API as the primary national station/tariff source, preserve the raw OCPI-shaped payload, and layer verified direct-operator and subscription tariffs on top. Use the public MITECO/RIPREE export as the independent national static inventory/fallback and reconciliation source.

No file in this project is loaded by TCC v8 yet.

## Primary source: MapaREVE

Base API: `https://www.mapareve.es/api/external/v1`

Relevant resources documented by MapaREVE:

- `/cpos`
- `/locations`
- `/evses/{evse_id}`
- `/evses/{evse_id}/status`
- `/connectors/tariffs`

The API requires an API key and documents a maximum of 5 requests per hour.

## Static fallback/control: MITECO RIPREE

Official export endpoint:

`https://energia.serviciosmin.gob.es/Ripree/ExportarInstalaciones/Export`

The national public dataset contains infrastructure submitted by CPOs/eMSPs and validated in RIPREE, including operator/ownership, location, connector and power-related fields.

`collect-spain-miteco.yml` downloads the full export monthly or manually. The source payload is preserved before normalization.

Files:

- `miteco_ripree_raw.bin`: exact downloaded source payload
- `miteco_ripree_normalized.json.gz`: preliminary source-neutral normalized catalogue
- `miteco_metadata.json`: hash, columns, row counts and download metadata
- `operator_aliases_es.json`: initial CPO name matching candidates; unknown names are never force-mapped

MITECO is not intended to override a fresher REVE value. It is used to bootstrap the static catalogue, find coverage gaps and validate operator/location/connector structure.

## Required GitHub secret

Create a repository Actions secret named:

`REVE_API_KEY`

Do not commit the key in the repository.

MITECO collection does not require this secret.

## REVE collection model

`collect-spain-reve.yml` is designed for monthly or on-demand full passes.

Each short run fetches 4 pages of 100 locations by default. The fifth hourly request is intentionally kept unused as safety margin.

Progress is persisted under `data/spain_reve/`:

- `state.json`: current full-pass cursor and completion status
- `metadata.json`: human-readable progress/status
- `reve_locations_raw.json.gz`: cumulative raw national snapshot keyed by REVE location id
- `operator_tariffs_seed.json`: separately verified operator/subscription layer

### Monthly mode

The REVE workflow is scheduled hourly. It only starts a new cycle in the first 48 UTC hours of a new month; while a cycle is incomplete it advances the cursor. After completion, subsequent invocations exit without consuming REVE calls until a new cycle is started.

MITECO is scheduled once monthly because it is a complete export rather than a paginated rate-limited API.

### On-demand mode

Before a trip or whenever a refresh is wanted:

1. refresh MITECO once;
2. start a new REVE full pass with `force_new_cycle=true`;
3. rebuild reconciliation/normalization only after the REVE cycle completes.

## Why raw data is stored first

Station-to-TCC normalization is intentionally separated from collection. If operator naming, tariff mapping or connector interpretation needs to change, TCC can rebuild the final Spain catalog from stored source snapshots without spending another full REVE API cycle.

## Planned precedence for final Spain catalogue

1. Existing Tesla Spain source for Tesla Superchargers.
2. REVE location/EVSE/connector data for non-Tesla public infrastructure.
3. REVE connector tariff when available for the direct/ad-hoc tariff.
4. Verified operator/subscription layer for memberships, discounts, partner rates and rules not represented by the public tariff.
5. MITECO/RIPREE fields to fill or flag static coverage gaps.
6. Operator-specific validation/override only when a source is demonstrably more precise than REVE.

No REVE/MITECO source should silently overwrite a verified operator rule without keeping provenance.

## Validation gates before TCC integration

1. Complete one MITECO national export and inspect its live columns/operator values.
2. Complete one national REVE `/locations` pass.
3. Verify stored REVE count against `total-count` and reconcile coverage against MITECO.
4. Validate CPO normalization (`party_id` / owner / display name) from real source values.
5. Probe `/connectors/tariffs` with the real API key and map its tariff components into the existing TCC pricing model.
6. Cross-check a sample of real stations for Iberdrola, Endesa, Repsol, Wenea, Zunder, Moeve, Powerdot, Eranovum, Electra, Atlante and IONITY.
7. Reuse the existing Tesla Spain source rather than replacing it with REVE.
8. Produce a final compressed Spain runtime catalog only after the checks above pass.

## Expected first REVE pass duration

With 4 pages per hourly run and roughly 145 pages, a national pass needs about 37 hourly executions. Actual duration depends on the current REVE total page count and API availability.
