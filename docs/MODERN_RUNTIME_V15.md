# AAPW Modern Runtime v15

## Why this layer exists

AAPW already has a substantial TypeScript-first migration, several runtime generations, compatibility shims and a live modern game bootstrap. The next useful step is consolidation, not another independent engine.

v15 provides a typed governance layer around the live runtime. It measures the running system, applies bounded policies and exposes deterministic contracts for resources, input, streaming, network and persistence.

## Technology direction

The application uses native ES modules and a strict TypeScript runtime surface. v15 deliberately avoids adding a second rendering engine. WebGPU is treated as the preferred capability while WebGL2 remains the compatibility backend.

The renderer boundary is capability-driven:

- WebGPU adapter discovery is attempted when available.
- Initialization failure does not prevent game boot.
- WebGL2 remains a deterministic fallback.
- The isolated renderer controller can be tested without making the live page instantiate a second renderer.

## Runtime architecture

The v15 architecture is:

1. capability probe,
2. quality feedback controller,
3. semantic input normalization,
4. fixed-step frame scheduler,
5. bounded asset pipeline,
6. predictive world partition,
7. secure network envelope,
8. checksummed save store,
9. bounded telemetry,
10. runtime health projection.

Each subsystem returns data or decisions. Browser I/O is kept at the edges.

## Type safety

Identifiers such as frame, tick, sequence, revision, asset and chunk ids use branded types. This prevents accidental mixing of semantically different integers and strings in APIs.

The v15 public index exports only strict TypeScript modules.

## Quality controller

Quality is a feedback system instead of a one-time preset. The director tracks exponential moving averages of frame, CPU and GPU latency and combines them with draw-call, triangle, visibility, memory and thermal pressure.

Quality transitions use hysteresis:

- three high-pressure observations can move down one tier,
- a larger sustained headroom window is required before moving up,
- dynamic render scale may adapt while the selected tier stays unchanged.

The result is stable behavior under noisy frame measurements.

## Fixed-step simulation

The scheduler clamps frame delta and executes a fixed simulation step. It limits catch-up work and records dropped simulation debt after the limit is reached.

That protects the browser event loop from unbounded recovery work while preserving enough telemetry to diagnose the condition.

## Input architecture

All devices converge into a semantic input stream:

- keyboard,
- pointer,
- touch,
- gamepad,
- replay/system injection.

Move and look vectors are normalized. Pressed, held and released transitions are explicit. Action ordering is deterministic.

Gameplay can therefore consume one input shape rather than branching on the physical source.

## Asset reliability

Asset loading is bounded by:

- record count,
- memory bytes,
- concurrency,
- retries,
- timeout,
- MIME expectation,
- optional SHA-256 digest,
- reference count,
- stale and eviction state.

The pipeline is deliberately transport-agnostic. It can consume the existing asset loader or a future streaming worker.

## Predictive world streaming

The world partition scores cells against interest sources using position, velocity lookahead, view distance and priority. The planner can distinguish critical content from background content.

This is a decision layer only. The existing terrain and chunk managers remain responsible for actual mesh creation.

## Network boundary

The v15 network envelope has protocol, kind, sequence, acknowledgement, simulation tick, payload and checksum.

Incoming data is structurally validated before it becomes a gameplay value. Packet rate and byte rate are bounded with token buckets.

The module does not open sockets itself, making it safe to unit test and reuse with WebSocket, WebTransport or a future transport.

## Persistence boundary

Save files use a dedicated magic marker and schema version. The payload is checksummed and revalidated on load.

Storage is abstracted through a small interface with memory and localStorage implementations.

Corrupt records are not allowed to become healthy save metadata.

## Telemetry

The telemetry buffer stores a bounded window. It provides:

- latest sample,
- rolling averages,
- p95 frame latency,
- deterministic digest,
- budget-based health.

Health is a projection of observable runtime behavior rather than a subjective rating.

## Live integration rule

The live game must never create two renderers simply because governance was upgraded.

The platform bridge consumes the already-created modern runtime services and feeds measurements into v15. Renderer takeover is isolated behind an explicit testable controller.

This makes migration reversible and reduces ownership ambiguity.

## Migration sequence

The recommended order for the next application slices is:

1. wire v15 observations into the live frame loop,
2. surface v15 quality decisions to the existing render policy,
3. connect world planning to the existing chunk loader,
4. move persistence to the v15 storage boundary,
5. connect semantic input to the player authority,
6. retire duplicate policy code only after parity tests pass.

## Verification requirements

A release should pass:

- v15 structural guard,
- repository typecheck,
- full Vitest suite,
- v15 unit and integration tests,
- deterministic checksum regression,
- renderer fallback regression,
- save tamper regression,
- asset digest regression,
- streaming budget regression.

No compatibility shim should be deleted solely because a typed replacement exists. Its deletion should follow verified ownership transfer.
