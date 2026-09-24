# France — Load Motion direct tariff family handoff (2026-09-24)

## Scope

Validated against the production Load Motion/Open e-Mobility tenants using authenticated, read-only user sessions. Never persist JWTs, cookies, passwords or user IDs in repository data, documentation, logs or artifacts.

Common tariff endpoint:

`GET /v1/api/matching-pricing-definitions/resolve?ChargingStationID=...&ConnectorID=...&UserID=...`

Use `dimensions.*.price` as the resolved user-facing amount. The raw values in `ocpiData.elements[].price_components[].price` were consistently lower by the tax factor in the validated extracts and are retained only as source/audit data. `No Tariff` is a fallback marker and MUST NOT be interpreted as free charging.

## Tenants and current validated state

- **YES55** (`yes55.load-motion.com`) — inventory via `Search=Y55`, strict `FR*Y55*` filter. 1,135 stations. 189 direct station tariffs resolved; 225 `No Tariff`; 320 empty; 160 station 404; 241 pricing 404. For unresolved stations, fail closed to Electra then Electroverse. Do not infer tariffs from same-site candidates.
- **Load Stations** (`loadstations.load-motion.com`) — inventory via `Search=LST`, strict `FR*LST*` filter. 77 stations. 55 have a station-specific `issuer:false` tariff. 20 return only two generic tenant defaults (`3F` and `Tarif Load Stations`) and are ambiguous for TCC; 1 empty; 1 persistent error. Only station-specific definitions are rankable; ambiguous cases fall back to Electra/Electroverse.
- **Révéo** (`app.reveocharge.com`) — inventory via `Issuer=true`. 1,069 stations / 1,941 connectors. 1,935 connectors priced after pass 2; 6 persistent HTTP 500; 19 tariff definitions. Preserve power/time restrictions and `sessionTime.freeMins`. When subscriber and non-subscriber definitions coexist (notably TE46), use **Non Abonné** as public/ad-hoc TCC price and keep subscriber pricing only as an alternative.
- **MobiSDEC** (`mobisdec.load-motion.com`) — inventory via `Issuer=true`. 546 stations / 1,261 connectors, 100% priced after pass 2, 10 definitions = five power bands × day/night. Energy prices: <=8 kW 0.42 €/kWh; 8.01–32 kW 0.47; 32–52 kW 0.52; 53–122 kW 0.57; 123–200 kW 0.62. Day definitions carry `parkingTime=12.60 €/h` with 15 free minutes; night definitions have no parking fee. Treat this as post-charge occupation logic in TCC, not as energy-session parking throughout charging.
- **SITI11** (`siti11.load-motion.com`) — standard consumer account exposes 0 issuer stations and the UI itself shows `Total 0`. Do not create a separate CPO import. Canonical public estate is already represented through Révéo/Aude aliases (notably `FR*S11`). Mark `covered_via_reveo`.

## Refresh automation

`loadmotion-france-refresh.yml` runs the generic extractor for the four usable tenants. The workflow never embeds credentials. It reads optional GitHub Actions secrets:

- `LOADMOTION_YES55_TOKEN`
- `LOADMOTION_LOADSTATIONS_TOKEN`
- `LOADMOTION_REVEO_TOKEN`
- `LOADMOTION_MOBISDEC_TOKEN`

These are session JWTs and may expire. Missing secrets cause that tenant to be skipped. Expired credentials must fail closed and require secret rotation; never bypass authentication or automate CAPTCHA/email-verification workarounds. Manual `workflow_dispatch` remains available even if the weekly refresh cannot authenticate.

## V9 pricing semantics

The Load Motion compiler must emit the pricing fields understood by the V9 pricing engine rather than the legacy V7 rule names. The normalized mapping is:

- OCPI `ENERGY` / `dimensions.energy` -> `pricePerKwh`.
- OCPI `FLAT` / `dimensions.flatFee` -> `sessionFeeEur`.
- OCPI `TIME` / `dimensions.chargingTime` -> `chargingTimePerMinuteEur`; the V9 pricing engine applies it only to actual charging minutes.
- `dimensions.sessionTime` -> `connectedTimePerMinuteAfterFreeEur` + `connectedTimeFreeMinutes`.
- OCPI `PARKING_TIME` / `dimensions.parkingTime` -> top-level `pricing.postChargeFee` with `eurPerMinute`, `graceMinutes` and, when the definition is time-windowed, complementary `exemptLocalWindows`.

Do not emit the legacy fields `chargePerMinute`, `afterMinutesRate`, `postChargeRate` or `connectionFee`: the V9 engine does not use those fields. The refresh workflow rejects a compiled snapshot if any of them leaks into the rankable Load Motion offers.

## TCC integration rules

1. Operator-direct Load Motion tariff wins when the exact station/connector or deterministic network/power/time class is resolved.
2. Preserve all structured time windows, power restrictions, connector restrictions and free-minute thresholds.
3. `No Tariff`, `[]`, 404/500 and ambiguous generic tenant defaults are not zero-price offers; use Electra then Electroverse fallback.
4. Keep direct CPO and roaming/eMSP offers separate in the UI/ranking metadata.
5. SITI11 is an alias/supervision tenant only; no duplicate station import.