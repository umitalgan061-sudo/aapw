# Next-Generation Rendering Migration

## Current baseline

AAPW now has two rendering layers that must be treated separately:

1. `nextGenRendererAdapter.js` — physical Three.js renderer selection and initialization;
2. hardening policy modules — backend negotiation, quality, resource planning, recovery and telemetry.

The second layer deliberately does not replace the first one.

## Migration order

### Phase A — backend seam

Keep the existing renderer factory as the application owner. Route renderer creation through
`createNextGenRenderer()` while keeping the current WebGL2 configuration as the compatibility baseline.

Acceptance:

- WebGL2 smoke still renders;
- no scene import changes required;
- renderer disposal remains explicit.

### Phase B — policy packet

Introduce `createNextGenRenderOrchestrator()` next to the current renderer factory.

The orchestrator should receive:

```js
{
  backend,
  runtimeTier,
  hardwareScore,
  width,
  height,
  frameMs,
  cpuMs,
  gpuMs,
  thermalPressure,
  visibility,
  renderables,
  instances,
  textures,
  shaderRequests,
}
```

It returns a renderer-neutral packet. Scene rendering does not move into the orchestrator.

### Phase C — dynamic resolution

Connect `dynamicResolutionGovernor` output to renderer `setPixelRatio()`/render-scale policy. Keep
camera/projection ownership in the current scene renderer.

Do not alter simulation speed when render scale changes. Render scale is presentation-only.

### Phase D — instancing

Start with static repeated assets:

- grass;
- rocks;
- debris;
- repeated settlement props;
- distant crowd geometry.

Only after visual parity is verified should the physical scene owner consume `gpuInstanceBatchPlanner`
batch descriptors.

Do not move actor lifecycle or collision geometry into render-only instances.

### Phase E — texture residency

Feed `textureResidencyPlanner` into the asset streaming layer. The planner decides which logical textures
are resident/deferred; the asset layer decides actual decode/upload/disposal.

Start with large terrain/environment textures because they typically provide an obvious residency budget.

### Phase F — temporal history

Introduce history only after render scale and camera-cut signals are reliable. History must be reset on:

- camera cut;
- resize;
- backend rebuild;
- large scale jump;
- long hidden-tab gap.

### Phase G — post-processing

The project should prefer Three.js' WebGPURenderer `RenderPipeline`/TSL model for the WebGPU path. A WebGL2
fallback may keep a conservative legacy path until the material stack is ready.

For every effect add:

```text
requested
supported
enabled
estimated cost
```

An effect must never be “enabled” solely because a config flag exists.

### Phase H — materials

Run `renderMaterialMigrationRegistry` over the current material catalog.

Prioritize:

1. `blocked` materials using unsupported shader paths;
2. high-variant legacy materials;
3. frequently visible materials;
4. low-risk standard materials.

For each migration keep a WebGL2 fallback until WebGPU visual parity is demonstrated.

### Phase I — device recovery

Attach `GPUDevice.lost` or equivalent renderer-owned loss signal to `renderDeviceRecovery`.

The renderer owner then:

1. marks current backend unhealthy;
2. stops submitting new frame work;
3. rebuilds device/resources;
4. resets temporal history;
5. retries limited times;
6. falls back to WebGL2 when policy requests it;
7. resumes scene rendering.

Do not silently continue using resources from a lost device.

### Phase J — observability

Record render metrics every frame at a bounded rate. Recommended fields:

```text
frameMs
cpuMs
gpuMs
drawCalls
triangles
instances
renderScale
backend
tier
recoveryState
```

Use percentiles for release comparison instead of averages only.

## WebGPU migration hazards

### ShaderMaterial and onBeforeCompile

Custom shader paths that depend on old WebGL renderer APIs should not be partially translated. Register them as
`legacy-webgl` or `blocked` until a deliberate TSL/node-material migration is available.

### EffectComposer assumptions

A renderer-agnostic “composer” abstraction can hide incompatible post-processing semantics. Use the policy/composer
modules in this repository only as descriptors; let backend-specific renderer code build the actual graph.

### Camera history

A dynamic-resolution governor that changes scale without informing temporal history can create ghosting or unstable
reprojection. Always connect scale-jump events to `renderTemporalHistoryPolicy`.

### Memory leaks

A bounded logical residency planner does not automatically prevent GPU memory leaks. The asset owner must dispose
old WebGL/WebGPU objects and recreate them when required.

## Rollback strategy

Every migration must have a reversible gate:

```text
feature flag ON
  ↓
render backend modern path
  ↓
health/recovery telemetry
  ↓
feature flag OFF
  ↓
existing WebGL2 path
```

Do not delete the fallback until the project has stable browser/device evidence across the target matrix.

## Compatibility matrix

At minimum test:

```text
WebGPU + ultra
WebGPU + high
WebGPU + balanced
WebGPU + minimal
WebGL2 + ultra-requested
WebGL2 + high
WebGL2 + balanced
WebGL2 + minimal
thermal normal/warning/critical
reduced-motion false/true
data-saver false/true
```

Each combination should produce a valid policy packet, bounded resource plan and valid frame packet.

## CI

The hardening workflow should run:

- node syntax;
- core render acceptance;
- adversarial capacity tests;
- feature negotiation matrix;
- repeated deterministic output;
- `git diff --check`;
- ownership scan;
- meaningful-addition gate.

A CI run that is still queued or in progress is not a passed run.

## Code review rules

Reviewers should reject:

- direct Three.js imports from pure policy modules;
- `Math.random()` in deterministic policy;
- `Date.now()` in frame decision logic;
- unbounded arrays/maps;
- direct scene mutation in planners;
- backend-specific features leaking into WebGL2 descriptors;
- material migration that removes the old fallback before validation;
- render recovery that mutates gameplay state.

## Exit criteria

The migration is complete for a subsystem when:

- WebGPU path is initialized successfully on supported targets;
- WebGL2 fallback remains available;
- render packet is deterministic;
- dynamic resolution is stable;
- texture/instance budgets are bounded;
- temporal history invalidation is explicit;
- device-loss recovery is observable;
- material migration status is tracked;
- release CI passes the intended contract suite.
