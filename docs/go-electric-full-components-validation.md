# Go Electric Italy V9 — full component validation

Validated 2026-09-01.

- Exact validated Go Electric EVSE: 2,214.
- Time component: 1,052 EVSE, public NextCharge UI proves EUR/min.
- Parking component: 700 EVSE, public NextCharge UI proves EUR/min.
- `onNoEnergyDelivery`: 626 EVSE, modeled as post-charge connected-time fee.
- `onAfterTime`: 74 EVSE, public UI proves threshold is elapsed time since connector connection; raw threshold is seconds.
- Windowed cases use existing V9 rule/exemption primitives; non-segmentable sessions crossing a tariff-window boundary remain fail-closed.
- No core pricing-engine change is required.

Evidence/QA runs:
- semantics UI proof: data-lab run 33551150109 — success;
- full component candidate + existing-engine primitive mapping: data-lab run 33551692099 — success;
- stable isolated runtime mapping: run 33551790218 — success.

Publication remains subject to current-catalog overlay preservation QA.
