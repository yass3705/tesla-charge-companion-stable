#!/usr/bin/env python3
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
js=(ROOT/'assets/v9-subscription-engine-bridge.js').read_text(encoding='utf-8')

required=[
  "tccSubscriptionsV1",
  "tcc:subscriptions-changed",
  "tcc:v9-offers-invalidated",
  "tcc:v9-engine-ready",
  "tcc:v9-subscriptions-ready",
  "subscriptionId||offer.selectionId",
  "filterOffers",
  "splitOffers",
  "setSelectedSubscriptions",
  "invalidateOffers",
  "recompute",
]
for token in required:
    assert token in js, token

assert "if(!id)return true" in js
assert "subs.filter(offerIsEligible)" in js
print('V9 subscription engine bridge contract OK')
