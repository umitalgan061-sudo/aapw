# Rust/WASM Hot Path

AAPW keeps the engine TypeScript-first while moving deterministic CPU-heavy primitives into Rust compiled to WebAssembly. The migration is additive: browser compatibility remains intact because every hot-path primitive has a TypeScript implementation and the runtime selects WASM only after a versioned contract check succeeds.

## Runtime architecture

`legacy 3D JavaScript -> typed TypeScript facade -> worker boundary -> Rust/WASM hot path -> WebGPU/WebGL2 renderer`

The existing JavaScript world is not subjected to a risky flag-day rewrite. The typed engine gains a controlled low-level acceleration seam that can be adopted system by system.

## Hot-path responsibilities

- deterministic seeded terrain height sampling;
- distance, visibility and spatial-cell math;
- LOD falloff and bilinear height sampling;
- quantization for stable replay/network signatures;
- bulk point transforms;
- bulk terrain sampling.

## WASM contract

`WasmHotPath` verifies contract version `1` before activating the binary. Normal runtime mode fails over to TypeScript for missing assets, fetch errors or incompatible binaries. Strict mode turns those conditions into explicit initialization failures for acceptance environments.

The release binary is built by `scripts/buildWasmHotPath.mjs` into `public/wasm/aapw_hotpath.wasm`. `npm run build:modern` calls that script before Vite, so production builds package the same WASM path that the browser loads at runtime.

## Worker execution

`workerSimulation.ts` adds a bounded typed worker queue. Terrain and point batches travel as transferable `ArrayBuffer`s rather than JSON payloads. The host rejects duplicate request IDs, caps queue depth and records received/completed/failed/peak-pressure counters. Concurrent dispatches are serialized through a single pump while every request keeps its own response resolver.

## Deterministic conformance catalog

CI materializes four NDJSON shards containing exactly 4,096 vector IDs. The IDs are expanded by `wasmHotPathVectors.ts` into six real input families: height, LOD, distance, spatial hashing, bilinear sampling and quantization. The verifier checks complete ID coverage, expected group distribution, boundary coverage and deterministic repeatability of the TypeScript fallback across all 4,096 vectors.

The catalog is intentionally stored as IDs rather than duplicated expected outputs. This keeps the acceptance artifact compact while the vector-expansion function remains the single deterministic source of truth.

## Build and validation

`npm run build:wasm` compiles the `wasm32-unknown-unknown` release crate and copies the artifact into the Vite public tree. `npm run verify:wasm-hotpath` validates the source contract and exercises all 4,096 deterministic cases. CI additionally runs Cargo target validation, TypeScript typechecking and release-binary existence checks.

Rust is a complement to JavaScript, not a browser compatibility requirement. Devices without a usable WASM asset continue through the TypeScript path; devices with the release binary can use the optimized path without changing gameplay contracts.
