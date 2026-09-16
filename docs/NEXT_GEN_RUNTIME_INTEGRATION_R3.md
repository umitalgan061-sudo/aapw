# Next-generation runtime integration R3

R3 turns the previous declarative renderer stack into a usable runtime policy layer without forcing a hard WebGPU dependency on the shipped browser game.

## Runtime ownership

`src/3d/rendering/renderRuntimeCoordinator.js` owns frame-time observations, quality hysteresis, dynamic-resolution smoothing, feature shedding, and a read-only snapshot. It deliberately does not own the scene graph or gameplay tick. The existing `game3d.js` loop remains the authority for simulation updates.

The coordinator can attach the already-created renderer adapter. This keeps the current synchronous `createScene()` bootstrap safe while making backend selection and output policy observable to the runtime. A later asynchronous renderer migration can replace the adapter without moving quality policy into gameplay code.

## Material path

`materialRuntimeOptimizer.js` computes a runtime recipe from quality, backend, screen coverage, distance, importance and memory pressure. Authored materials remain untouched until a loader explicitly applies a recipe to a runtime clone. The recipe controls normal/AO/emissive participation, anisotropy, alpha hashing and advanced layering.

The important invariant is that asset identity and authored material definitions are never rewritten merely because a device is under pressure. The optimization is reversible at the resource boundary.

## Streaming path

`streamingBudgetController.js` creates deterministic requests and admission plans for terrain, vegetation, props, characters, fauna and effects. Camera velocity contributes a bounded look-ahead distance, while category priorities preserve terrain and character continuity during memory pressure.

The planner separates admission from loading. A loader may start the admitted requests; completion and release feed the controller's resident-byte accounting. No request is allowed to consume more concurrency or in-flight memory than the configured budget.

## Contract corpus

`scripts/generateNextGenRuntimeContractMatrixR3.mjs` generates a deterministic 4×4×4×4×4 matrix: backend mode, quality tier, device class, load state and scene class. The 4096 cases validate that backend fallback, post effects, dynamic-resolution scale, streaming concurrency and material feature flags stay stable across the full state space.

The generated artifact is committed by CI with `[skip ci]`. It is intentionally data-heavy: the corpus is the executable compatibility contract, not filler documentation.

## Frame-pressure behavior

The controller uses a rolling frame-time window and hysteresis. Sustained pressure moves the quality tier downward one step; sustained healthy frames move it upward one step. Resolution is moved gradually toward the recommended value rather than snapping, which avoids a visible resolution sawtooth when workloads oscillate around the target.

The policy is conservative under pressure. Expensive WebGPU-only effects such as SSGI and depth-of-field are shed before the base scene is compromised. WebGL2 remains a complete supported backend.

## Verification

The R3 acceptance suite checks deterministic behavior, quality transitions, material recipes, streaming order stability, WebGPU/WebGL2 feature divergence and GPU-budget shedding. The matrix generator independently validates that every contract row has a unique identifier and exactly 30 fields.

## Integration sequence

1. Boot with the existing scene bootstrap.
2. Attach the renderer adapter to the runtime coordinator.
3. Feed frame-time and scene metrics from the render loop.
4. Apply the coordinator's dynamic-resolution scale to the adapter.
5. Feed asset memory/completion events into the streaming controller.
6. Apply material recipes only to runtime-loaded clones.
7. Keep gameplay, physics and authoritative world state independent of render policy.

## Failure policy

A missing WebGPU implementation is not an error when the requested path is optional. The adapter chooses WebGL2. A missing GLB or texture remains eligible for the existing procedural fallback. A policy observer throwing an exception cannot interrupt the render loop. These rules keep visual upgrades additive rather than turning optional modern features into boot blockers.
