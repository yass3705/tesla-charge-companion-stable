# TCC V9 rollout plan

## Architecture contract

The rollout now separates two independent facts that were previously conflated:

1. **engine validation** — whether the pinned V9 data/runtime candidate has passed its observation and rollback thresholds;
2. **user exposure** — whether a production-grade application shell exists and may route real users to that engine.

The V9 engine candidate has completed its 24h+ validation window successfully. That evidence is retained. It does **not** by itself make the technical `v9-app/` validation harness suitable for public user traffic.

The actual public production root is currently **V7.3 Stable**. V8 remains a release candidate/preview until a separate explicit V8 release decision. A V9 rollout must therefore never silently turn a 1% V9 experiment into an unrelated 99% V7.3 → V8 migration.

## User-exposure gate

`ops/v9/production-shell-readiness.json` is the authoritative user-exposure gate.

While it is `BLOCKED`:

- `data/v9/canary-policy.json.active` must be `false`;
- `data/v9/rollout-config.json` must remain `preview` with `canaryPercent: 0`;
- the validated engine evidence remains intact and reusable;
- the public production application remains unchanged;
- no Pages/bootstrap change may route ordinary users to `v9-app/`.

This is fail-closed by construction: a missing or incomplete production shell means zero user exposure, not a redirect to another preview.

## Production-shell requirements

Before the initial 1% user canary can be re-enabled, the production shell must satisfy all of these conditions:

- user-facing UX with no test-only enrollment/scenario controls;
- explicit declaration of the real production control version/path;
- pinned V9 candidate runtime plus the exact data dependencies covered by the observation fingerprint;
- deterministic 1% identity assignment;
- every bootstrap/config/runtime failure leaves the control application loaded;
- no redirect loop and no dependence on a non-existent `v8-app/` path;
- Pages artifact/path smoke tests are green;
- the existing readiness, rollback and manual-promotion gates remain green.

## Stages after production-shell readiness

1. `preview`: technical candidate only, 0% public traffic.
2. `canary`: V9 may be assigned deterministically to the bounded percentage in policy; every non-selected identity stays on the explicitly declared production control application.
3. `production`: V9 becomes primary only after a separate explicit promotion from canary.

Skipping directly from preview to production remains forbidden.

## Rollback

The global kill switch remains available once user exposure is enabled. During the current blocked-shell state, the stronger rollback is simpler: the public canary policy itself is inactive and exposure is fixed at 0%.

## Preserved observation evidence

Pinned candidate: `8d2c20b7c76004389edd8f4a3b80d6b314900ba0`  
Runtime fingerprint: `sha256:455b371c14342a83d55fdfde0e3f2a63e7e3f967c2c84fb3fc31b6fe7bffd697`  
Final full-window validation run: `33999132520`  
Result: 30/30 PASS, zero source/routing failures, zero critical parity errors.

Control-plane files, tests and documentation are outside that runtime fingerprint, so correcting the exposure contract does not invalidate the completed engine observation.

## Current state

- Engine validation: **READY / retained**.
- Production-shell readiness: **BLOCKED**.
- Public V9 user exposure: **0%**.
- Production control: **V7.3 Stable root**.
- Next engineering milestone: build and validate the production V9 application shell, then re-open the already-approved initial 1% stage without repeating the engine observation unless the pinned runtime itself changes.
