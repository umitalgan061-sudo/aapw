# Rust/WASM Hot Path

AAPW is now TypeScript-first at the engine boundary, with Rust/WASM reserved for deterministic, CPU-heavy primitives that benefit from a low-level implementation. This is additive: browser compatibility remains intact because every WASM primitive has a TypeScript fallback.

## Architecture

`legacy 3D JavaScript -> typed TypeScript façade -> worker boundary -> Rust/WASM hot path -> renderer`

The existing 3D world is not forced through a risky flag-day rewrite. The critical math seam is strongly typed and can be adopted system by system.

## Hot-path responsibilities

- deterministic seeded terrain height sampling;
- distance and visibility math;
- spatial cell hashing;
- LOD falloff;
- bilinear height sampling;
- quantization for stable replay/network signatures;
- bulk point transforms;
- bulk terrain sampling.

## Fallback contract

`WasmHotPath` selects WASM only after the binary loads and reports the expected contract version. Normal mode falls back to TypeScript on missing binaries, fetch errors or ABI mismatch. `strict` mode turns those conditions into explicit initialization failures for production acceptance tests.

## Worker execution

`workerSimulation.ts` adds a bounded typed worker queue. Geometry/terrain batches are transferred as `ArrayBuffer`s rather than JSON payloads. Queue depth, failures and peak pressure are observable.

## Verification corpus

CI generates exactly 4,096 NDJSON vectors across six math families. The corpus is materialized in git so reviewers can inspect and diff the deterministic contract. The corpus is regenerated on every relevant workflow run; no hand-maintained expected-output table is required.

## Build requirements

Node 24 and TypeScript 7 are already the repository baseline. Vite 8 is the production bundler. The WASM crate uses a release profile with LTO and one codegen unit for the smallest deterministic hot path.

WebAssembly is deliberately treated as a complement to JavaScript rather than a replacement. Off-main-thread execution uses standard Web Workers when a caller opts into the worker façade.
