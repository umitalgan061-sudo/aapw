# Next-Generation Rendering Stack

## Scope

This layer upgrades AAPW's presentation path without replacing the existing world, player, physics, navigation, ecology, asset, persistence or UI owners. It provides a render-backend seam, a declarative pipeline policy, deterministic GPU instance budgets and texture residency decisions.

## Backend strategy

The preferred path is Three.js `WebGPURenderer` where the browser and current build expose it. The fallback is the existing WebGL2 renderer. The application should never choose WebGPU solely because a browser advertises `navigator.gpu`; renderer module availability, initialization and runtime failure are part of the decision boundary.

Three.js' WebGPURenderer is an asynchronous renderer and can also target a WebGL2 backend. The adapter therefore returns a normalized `{ backend, renderer, three, initialized, fallback }` record and keeps construction outside gameplay modules.

## Rendering policy

The pipeline policy separates intent from implementation. It may request temporal history, MRT, TAA/FXAA, bloom, SSAO, SSGI, DoF, LUT and other effects. The policy derives a stable tier from runtime quality, backend and platform pressure, then caps resolution and effect cost.

The WebGPU path is intentionally the only path allowed to request WebGPU-specific effects such as SSGI or DoF in the policy. WebGL2 can still receive a useful post-process profile without pretending those nodes are available.

## GPU instancing

Repeated foliage, rocks, props, debris and crowds can share geometry/material batches. The planner receives descriptors and returns an accepted list grouped by a stable `geometryKey|materialKey|lod` identity.

Important properties:

- input-order invariance;
- distance culling;
- visibility filtering;
- importance ordering;
- per-tier instance limits;
- per-tier batch limits;
- deterministic tie-breaking;
- explicit rejected work for later streaming.

The planner does not instantiate Three.js objects itself. This avoids hidden ownership and leaves actual `InstancedMesh`, `Mesh`, geometry and material lifetimes with the scene/asset systems.

## Texture residency

Texture residency is policy rather than direct GPU disposal. Each texture receives a requested mip based on screen coverage, camera distance, importance and quality tier. The planner then builds a byte-bounded resident/deferred plan.

Compression-aware byte estimation is approximate by design. Runtime loaders remain authoritative for actual compressed GPU allocations. The plan's goal is to make memory pressure visible early enough for the asset system to defer less important textures.

## Output/color policy

The adapter can normalize sRGB output and exposure where the renderer exposes the matching properties. The pipeline policy additionally names output buffer preference (`half-float` or `unsigned-byte`) so future scene implementations do not hard-code buffer precision in effect code.

## Incremental migration

A safe migration sequence is:

1. instantiate the adapter behind the current renderer factory;
2. run the existing scene unchanged under WebGL2;
3. enable WebGPU for a gated cohort of supported profiles;
4. port custom ShaderMaterial/onBeforeCompile paths to TSL/node materials where required;
5. add RenderPipeline post-processing only after the corresponding scene materials are validated;
6. progressively move static repeated content to instancing and GPU-friendly batches;
7. use the texture residency plan to drive deferred asset hydration.

## Failure handling

Renderer initialization must remain fail-soft. A WebGPU module import or `init()` failure falls through to WebGL2. A post-processing policy failure must be represented as a disabled effect rather than terminating boot. Streaming/instancing/residency planning failures must return empty/deferred plans so presentation can continue at reduced fidelity.

## Determinism and acceptance

`artifacts/next-gen-rendering-r1/rendering-policy.matrix` contains 4,096 unique backend/tier/scene/screen/thermal/accessibility combinations. The acceptance runner also reverses the instance input order and requires the same selected IDs, checks memory budget bounds and verifies that WebGPU-only effects do not leak into the WebGL2 profile.

## Future WebGPU path

Three.js' current direction is to use WebGPURenderer, TSL and a node-based RenderPipeline. The repository should prefer the official renderer integration instead of maintaining a custom WebGPU abstraction layer. Custom shader code that depends on `ShaderMaterial` or `onBeforeCompile` must be migrated individually because those APIs are not supported by WebGPURenderer.
