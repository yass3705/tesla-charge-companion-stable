# V9 clean-repository migration staging

This branch is a **non-destructive staging area** for the clean V9 repository.

## Goal

The production repository will contain only what V9 needs to run:

- physical EVSE inventory from authoritative national datasets where available;
- Tesla as an additional physical source;
- direct tariffs only for CPOs whose tariff work is validated;
- Electra and Electroverse as alternative offer layers;
- subscription pricing only when the selected subscription is compatible with the station/EVSE;
- runtime, tests and refresh workflows needed by production.

## Safety rules

1. The existing `stable`, `data-lab` and `updater-test` repositories stay untouched as rollback/history sources.
2. A tariff source is imported only when its CPO status is `treated`, `complete` or `validated`.
3. `partial`, `active`, `setAside` and `blocked` tariff sources are excluded.
4. Missing prices are fail-closed: an EVSE can remain visible without a price.
5. Electra/Electroverse must enrich an existing physical station whenever matching succeeds; they must not create duplicate physical stations.
6. Each migration batch is compared against its locked source commit before publication.
7. Publication is atomic and keeps the last-known-good snapshot on refresh failure.

## Initial country scope

- France: eligible, but the whitelist must be reconstructed from the latest raw-ledger lineage rather than the stale September 4 snapshot.
- Italy: eligible; current locked progress has 23 treated CPOs.
- Netherlands: eligible; national inventory and direct offer plumbing already exist in V9.
- Spain: staging; validated tariffs can migrate, but the national REVE inventory must finish before the country baseline is declared complete.
- Germany: staging; recover the current consolidated Germany workstream artifact before importing.
- Morocco: eligible with a CPO-by-CPO inventory model; stations are retained even when no tariff is known.

## Next migration step

Materialize the validated-only whitelist and copy the minimal V9 runtime/data set into the empty target repository. Do not switch production traffic until parity checks pass against the locked source commits.
