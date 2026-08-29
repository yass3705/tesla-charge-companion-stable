#!/usr/bin/env python3
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
js=(ROOT/'assets/v9-subscription-picker.js').read_text(encoding='utf-8')
css=(ROOT/'assets/v9-subscription-picker.css').read_text(encoding='utf-8')

required_js=[
    "tccSubscriptionsV1",
    "tcc:subscriptions-changed",
    "subscription-entitlements-global.json",
    "#v9SubscriptionsBox,#v8SubscriptionsBox,[data-tcc-subscriptions]",
    "data-filter=\"active\"",
    "data-filter=\"FR\"",
    "data-filter=\"ES\"",
    "data-filter=\"multi\"",
    "Rechercher un abonnement ou un opérateur",
]
for token in required_js:
    assert token in js, token

assert ".v9-sub-list{display:grid;grid-template-columns:1fr 1fr" in css
assert "@media(max-width:700px)" in css
assert ".v9-sub-row.selected" in css
print('V9 subscription picker contract OK')
