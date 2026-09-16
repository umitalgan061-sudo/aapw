# TypeScript 7 Production Runtime Playbook

This repository is adopting TypeScript 7 as the language for new runtime-critical code while retaining the existing JavaScript application until each subsystem has a typed boundary.

## Migration philosophy

A full rewrite would change implementation and architecture at the same time. The project instead uses a strangler path: define stable contracts, place adapters at legacy seams, convert leaf modules, then promote the typed implementation into the application bootstrap.

Every converted module should satisfy strict ESM semantics and should not weaken input validation merely because the previous JavaScript path accepted arbitrary values.

## Runtime layers

The platform contracts define backend, quality, world, asset, frame and persistence vocabularies. Runtime primitives provide a deterministic fixed-step clock and typed event delivery. Schedulers coordinate simulation, rendering preparation, streaming and worker work under explicit budgets.

Asset streaming is priority-based. Cache residency is byte-budgeted. Spatial queries are deterministic. Replay identifiers and random streams are seed-derived so gameplay results can be reproduced without relying on wall-clock ordering.

State changes are transactional and selector-driven. Persistence envelopes are versioned and checksummed. Recovery decisions are produced from explicit integrity probes rather than ad-hoc exception handling.

Renderer boundaries support WebGPU when available and retain WebGL2 fallback. The TypeScript facade therefore does not assume a single GPU API or a single device capability profile.

## Safe conversion order

1. Convert constants, pure math and validators.
2. Convert deterministic utilities and serializers.
3. Convert asset and world data models.
4. Convert worker and scheduler boundaries.
5. Convert renderer orchestration and frame planning.
6. Convert persistence and migration entrypoints.
7. Convert the application bootstrap after all required adapters are covered.

## Rejection rules

Do not use `any` as a substitute for a missing contract. Use `unknown`, normalize at the boundary, and return an explicit failure or throw a typed error where the caller cannot safely continue.

Do not use runtime order as a source of determinism. Sort identifiers before aggregation and derive procedural randomness from stable seeds and labels.

Do not let a renderer failure corrupt gameplay state. Treat device loss, shader failure and asset exhaustion as recoverable runtime conditions and route them through the recovery supervisor.

Do not let telemetry become an accidental data sink. Keep metric names bounded, sanitize tags, cap event buffers and keep identifiers operational rather than personal.

## Review checklist

A TypeScript runtime change is ready for integration when the public boundary is readonly where appropriate, invalid values are rejected, execution ordering is deterministic, resource budgets are explicit, cancellation is handled, recovery is defined, and a focused regression test exists.

The CI foundation intentionally runs independently from the legacy application bundle. That keeps migration progress measurable without forcing an all-at-once packaging change.
