# Living World Runtime R11

R11 introduces a deterministic TypeScript-first AI scheduling core for the living world.

## Active ownership

`livingWorldStimulusWorkBudget.ts` distributes actor evaluations across deterministic buckets and tracks starvation debt. `livingWorldFaunaActivityBudget.ts` ranks fauna work using threat, resource pressure, fairness age, LOD and deterministic jitter. `livingWorldRuntimeKernel.ts` composes both decisions into one immutable per-tick snapshot.

The existing fauna population director remains the behavior/integration owner. It now consumes the runtime kernel so scheduling is explicit instead of allowing each actor class to independently consume an unbounded slice of the frame.

## Performance guarantees

Work is bounded by explicit actor/candidate budgets. Near and urgent work is prioritized, distant work is bucketed, and starvation debt prevents actors from being permanently skipped.

## Determinism guarantees

The scheduler uses stable hashing and explicit tick/seed state. It does not use `Math.random()`, `Date.now()`, timer callbacks or renderer state.

## Compatibility

Existing JavaScript entrypoints remain compatibility shims. The new scheduler implementations are strict TypeScript and do not import `.legacy.js` sources.

## Verification

Use `npm run check:living-world-r11` to run the ownership gate, deterministic regression tests and the repository TypeScript check.