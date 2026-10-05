# AAPW Modern Runtime R42

R42 is the next strict TypeScript production layer after the repository's R41 runtime.
It combines deterministic simulation, typed input, world state, adaptive rendering, asset residency, networking, persistence, scheduling, workers, observability, security, streaming, UI contracts and explicit legacy ownership.

## Language migration

Production behavior belongs to TypeScript. Remaining JavaScript is treated as an explicit compatibility or generated boundary with a typed owner. R42 makes that ownership machine-auditable rather than relying on documentation alone.

The dependency baseline was checked against current npm stable releases during this pass: TypeScript 7.0.2, Vite 8.3.2, Vitest 5.0.3, Three.js 0.186.1 and @types/three 0.186.0. The project already matches the current TypeScript and Three.js releases; Vite and Vitest were one patch behind at the start of this pass.

## Architecture

- types.ts: canonical immutable data contracts and deterministic helpers.
- clock.ts: fixed-step clock with catch-up bounds and restore support.
- input.ts: deadzone, clamping, monotonic sequencing and command buffering.
- world.ts: entity authority, spatial hash and canonical patch path.
- simulation.ts: locomotion, gravity, stamina, attack, dodge and grounding rules.
- render.ts: WebGPU/WebGL2/headless selection and adaptive quality.
- assets.ts: bounded asset queue, residency budget and eviction.
- network.ts: snapshots, deltas, prediction history and reconciliation.
- persistence.ts and migration.ts: versioned saves and migration of legacy state.
- scheduler.ts and workers.ts: priority-aware, bounded background work.
- observability.ts: rolling performance samples, tracing and health scoring.
- security.ts: input inspection, sanitization and deterministic rate limiting.
- events.ts: bounded typed event delivery.
- streaming.ts: interest-based world cell planning.
- ui.ts and browserBridge.ts: presentation state and browser capability boundaries.
- replay.ts: deterministic checkpoints, replay records and rollback plans.
- compatibility.ts: legacy JavaScript ownership registry.
- runtime.ts: composition root and application lifecycle.

## Safety and performance

R42 forbids Math.random(), Date.now(), eval() and new Function() in the strict runtime surface. Entity counts, event queues, command queues, asset residency, packet payloads and worker queues are bounded.

Render policy prefers WebGPU when available and falls back to WebGL2 or headless execution. Adaptive quality responds to frame time, memory pressure, thermal pressure and camera cuts.

## Verification

~~~text
node --experimental-strip-types scripts/checkRuntimeR42Architecture.ts
npx tsc -p tsconfig.r42.json --noEmit
npx vitest run tests/modern/r42 --passWithNoTests
~~~

CI repeats the same architecture, typecheck, test and deterministic-surface checks on pull requests and main pushes.

## Migration policy

R42 is additive and intentionally honest. It does not claim that every historical JavaScript artifact has disappeared. Instead, active JavaScript must be owned by an adjacent typed implementation or be explicitly classified as generated/vendor material. Legacy entrypoints can be removed once their compatibility records become migration-ready and their typed replacement has independent verification evidence.