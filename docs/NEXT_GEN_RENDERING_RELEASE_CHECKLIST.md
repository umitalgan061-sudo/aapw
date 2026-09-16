# Next-Generation Rendering Release Checklist

## Source integrity

- [ ] All new modules use deterministic inputs only.
- [ ] No `Math.random()` in render policy logic.
- [ ] No `Date.now()` in frame decision logic.
- [ ] Pure policy modules do not import Three.js or browser globals.
- [ ] Public packets are immutable and bounded.

## Backend

- [ ] WebGPU capability is explicitly negotiated.
- [ ] WebGL2 fallback remains available.
- [ ] WebGPU initialization is awaited where the adapter contract requires it.
- [ ] Backend failure has a bounded recovery path.
- [ ] Device loss can trigger renderer/resource rebuild through owner callbacks.

Three.js's current WebGPURenderer documentation describes asynchronous initialization and WebGL2 fallback. The release
must therefore never assume that `navigator.gpu` presence means renderer creation is guaranteed.

## Quality

- [ ] Dynamic resolution has a minimum scale and maximum scale.
- [ ] Resolution changes use smoothing and dwell.
- [ ] Thermal pressure cannot create oscillating quality changes every frame.
- [ ] Reduced-motion is respected by the feature negotiation layer.
- [ ] Data-saver can reduce non-essential workload.

## Post-processing

- [ ] WebGPU effects use the modern RenderPipeline/TSL-oriented descriptor.
- [ ] WebGL2 never receives WebGPU-only effects such as SSGI/DoF in the policy descriptor.
- [ ] Effect budget is bounded.
- [ ] Optional effects can be rejected without invalidating mandatory passes.
- [ ] MRT use is explicit and backend-gated.

Three.js documents the modern `RenderPipeline` and MRT-oriented post-processing stack for WebGPURenderer.

## Temporal rendering

- [ ] History starts invalid.
- [ ] History warms up deterministically.
- [ ] Camera cut invalidates history.
- [ ] Resize invalidates history.
- [ ] Backend recovery invalidates history.
- [ ] Large render-scale jumps invalidate history.
- [ ] Long visibility gaps invalidate history.

## Scene scalability

- [ ] Visibility scheduler caps input and output.
- [ ] LOD assignment uses temporal hysteresis.
- [ ] Occlusion hints expire when stale.
- [ ] Instance batches are bounded per tier.
- [ ] Texture residency has a hard memory budget.
- [ ] Frame-graph transient resources expose lifetime and aliasing opportunities.

## Materials and shaders

- [ ] Legacy shader materials are classified.
- [ ] `onBeforeCompile()`/raw shader paths are explicitly flagged.
- [ ] Shader feature order produces a canonical variant key.
- [ ] Variant count is bounded.
- [ ] Compile budget is bounded.
- [ ] Material fallback is preserved until visual parity is proven.

## Recovery

- [ ] Renderer loss transitions are observable.
- [ ] Retry attempts are bounded.
- [ ] Backoff is deterministic.
- [ ] Fallback backend selection is explicit.
- [ ] Exhausted state cannot silently continue using stale GPU resources.

## Telemetry

- [ ] Frame/cpu/gpu timings are recorded.
- [ ] Draw/triangle/instance counts are recorded.
- [ ] Render scale and tier are recorded.
- [ ] Backend transitions are recorded.
- [ ] Recovery attempts are recorded.
- [ ] Telemetry history is bounded.
- [ ] Network transport is not embedded in render policy modules.

## Acceptance

- [ ] Comprehensive contract passes.
- [ ] Adversarial capacity contract passes.
- [ ] Backend/quality matrix passes.
- [ ] Large-scene stress passes.
- [ ] Feature negotiation/fallback passes.
- [ ] Deterministic telemetry/replay passes.
- [ ] Backend integration contract passes.
- [ ] `git diff --check` passes.
- [ ] Ownership scan passes.
- [ ] Meaningful addition gate is greater than 4,000.
- [ ] Exact current main SHA is recorded before merge.
- [ ] PR `expected_head_sha` matches the final head at merge.

## Browser verification

- [ ] WebGPU-capable browser initializes the renderer.
- [ ] Non-WebGPU browser uses WebGL2 fallback.
- [ ] Canvas resize behaves correctly.
- [ ] DPR scaling stays inside the policy bounds.
- [ ] No unexpected console errors appear during start/resize/recovery.
- [ ] PWA shell/service worker still loads.
- [ ] Offline mode does not crash the renderer policy.

## Performance review

- [ ] Benchmark p50/p95/p99 artifacts are captured.
- [ ] A high-pressure trace shows render scale reduction.
- [ ] A recovery trace shows bounded backend fallback.
- [ ] A large-scene trace shows deferred renderables/instances/textures instead of unbounded growth.
- [ ] No absolute FPS claim is made from headless benchmarks alone.

## Release semantics

A completed CI workflow is required before declaring a CI PASS. `queued` and `in_progress` are pending states.
A release note should include the actual backend matrix, policy revision and merge SHA.
