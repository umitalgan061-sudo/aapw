# Render Quality Governor R2

This production policy layer makes render-quality decisions deterministic, bounded, and capability-aware.

## Scope

`renderBackendCapability.js` remains responsible for discovering available backends and selecting the initial capability tier. `renderQualityGovernorR2.js` is a downstream policy adapter for runtime quality changes. It never creates a renderer and never owns scene, assets, materials, camera, input, physics, or Three.js lifecycle.

## Runtime inputs

The governor accepts normalized frame time, GPU/CPU time, draw-call and triangle counts, memory pressure, thermal pressure, battery state, visibility, input activity, and an optional user quality ceiling.

## Runtime outputs

Each evaluation returns an immutable state transition and bounded profile covering pixel ratio, shadow resolution, foliage density, water segments, post-processing, temporal history, animation rate, and reduced-motion state.

## Control behavior

Quality reductions require a sustained overload streak, while recovery requires a longer healthy streak. This prevents oscillation around a frame-time boundary. Critical thermal or battery conditions force aggressive degradation. Hidden inactive scenes enter a compatibility profile to minimize background work.

## Determinism

The policy contains no wall-clock dependence and no random source. Identical telemetry, context and starting state produce identical profiles and digests. The matrix runner exercises more than four thousand stable vectors across renderer backend, quality tier, and frame-time envelopes.

## Safety limits

History, pixel ratio, shadows, animation rate and all scalar pressure inputs are bounded. Disposal fails closed. Results are frozen before returning to callers.

## Integration rule

The caller owns application. The governor only recommends the next profile; it does not mutate renderer objects or create a second render pipeline.
