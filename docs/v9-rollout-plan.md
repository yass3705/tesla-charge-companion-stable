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

## Current state

The versioned configuration remains `preview`, `canaryPercent: 0`. V8 is still production.
