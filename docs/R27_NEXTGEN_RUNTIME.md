# R27 Next-Generation Runtime

R27 is the next integration layer above the R26 runtime kernel. Its goal is to turn the modern TypeScript platform into a portable gameplay runtime that can be exercised without Three.js, a browser DOM, or a specific transport implementation.

## Architecture

The runtime is split into deterministic contracts and replaceable adapters.

- Contracts define entities, transforms, snapshots, assets, inventory, dialogue, input and scheduling.
- Deterministic scheduler runs phase-ordered systems through dependency-aware topological sorting.
- ECS owns entity/component state and deferred structural commands.
- Physics/query layer provides a bounded uniform-grid broadphase, ray tests, sphere/AABB overlap and grounding.
- Visibility turns camera volume + importance into stable visibility and LOD decisions.
- AI stores bounded perception memory and resolves utility actions using deterministic tie-breaking.
- Gameplay provides inventory transactions and dialogue graphs with typed conditions.
- Persistence provides versioned save envelopes, checksums, migration hooks and bounded in-memory slots.
- Network provides input buffering, sequence handling, snapshot interpolation, reconciliation and token-bucket bandwidth control.
- Assets are managed by dependency-aware planning, retries, cancellation and weighted eviction.
- Performance aggregates bounded frame samples and changes quality only after sustained evidence.
- Boundaries harden input, ownership migration, renderer adaptation and worker communication.

## Language and ownership policy

New R27 runtime code is TypeScript only. Existing JavaScript production code remains available through explicit compatibility boundaries while ownership is migrated.

A legacy path is considered safe only when the active production owner is a TypeScript module, the legacy file is a thin compatibility shim or rollback source, the typed owner contains the real implementation, and the migration registry documents whether a shim is allowed.

This prevents accidental reintroduction of JavaScript ownership while avoiding a flag-day rewrite.

## Determinism

Simulation-critical code must not read ambient time, ambient randomness or mutable browser state. Inputs arrive as explicit frames; systems receive an explicit RuntimeTick; all ordered collections are sorted before iteration when order affects state.

The fixed-step accumulator caps catch-up work. Large frame spikes produce a R27_SPIRAL_GUARD incident rather than unbounded simulation debt.

## Performance model

R27 treats CPU, render, network, AI and memory as budgets. The adaptive quality controller does not oscillate every frame. It requires sustained over-budget or under-utilized evidence before changing the level, which reduces visual thrashing on noisy hardware.

## Security model

External input is normalized before it reaches simulation systems. Strings, buttons, analog channels, event counts and payload bytes are bounded. Command budgets operate on a deterministic tick window instead of wall-clock time.

## Browser portability

The R27 public surface is engine-agnostic. Rendering is consumed through RuntimeRenderAdapter, worker communication through TypedWorkerBroker, and asset fetching through AssetLoader.

Persistence uses a browser-safe checksum implementation so the module can be bundled by Vite without Node polyfills.

## Verification

Use npm run verify:modern:r27, npm run test:modern:r27 and npm run check:modern:r27.

The verification script checks the complete R27 surface, rejects dynamic-code primitives and blocks accidental Node crypto dependencies inside browser runtime modules.
