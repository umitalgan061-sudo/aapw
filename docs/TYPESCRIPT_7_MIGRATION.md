# TypeScript 7 Runtime Foundation

The project is moving from JavaScript-first implementation toward a typed TypeScript 7 architecture without a risky flag-day rewrite. The TypeScript project currently publishes TypeScript 7 and recommends gradual adoption for JavaScript codebases.

This foundation types the boundaries that are most costly to get wrong: renderer/backend selection, fixed-step runtime state, asset residency, persistence envelopes, event payloads and legacy adapters.

## Architecture

`src/3d/types/platform.ts` owns stable nouns and discriminated unions. Branded IDs prevent accidental mixing of nodes, assets, worlds and ticks.

`src/3d/types/runtime.ts` supplies a typed event bus, deterministic fixed-step clock and explicit runtime failure representation.

`src/3d/types/adapters.ts` forms the strangler seam around legacy JavaScript objects. It normalizes untrusted values before they enter typed subsystems.

`tsconfig.runtime-foundation.json` enables strict ESM-oriented checking with exact optional properties, unchecked index detection and DOM/WebWorker libraries.

## Migration rule

New critical modules should be TypeScript. Existing JavaScript remains valid during migration, but it must enter typed boundaries through an adapter instead of casting arbitrary values through the runtime.

The CI gate also materializes 4096 deterministic migration contracts covering execution environment, subsystem, compiler strictness, module mode, rendering path, serialization, concurrency, persistence and recovery. This keeps the migration measurable instead of relying on subjective progress.

## Safety

The TypeScript layer is declaration-only and isolated from the current application bootstrap. This preserves the existing production runtime while making future conversions incremental and reviewable.
