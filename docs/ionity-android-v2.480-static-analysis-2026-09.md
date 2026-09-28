# IONITY Android app static analysis — v2.480.0

Date: 2026-09-28
Source reviewed locally: user-provided IONITY Android XAPK v2.480.0.
No embedded credentials, client secrets, tokens, or private app material are stored in this repository.

## Findings relevant to TCC V9

The Android client uses the IONITY adhoc backend and exposes the following Retrofit endpoints:

- `GET v3/location/{id}` -> `LocationDetailsEntity`
- `GET v2/subscription/{profileType}/options` -> list of `SubscriptionOptionEntity`
- `GET v2/subscription/{profileType}/options/locked`
- `GET v2/ev-driver/my-subscriptions/{profileType}`
- `GET v1/subscription-countries`

The production API base observed in the app is the same IONITY adhoc BFF family already used by TCC for public direct pricing.

The app's authenticated network layer adds:
- Authorization bearer token obtained through the app's Cognito session
- x-adhoc-device-id
- x-adhoc-platform = ANDROID_V2
- x-adhoc-app-feature-version = v2.480.0

## Station-level price model

`LocationDetailsEntity.connectors[]` uses `ConnectorEntity`, which contains:
- `chargingPrice`
- `discountedChargingPrice`
- `lowestChargingPrice`
- `discount`
- `blockingFee`

`ConnectorDiscountEntity` contains at least:
- `badge`
- `category`

The app also contains feature/UI evidence for location-specific discounts:
- `LOCATION_DISCOUNTS`
- `PRICE_IS_DISCOUNTED`
- `discountedEvses`
- `ARTRKC_918_show_location_discounts`
- `IONITY Power discount`
- `20% IONITY Power discount`

## Subscription option model

`SubscriptionOptionEntity` includes:
- `productIdentifier`
- `displayName`
- `country`
- `subscriptionGrossFee`
- `subscriptionType`
- `chargingPrice`
- `blockingFee`
- `promotionMessage`

`ChargingPriceEntity` separates `ionity` and `chargingAlliance` prices.

## TCC conclusion

The most promising path for exact France -> Switzerland IONITY subscription pricing is not to extrapolate the public national minimum. Instead:

1. resolve the user's IONITY subscription option/product;
2. obtain an authenticated app session;
3. query `v3/location/{id}` for Swiss IONITY stations;
4. use connector-level `discountedChargingPrice` only when returned for the authenticated profile;
5. preserve `chargingPrice` / public Direct as the fallback;
6. never infer a discount for stations where the authenticated endpoint does not return one.

This would give TCC exact station-level subscription prices without applying the national minimum to every station.

## Current blocker

Static analysis is complete enough to identify the correct data path. The remaining blocker is runtime authentication: a valid IONITY account session is needed to verify the authenticated response shape and determine whether Motion/Power pricing appears directly in `discountedChargingPrice` for Swiss stations.

No user credentials should ever be committed to a public repository.
