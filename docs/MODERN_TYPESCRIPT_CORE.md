# Modern TypeScript Core

The 3D game now has a TypeScript-first runtime kernel alongside the legacy JavaScript presentation layer.

## Why this migration

The project has grown to hundreds of gameplay, world, editor, renderer and validation modules. A flag-day conversion would create an unnecessarily large regression surface. The migration therefore uses a typed core plus compatibility adapters. New systems are required to be TypeScript, while legacy JavaScript continues to serve existing screens until each boundary is migrated.

## Technology baseline

- TypeScript 7 with strict checking.
- ES2024 output and Vite for the modern build path.
- Three.js r186 as the current renderer dependency.
- WebGPU-first policy with WebGL2 fallback.
- OffscreenCanvas and worker-compatible contracts.
- AbortSignal-driven cancellation and deterministic task ordering.

Three.js documents WebGPURenderer as the modern renderer with WebGL2 fallback, and its WebGPU post-processing stack provides built-in MRT and effect composition. TypeScript 7 is the current native compiler line, so the new code targets that toolchain while avoiding unstable APIs.

## Runtime boundaries

`types.ts` defines the public contracts shared by all systems. Brand types prevent accidental cross-use of IDs. `Result<T, E>` keeps recoverable runtime errors explicit.

`eventBus.ts` provides mutation-safe events and a deterministic XorShift32 random stream. The random generator is useful for replays, fauna placement and procedural world tasks because the same seed produces the same sequence.

`frameScheduler.ts` separates rendering from background work. Critical tasks are serviced first; low-priority work ages toward service rather than starving forever. `FixedStepClock` bounds catch-up so a tab wake-up cannot execute an unbounded simulation loop.

`adaptiveQuality.ts` uses hysteresis instead of per-frame quality switching. GPU/CPU pressure changes the quality tier only after sustained pressure or sustained headroom, and resolution scale changes independently.

`assetRegistry.ts` adds explicit residency ownership. References, pins, dependency loading, byte budgets and eviction are managed centrally. Loaders are intentionally pluggable so GLTF, textures, audio and binary data do not duplicate lifecycle logic.

`spatialIndex.ts` provides a renderer-independent uniform grid for proximity and visibility candidates. Sorting uses distance then stable entity ID, which makes query output deterministic.

`rendererKernel.ts` owns backend choice, quality budgets, dynamic pixel ratio and optional-pass shedding. It is intentionally compatible with a WebGPU adapter and does not force the legacy renderer to migrate before the application is ready.

`saveStore.ts` introduces versioned save envelopes, checksums, staging writes, metadata, corruption handling and a memory fallback. This makes save integrity a runtime concern rather than scattered UI logic.

`workerBridge.ts` defines a promise-based RPC layer with bounded in-flight requests, cancellation and timeouts. `InlineWorkerTransport` provides deterministic local testing without requiring a browser Worker.

`compatibility.ts` is the migration seam for `sceneManager.js`, UI modules and the existing browser entrypoint. It reports which modern capabilities are active and provides defensive canvas/device-pixel-ratio helpers.

## Migration rule

1. New runtime systems are TypeScript.
2. Legacy JS remains behavior-compatible until its boundary has a typed replacement.
3. Every migrated boundary receives a deterministic acceptance test.
4. Renderer, simulation and persistence APIs use explicit capability/error contracts.
5. No compatibility bridge is allowed to introduce a second source of truth.

## Verification

Run `npm run check:modern` after installing dependencies. It performs strict TypeScript checking and executes the deterministic modern-runtime test harness.

The runtime core is intentionally independent from Firebase hosting and the existing static page structure. A later integration change can import `bootModernRuntime()` from a tiny application adapter, while the current production page remains stable throughout the migration.
