# Render Backend Capability Contract

The client must remain functional on the existing WebGL renderer while opportunistically using WebGPU where the runtime exposes it. WebGPU is an accelerator, not a compatibility gate. Capability discovery is pure and deterministic; renderer construction remains owned by the scene bootstrap.

## Backend order

`webgpu -> webgl2 -> webgl -> none`.

A secure context is required for the complete WebGPU API. Worker rendering is enabled only when both Worker and OffscreenCanvas are available. SharedArrayBuffer is advisory and requires cross-origin isolation; it is never a hard dependency.

## Quality policy

Hardware score is normalized to a stable 0..1 value from CPU concurrency, reported memory, pointer class and backend capability. The score selects a named quality tier and never changes world simulation state.

## Safety

A backend capability failure must degrade to the next backend or to a render-less mode. No capability probe may throw out of application boot. Future WebGPU integration must consume this contract instead of bypassing it with direct `navigator.gpu` checks scattered through gameplay modules.
