# Modern Production Runtime

Aapw's 3D runtime is now organized around a deterministic TypeScript-first platform while preserving the existing Three.js world as a replaceable presentation adapter.

## Runtime layers

`RuntimeKernel` owns deterministic scheduling, fixed-step time, streaming plans, motion state, snapshots, render packets and diagnostics. `RuntimeSession` adds player-session concerns such as normalized actions, replay, save coordination, playtime and performance telemetry. `ProductionRuntime` composes these services with state transactions, security, networking, snapshots and recovery.

The composition root is deliberately independent of Three.js. A browser scene implements `RuntimeSceneAdapter`, allowing the same runtime to run in headless tests and in the real browser world.

## State ownership

Cross-system mutable state must live behind `RuntimeStateGraph`. Mutations are committed as transactions and become immutable patches with checksums. The graph has explicit depth and node limits to prevent untrusted data from exhausting the browser. Subscribers receive snapshots rather than mutable references.

State mutation sources are classified as engine, UI, network, save, replay or system. This source tag is carried into each committed mutation so later diagnostics can explain how a value changed.

## Security boundary

Incoming payloads are validated before network, asset or input consumers can use them. The boundary limits serialized bytes, nesting depth, array length, object key count and string length. URL policy rejects credentials and unsupported protocols, including data and blob URLs unless explicitly enabled.

Asset metadata is validated separately from downloaded bytes. Each registered asset has an expected type, byte budget and integrity digest. Downloaded content is accepted only after size and digest validation.

## Rendering and performance

The render budget orchestrator combines frame, CPU, GPU, draw-call, triangle, memory and runtime pressure signals. Quality changes use hysteresis so one bad frame does not oscillate quality. Severe pressure can skip directly down multiple tiers.

The quality profiles remain compatible with the project's existing adaptive quality controller. This layer supplies a lower-level production decision record that can be shown in the debug panel or exported to telemetry.

## World interest management

The world coordinator classifies entities as near, mid, far or sleeping based on the player's interest position. A grid index makes radius queries bounded by touched cells rather than scanning every entity. Interest buckets are deterministic and capped independently so large populations cannot monopolize a frame.

World delta replication quantizes transforms, rejects stale revisions and verifies each delta checksum. This is protocol-neutral: the transport layer can be backed by WebSocket, WebTransport, a worker bridge or loopback tests.

## Recovery

Recovery is coordinated instead of letting independent subsystems restart themselves. A full recovery progresses through input, streaming, networking, save, renderer and simulation domains. Each domain may diagnose, quiesce, reset, replay and resume. Attempts are rate limited to avoid recovery storms.

## Browser capabilities

The capability matrix checks WebGPU, WebGL2, OffscreenCanvas, Workers, Service Worker, IndexedDB, BroadcastChannel, SharedArrayBuffer, concurrency, memory hints, save-data and reduced-motion preferences. These signals map to constrained, mobile, tablet or desktop platform profiles.

The project's package currently targets Node 24 LTS for runtime tooling. Node 24.21.0 is an official LTS release as of 8 September 2026. Node 26.8.2 is the current release line. The project intentionally uses the LTS line for reproducible CI while allowing the browser-side code to consume modern Web APIs.

TypeScript 7 is the current compiler line. It is a native implementation aimed at substantially faster large-project checking and preserves the project's strict type-checking model. Vite 8 uses the unified Rolldown bundler, and Vite 8.1 adds an optional bundled development mode for large applications. Vitest 5 is the current major test runner release.

## Migration guard

Legacy modules remain available where the real scene still depends on them, but migration surfaces are explicit. A surface starts legacy or shadowed, accumulates parity evidence, and can only be promoted after at least one successful parity check. A failed parity check moves the surface to blocked until repaired.

This prevents a nominal TypeScript migration from becoming a second, disconnected implementation of the same feature.

## Production checklist

Before release, run:

```text
npm run verify:modern
npm run typecheck
npm test -- --passWithNoTests
npm run build:modern
```

The CI determinism workflow should report success for its deterministic-core guard. A passing individual job does not imply that all repository workflows have passed; repository-wide Actions are intentionally treated independently because this project contains many historical and feature-specific gates.

The production runtime also exposes a health report for in-game diagnostics. A release process should archive the report digest together with the build identifier so a regression can be traced back to the exact runtime state contract.
