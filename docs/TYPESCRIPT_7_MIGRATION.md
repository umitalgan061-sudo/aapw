# TypeScript 7 Runtime Migration

The 3D runtime now has a strict TypeScript foundation that can be adopted incrementally without freezing the existing JavaScript runtime.

## Why TypeScript 7

The TypeScript project currently publishes TypeScript 7 and explicitly supports gradual adoption in JavaScript-heavy applications. The project also documents stricter typing and modern ESM configuration as the direction for current runtimes.

This repository therefore uses a strangler migration:

1. New runtime contracts are authored in TypeScript.
2. Existing JavaScript modules remain executable and can consume generated JavaScript or declaration contracts.
3. Critical subsystem boundaries are typed before individual implementation files are converted.
4. Renderer, worker, asset, persistence and event APIs share the same contracts.
5. CI checks the new TypeScript surface independently of legacy application packaging.

## Compiler posture

`tsconfig.runtime-foundation.json` enables strict checking, exact optional properties, unchecked indexed-access detection, isolated modules, verbatim module syntax and explicit DOM/WebWorker libraries.

The configuration emits declarations only. It is deliberately non-invasive: the existing runtime build remains responsible for its current JavaScript entrypoints while the type foundation becomes the compatibility boundary.

## Runtime contracts

`src/3d/types/runtimeContract.ts` defines branded identifiers, backend and quality vocabularies, transforms, device capabilities, budgets and health telemetry.

`src/3d/types/result.ts` standardizes explicit success/failure handling for browser APIs, worker boundaries and recovery paths.

`src/3d/types/events.ts` provides a typed event bus for runtime, asset, save, world streaming and input events.

`src/3d/types/rendering.ts` describes backend-neutral frame plans while retaining WebGPU/WebGL2 feature gates.

`src/3d/types/assets.ts` models compression, residency, eviction and loading budgets.

`src/3d/types/persistence.ts` establishes versioned save headers, snapshots, envelopes and migration steps.

## Generated migration corpus

CI materializes 4096 deterministic migration contracts spanning language stage, execution context, subsystem, strictness profile, module mode, target, safety primitive, concurrency model, compatibility mode, serialization, asset residency, render path, persistence mode, recovery mode and determinism strategy.

The corpus is not production data. It is a regression surface: changes that accidentally weaken one of the migration dimensions can be detected before the JavaScript-to-TypeScript conversion reaches a runtime-critical module.

## Conversion order

The intended order is contracts first, leaf utilities second, subsystem adapters third, bootstrap code last. This avoids a flag-day rewrite and preserves the current working WebGPU/WebGL2 fallback architecture while increasing compile-time guarantees around it.
