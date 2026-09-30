# Immersive Audio Operations

## Scope

The 3D runtime now treats audio as an explicit, bounded presentation layer. Existing gameplay systems remain authoritative for combat, movement, weather, settlements, dialogue and world state. The audio platform consumes those signals and does not mutate gameplay state.

## Runtime pipeline

1. **Semantic cue routing** converts world and gameplay events into canonical audio intents.
2. **Spatial admission** ranks emitters by priority, distance and voice cost.
3. **Environment resolution** derives biome, weather, day/night and room context.
4. **Occlusion/reverb** produces bounded filter and room guidance.
5. **Mix policy** applies focus, ducking, accessibility and loudness constraints.
6. **Cue scheduling** suppresses duplicates and spreads transient load.
7. **Web Audio adapter** creates or reuses graph nodes only for admitted voices.
8. **Snapshot/QA** exposes immutable diagnostics and deterministic receipts.

## Performance contract

The default registry is bounded to 48 sources and 28 positional voices. Sources outside their effective distance are virtualized rather than kept as active graph nodes. Every per-frame policy clamps numeric inputs and returns immutable receipts suitable for headless validation.

The continuous-emitter layer additionally supports distance fade, environment energy, occlusion attenuation and low-pass guidance without allocating Web Audio objects. This lets tests validate the full decision surface without requiring a browser audio device.

## Accessibility contract

The platform supports full, reduced-dynamic-range, night-sensitive and headphone-oriented range modes. Dialogue can receive an intelligibility-preserving center boost and competing ambience suppression. Reduced-hearing mode never disables positional context; it changes gain and frequency guidance.

## State model

Music and ambience react to semantic states such as exploration, settlement, combat, danger, night, storm, victory, defeat and menu focus. Transitions are deterministic and use bounded crossfades. Menu or dialogue focus may duck background layers while preserving the primary interaction channel.

## Failure behavior

Audio is non-critical. Unsupported Web Audio, missing asset files, suspended contexts, graph-node failures or invalid input must disable only the affected audio path and never reject world boot. Disposal is idempotent and must detach listeners and release owned graph resources.

## QA expectations

Every production policy must have:

- input normalization and finite-number handling;
- deterministic repeated evaluation;
- explicit range assertions;
- bounded output/history/voice counts;
- disposal/fail-closed coverage where stateful;
- ownership checks ensuring no second gameplay authority is created.

The `checkImmersiveAudioExperiencePolicies.mjs` contract executes the continuous-emitter, dynamic-range and dialogue-clarity policies directly in Node without browser globals.

## Compatibility

The legacy `audioManager.js` public surface (`playClick`, `playDiscoveryChime`, `setMuted`, `isMuted`, `dispose`) remains available. The new platform is an additive orchestration layer and may progressively adopt its adapters without forcing a migration of existing callers.
