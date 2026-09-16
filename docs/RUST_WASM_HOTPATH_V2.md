# Rust/WASM Hot Path V2

This slice makes the performance-critical numerical layer native Rust while keeping browser orchestration and public APIs in TypeScript.

## Boundary

TypeScript owns application state, lifecycle, persistence, workers, network, UI and rendering policy. Rust owns deterministic arithmetic that benefits from compact native code: motion steering, integration, flocking, LOD, culling-distance, spawn placement, fixed-step accounting and hashing.

The WASM module remains optional. The TypeScript bridge validates the ABI version and bounds untrusted inputs before crossing the JS/WASM boundary.

## ABI v2

`version()` returns `2`. Output values are written into the bounded scratch region supplied by the module. The bridge exposes typed tuples instead of leaking raw pointers to the rest of the application.

## Coverage

CI generates 4,096 deterministic policy cases from four independent dimensions (8 × 8 × 8 × 8), validates uniqueness and safety markers, builds the Rust target, checks exported ABI names, and typechecks the TypeScript bridge.
