# V8 direct offer pipeline

The V8 preview resolves direct CPO offers before ranking through the registry-driven direct offer pipeline maintained on `release/2026-08`.

The pipeline is designed for progressive operator onboarding:

1. declare the source in `data/v8_tariff_sources.json`;
2. keep it `staged` until its dataset/resolver is validated;
3. expose a prepared-station enricher when timing-sensitive runtime data is required;
4. switch the source to `active` only when the build contract and tests pass;
5. resolve direct offers and subscription eligibility before the physical-station Top 20 ranking.

The first centrally orchestrated direct sources are Powerdot, Freshmile, Bump and DRIVECO. The same mechanism is intended for future operators rather than adding operator-specific logic to the comparator.

Deployment note — 2026-08-26: publish the release containing the unified direct-offer pipeline and its registry contract tests.
