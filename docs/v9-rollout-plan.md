# TCC V9 rollout plan

V8 remains production until an explicit rollout promotion is performed.

## Stages

1. `preview`: V9 is available only through the isolated preview. Versioned canary percentage must remain 0.
2. `canary`: V9 may be assigned deterministically to a bounded percentage of identities. Readiness must be `READY`. Non-selected identities remain on V8.
3. `production`: V9 becomes the primary engine only after a separate explicit promotion from canary and a green readiness state.

Skipping directly from preview to production is forbidden by the rollout contract.

## Rollback

The rollout configuration contains a global kill switch. When enabled, every rollout decision resolves to V8 regardless of requested stage or readiness. Rollback is therefore independent of V9 runtime health.

## Safety invariants

- Production `index.html` is not modified by the rollout preparation phase.
- Readiness is mandatory for canary and production.
- Canary allocation is deterministic using a stable identity bucket.
- Preview stage cannot allocate canary traffic.
- Production may not point at the preview path.
- A versioned config change is required for every real promotion.
- CI validates the rollout engine, readiness engine and safe config contract.

## Pre-canary observation gate

Promotion from `preview` to the initial 1% canary requires a pinned public
candidate and a versioned observation record in
`ops/v9/canary-observation.json`. The record is evaluated independently from
the promotion readiness gate:

- at least 24 hours must elapse on the same deployed runtime fingerprint;
- at least 25 public candidate runs must be recorded;
- rollback thresholds must remain clear;
- rollout stays `preview` with `canaryPercent: 0` throughout observation;
- automatic Pages pushes stay pinned to the observed candidate SHA;
- readiness remains closed until the explicit promotion change.

Any change to the candidate code or data payload changes the fingerprint and
yields `RESET_REQUIRED`. The promotion control files are excluded from this
build fingerprint but remain guarded by CI; observation, tests, CI and
documentation also do not alter the pinned runtime.

During an active window, `v9-device-test-pages.yml` keeps pull-request checks
available but skips automatic push builds for every SHA except the pinned
candidate. Replacing the public candidate therefore requires an explicit
manual deployment and a restarted observation record.

## Current state

The versioned configuration remains `preview`, `canaryPercent: 0`. V8 is still
production. Observation started at `2026-09-01T14:31:56Z` against deployed
candidate `bb185ded1cfffe3a4f4d864427a7fb0c1e30157a`. The initial public
evidence contains 30/30 PASS runs, zero source or routing errors, 7,043 ms
average latency and 18,372 ms maximum latency. The earliest possible 1%
eligibility time is `2026-09-02T14:31:56Z`, provided the runtime fingerprint
remains unchanged and the explicit readiness promotion gate is opened.
