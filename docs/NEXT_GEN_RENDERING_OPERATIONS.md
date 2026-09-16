# Next-Generation Rendering Operations

## 1. What the stack now controls

The hardening layer now covers the full decision path around the renderer:

```text
capabilities
   ↓
feature negotiation
   ↓
quality / pressure
   ↓
dynamic resolution
   ↓
visibility + occlusion hints
   ↓
instancing + texture residency
   ↓
shader/material readiness
   ↓
render pass budget
   ↓
frame graph
   ↓
temporal history
   ↓
device recovery
   ↓
metrics + frame packet
```

The physical renderer remains a separate owner.

## 2. WebGPU first, WebGL2 always available

Modern Three.js positions `WebGPURenderer` as the next-generation renderer while keeping a WebGL2 backend/fallback path.
The project therefore treats WebGPU as the preferred path where capability and initialization allow it, not as a hard
requirement for application startup.

A failed WebGPU initialization must not prevent a usable WebGL2 session. A later runtime device loss should enter the
recovery coordinator rather than crashing the gameplay loop.

## 3. Renderer initialization rule

The application composition root should perform:

```text
capability check
     ↓
request backend
     ↓
create renderer
     ↓
await initialization when required
     ↓
attach recovery signal
     ↓
start scene presentation
```

The policy modules should not import `three`, `three/webgpu`, DOM classes or a browser renderer.

## 4. Feature negotiation rule

Every modern render feature has three states:

```text
requested → supported → enabled
```

A fourth state, `rejected`, is recorded for diagnostics.

This avoids false-positive configurations such as:

```js
{
  backend: 'webgl2',
  effects: ['ssgi']
}
```

when SSGI requires the WebGPU-oriented path in the current policy.

## 5. Dynamic resolution operating model

The governor is designed to respond to sustained pressure, not single-frame spikes.

Normal state:

- smoothing active;
- hysteresis active;
- minimum dwell frames active;
- scale increases slowly.

Pressure state:

- scale decreases faster than it increases;
- thermal pressure can accelerate downscale;
- forced scale can lock the value for debugging.

Do not wire render scale into gameplay delta time.

## 6. Pressure thresholds

The GPU pressure model combines:

- GPU time;
- CPU time;
- total frame time;
- memory utilization;
- thermal pressure.

`warning` means optional work should be reconsidered.
`critical` means the runtime should reduce render complexity aggressively.

A pressure state is a presentation/performance signal; it must not mutate authoritative world state.

## 7. Visibility scheduling

Use `renderVisibilityScheduler` for candidate selection before expensive physical rendering work.

Candidate inputs should include:

```js
{
  id,
  distance,
  projectedArea,
  importance,
  motionFactor,
  temporalImportance,
  frustumVisible,
  visible,
  geometryKey,
  materialKey,
}
```

The scheduler returns deterministic LOD categories and a bounded deferred list.

Real frustum/occlusion implementation remains renderer-owned.

## 8. Occlusion hint rule

`occlusionHintPlanner` is not a GPU occlusion query system.

It is a temporal hint cache. The renderer can later feed actual query results into the same seam.

A stale hint must not permanently hide content. Staleness explicitly lowers confidence in the cached observation.

## 9. GPU instancing

Use `gpuInstanceBatchPlanner` where many renderables share:

- geometry;
- material;
- LOD family.

The batch planner produces descriptors. The actual scene owner can then create `InstancedMesh` or a backend-specific
representation.

Never move collision objects, navigation markers or authoritative gameplay entities into render-only instancing.

## 10. Texture residency

Texture residency should be connected to the asset streaming system.

The planner estimates the required mip and bytes. The asset system decides whether decoding/uploading/disposal is
actually performed.

When memory pressure rises:

```text
high-importance / visible
        ↓
keep detailed

low-importance / far
        ↓
defer or lower mip
```

Do not dispose physical textures merely because the planner says “deferred”; the physical asset owner must own that
lifecycle.

## 11. Shader variant control

Variant count can grow rapidly when material features are combined.

`shaderVariantRegistry` creates a canonical key so feature ordering does not create duplicate logical variants.

Example:

```text
webgpu|high|standard|fog,normalMap,skinning
```

and:

```text
webgpu|high|standard|skinning,normalMap,fog
```

resolve to the same canonical variant.

The renderer decides when to compile; this registry controls planning and diagnostics.

## 12. Material migration

Before enabling a WebGPU rollout, collect readiness from the material registry.

Priority order for migration:

1. blocked materials using raw shader paths;
2. frequent on-screen legacy shader materials;
3. high-variant families;
4. rare/background legacy families.

The registry does not translate shaders automatically. It exposes the work that must be deliberately migrated to node
materials/TSL or kept on a fallback path.

## 13. Post-processing

The WebGPU path should use the modern RenderPipeline/TSL-oriented approach where supported. The renderer's modern
post-processing stack can combine effects and use MRT more naturally than the legacy path.

The repository composer therefore emits a descriptor rather than creating effect objects.

Recommended rollout:

```text
scene pass
 → temporal history
 → bloom/SSAO
 → optional expensive effect
 → output transform
```

The final chain must respect backend and budget constraints.

## 14. Frame graph

`frameGraphResourcePlanner` allows the app to reason about logical resource lifetimes before physical allocation.

For each resource:

- first pass;
- last pass;
- format;
- size;
- sample count;
- transient flag
are explicit.

This enables deterministic aliasing plans and makes transient memory pressure observable.

Actual GPU resource allocation remains outside the planner.

## 15. Pass budget

When GPU pressure rises, optional post-processing should be the first place where work can be dropped.

Every pass should declare:

```js
{
  id,
  costMs,
  priority,
  optional,
}
```

A mandatory pass is never silently dropped just because the budget is exceeded.

An optional pass can be deferred. The rejection should remain visible in telemetry.

## 16. Temporal history

History must be reset when previous-frame assumptions are no longer valid.

Reset events include:

- bootstrap;
- resize;
- camera cut;
- backend recovery;
- render-scale jump;
- visibility gap;
- scene reset;
- quality change.

When history is invalid, the renderer should warm up rather than sampling stale data.

## 17. Device-loss handling

The recovery coordinator is intentionally callback-driven.

Renderer owner supplies:

```js
rebuild({ attempt, backend })
fallback({ backend, error, attempt })
```

The coordinator handles retry budget, backoff and state transition. It does not touch scene or GPU objects.

Typical state flow:

```text
healthy
  ↓
suspected-loss
  ↓
rebuilding
  ├── success → degraded → healthy
  └── repeated failure → fallback / exhausted
```

If the device is lost, resources tied to the old device must be recreated by the renderer/asset owners before normal
presentation resumes.

## 18. Frame packet

The canonical frame packet is designed to be:</n

- immutable;
- bounded;
- replay/debug friendly;
- free of GPU handles;
- safe to serialize.

It should be the only packet the renderer composition root needs from the policy stack.

## 19. Recommended runtime composition

```js
const orchestrator = createNextGenRenderOrchestrator();

const frame = orchestrator.renderFrame({
  backend,
  runtimeTier,
  hardwareScore,
  frameMs,
  cpuMs,
  gpuMs,
  thermalPressure,
  width,
  height,
  renderables,
  instances,
  textures,
  shaderRequests,
});

const packet = createRenderFramePacket(frame);
```

Then the renderer owner consumes the packet and performs actual rendering.

## 20. Operational telemetry

Track:

```text
render.frameMs p50/p95/p99
render.gpuMs p50/p95/p99
render.cpuMs p50/p95/p99
renderScale
backend
quality tier
draw calls
instances
triangles
texture utilization
deferred textures
deferred renderables
post-process rejections
shader variant count
recovery attempts
recovery state
history reset reason
```

Do not rely on average frame time alone.

## 21. Release gates

A rendering hardening change is not complete until these pass:

- Node syntax for all render policy files;
- comprehensive contract;
- backend/quality matrix;
- adversarial capacity test;
- large-scene stress;
- integration/fallback contract;
- deterministic repeat;
- `git diff --check`;
- ownership scan;
- meaningful-addition gate;
- current-main freshness check.

CI state must be reported literally. `queued`, `in_progress`, `failure`, and `success` are distinct states.

## 22. Debugging playbook

### GPU spikes

Check pressure model → pass budget → dynamic resolution → shader variants → texture residency.

### Pop-in

Check visibility scheduler → occlusion hints → texture mip policy → instance deferred list.

### Ghosting

Check temporal history reset → render-scale jump threshold → camera-cut signal → backend recovery.

### WebGPU-only failure

Check feature negotiation → material migration registry → renderer initialization → recovery coordinator → WebGL2 fallback.

### Memory growth

Check texture residency budget → frame graph transient aliasing → instance batches → renderer/asset physical disposal.

## 23. Browser caveat

WebGPU availability varies by browser/platform and requires a secure context. The `navigator.gpu` presence is only the
first capability signal; adapter request and renderer initialization remain runtime decisions.

## 24. Design principle

The objective is not to make every device run every effect. The objective is to make the renderer degrade gracefully,
remain debuggable, preserve the existing WebGL2 path, and use modern WebGPU/TSL features where the actual environment
supports them.
