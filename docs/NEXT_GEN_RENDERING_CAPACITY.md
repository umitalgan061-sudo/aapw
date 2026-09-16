# Next-Generation Rendering Capacity Model

## Capacity is a first-class contract

Modern rendering quality is not only about how many effects are available. A browser game has hard limits in frame
budget, GPU memory, shader compilation, draw submission, texture bandwidth and device thermal headroom.
AAPW therefore treats these as bounded resource contracts rather than optional implementation details.

## Frame budget

Nominal target is 16.67ms for a 60Hz presentation budget. This is not a guarantee; it is the control target used by
policy modules.

The render stack separates:

```text
simulation time
presentation frame time
GPU time
CPU render time
```

Simulation remains authoritative and does not speed up or slow down when render quality changes.

## GPU pressure

`gpuPressureModel.js` combines GPU/CPU/frame/memory/thermal signals into a normalized pressure score.
The score is intentionally bounded and explainable.

A critical state should cause:

- render-scale reduction;
- optional post-process rejection;
- lower instance budget;
- lower texture residency;
- possible backend fallback.

## Degradation hierarchy

`renderDegradationPolicy.js` converts the pressure score into one of:

```text
none
light
moderate
aggressive
safe
```

Each state changes only presentation workload. No actor, physics or world state is mutated.

## Texture budget

Texture residency budget is logical. Physical GPU allocation remains asset/renderer-owned.

A 256MB logical budget may still produce a different physical footprint depending on backend format,
platform alignment and actual resource creation. Therefore residency planner results should be combined with actual
GPU memory telemetry where available.

## Instance budget

Instancing reduces submission overhead but may increase buffer memory. The instance planner therefore bounds both
batch count and instances per batch.

Tier ceilings:

```text
minimal  256
balanced 768
high     1536
ultra    2048
```

These are policy defaults, not device guarantees.

## Pass budget

Post-processing effects must not assume unlimited GPU time. Each effect gets an estimated cost and priority.
Optional passes can be deferred when the budget is exceeded.

Mandatory scene/depth passes remain required.

## Shader compile budget

Variant registry estimates compile workload and ranks frequently used variants first. Actual compilation remains with
the renderer.

A practical rollout should prewarm only high-frequency variants and allow the remainder to compile lazily.

## Frame graph memory

Logical transient resource aliasing can reduce peak memory by reusing compatible storage between non-overlapping
passes. The planner exposes lifetime and compatibility information; physical aliasing is implemented by the render
backend.

## Dynamic resolution interaction

When frame pressure increases:

```text
pressure
  ↓
dynamic scale
  ↓
frame graph dimensions
  ↓
texture demand
  ↓
post-process cost
```

Scale changes can also invalidate temporal history. The temporal history controller must observe large scale jumps.

## Thermal interaction

Thermal pressure should bias quality downward gradually before the device enters a severe state. Emergency mode should
prioritize stable presentation over high visual fidelity.

Thermal state must not become a gameplay difficulty variable.

## Mobile interaction

A mobile profile may combine:

- lower resolution;
- lower texture budget;
- fewer instance updates;
- fewer optional passes;
- lower shader prewarm count.

This is preferable to maintaining desktop-level quality until the browser starts killing GPU resources.

## WebGPU fallback interaction

WebGPU offers the modern rendering path, but a runtime device loss or unsupported adapter can require WebGL2 fallback.
The policy must therefore preserve a complete WebGL2 descriptor path even when WebGPU is the preferred target.

## Capacity metrics

Recommended release metrics:

```text
frameMs p50/p95/p99
gpuMs p50/p95/p99
cpuMs p50/p95/p99
renderScale p5/p50
texture utilization
texture deferred count
visible candidate count
deferred candidate count
instance batch count
shader variant count
post-process rejected count
device recovery attempts
```

P95/P99 are especially useful for detecting occasional catastrophic spikes hidden by a good average.

## Stress acceptance

The repository stress suite intentionally feeds:

- thousands of renderables;
- thousands of texture records;
- thousands of instance records;
- large shader request bursts;
- pathological `NaN`/`Infinity` numeric values;
- repeated thermal spikes;
- device-loss/recovery transitions.

Expected outcome is bounded output, not perfect visual quality.

## Browser testing caveat

Headless Node tests prove the policy and capacity contracts. They do not prove actual GPU driver behavior,
shader compile time, browser memory allocation or screen-level visual quality.

A release should therefore combine:

```text
headless contract tests
+
browser smoke
+
real GPU/browser validation
```

## Tuning procedure

When a profile underperforms:

1. inspect pressure state;
2. inspect dynamic scale trace;
3. inspect pass rejection;
4. inspect texture utilization;
5. inspect instance deferral;
6. inspect shader variant count;
7. inspect temporal history resets;
8. inspect recovery state.

Do not immediately raise/lower a random quality constant. Identify the resource that is actually saturating.

## Release principle

A “high” or “ultra” tier is a request, not a promise. The runtime must remain able to reduce quality to protect the
session from frame collapse, memory pressure or device loss.
