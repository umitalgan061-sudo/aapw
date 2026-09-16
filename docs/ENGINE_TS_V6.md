# AAPW Engine TS v6

This document describes the production-oriented TypeScript runtime surface introduced by the v6 platform work.

## Goals

The v6 layer moves browser-facing engine ownership toward typed, deterministic modules. The existing game can continue to use the historical JavaScript presentation layer while new stateful services are isolated behind explicit TypeScript contracts.

The architecture is intentionally modular. World interest, gameplay, AI, rendering, input, persistence, networking, replay, security, telemetry, recovery, editor state and release gates each own a bounded domain.

## Runtime composition

`EngineRuntime` is the application composition root. It owns the existing `RuntimeKernel` and connects it to the new world, asset, network, gameplay, input, render, AI and persistence services.

`RuntimePlatform` adds browser lifecycle events and telemetry collection. `BrowserEngineFacade` is the narrow browser-facing API. `RuntimeControlPlane` is the operator surface for pause, resume, recovery, security validation, quality forcing, release checks and telemetry handling.

`IntegrationRuntime` composes the engine with ECS, events, command scheduling, snapshots, world-state replication, performance tracking and release reporting. It exists so future application code can use a single integration object instead of importing every subsystem independently.

## Determinism

The runtime prefers explicit ordering over incidental object iteration order. Entity collections, command queues, behavior actors, render candidates, manifest modules and world state queries use stable ordering rules.

Fixed-step simulation and replay are based on explicit tick counters. Catch-up loops are bounded. Excess accumulated time is recorded as dropped simulation work instead of allowing a long frame to monopolize the browser event loop.

## World streaming

`WorldRuntime` indexes entities into spatial cells. Interest queries touch nearby cells and classify active entities into near, mid, far and sleeping tiers. Each tier has an independent capacity so a large world cannot consume the entire frame budget.

`StreamingRuntime` separately tracks cold, queued, loading, resident and unloaded resources. Requests are priority ordered and resident memory is bounded with deterministic least-recently-used style eviction.

## Assets and security

`AssetRuntime` validates URL shape, declared size, content kind and an integrity digest before marking an asset resident. Requests are bounded by queue and concurrency limits.

`SecurityRuntime` enforces payload byte, string, array, object-key and nesting limits. URL checks reject embedded credentials and unsupported protocols. Capability detection is kept separate from policy evaluation so tests can inject normal engine state without a browser.

## Gameplay and AI

`GameplayRuntime` owns actor movement, stamina, jumps, attacks, interaction state, inventory operations and health transitions. It reports typed gameplay events rather than mutating renderer objects.

`NavigationRuntime` provides bounded deterministic A* queries. `AiRuntime` turns visible targets and configured goals into explicit state decisions. `BehaviorRuntime` supports data-driven sequence, selector, condition, action, cooldown and repeat nodes with per-actor state isolation.

## Rendering and audio

`RenderRuntime` constructs bounded render packets and adapts quality using sustained pressure rather than reacting to one isolated frame. CPU, GPU, draw-call and triangle pressure can all trigger quality changes.

`AudioRuntime` models emitters, voices, buses, distance attenuation, occlusion and virtualization. The state model remains renderer-independent and can be connected to the project's existing spatial audio presentation layer.

## Persistence and replay

`PersistenceRuntime` writes versioned, checksummed envelopes and supports migration functions. `SnapshotRuntime` retains bounded snapshots, computes structural patches and verifies state checksums. `ReplayRuntime` stores deterministic input frames and periodic checkpoints for debugging and regression reproduction.

`RestoreRuntime` validates save or snapshot state before exposing a successful restore result to callers.

## Network state

`NetworkRuntime` models peer state, reliable and unreliable channels, backpressure, retries, latency, packet loss and acknowledgements. `WorldStateRuntime` stores monotonic entity revisions and validates state deltas before applying them.

The transport is intentionally abstract. The same state machine can be connected to WebSocket, WebTransport, a worker bridge or deterministic loopback tests without changing gameplay ownership.

## Editor and migration

`EditorRuntime` provides headless entity editing with transactional undo/redo. This allows tooling and automated world processing to use the same state model as runtime tests.

`MigrationRuntime` keeps legacy and modern representations explicit. A surface can move from legacy to shadow, verified and promoted only after parity checks. A failed parity check puts the surface into a blocked state rather than silently replacing the legacy representation.

## Diagnostics and release gates

`TelemetryRuntime` keeps bounded metrics and spans and computes p95 frame timing, error rate and a composite health signal. `ReleaseRuntime` evaluates mandatory build/test/determinism gates and operational thresholds. `RecoveryRuntime` coordinates quiesce/reset/restore/resume operations across registered domains.

The release layer deliberately distinguishes blocking gates from warnings. Warning-level memory or legacy-surface drift can be tracked without turning those signals into an accidental hard failure.

## Browser lifecycle

`RuntimePlatform.attachBrowserLifecycle()` listens to visibility, online/offline and pagehide events. The callbacks only change lifecycle state and do not directly mutate application world data.

Long-lived event listeners should always be detached with the callback returned by `attachBrowserLifecycle()`. `BrowserEngineFacade.dispose()` performs this cleanup automatically.

## Migration rules

The TypeScript layer should grow by ownership, not by translation alone. A JavaScript module should only be replaced after its state ownership and side effects are represented by a typed service or adapter.

When a legacy subsystem remains active, the migration registry should record the surface explicitly. New callers should use the typed facade wherever a v6 surface exists.

A full repository-wide JavaScript removal is therefore a controlled migration process, not a mechanical file-extension rename. The v6 work provides the interfaces and runtime boundaries required to continue that migration without creating a second disconnected engine.

## Verification

The v6 tests cover world interest management, ECS queries, gameplay state transitions, network acknowledgements, persistence, replay, input routing, render budgeting, security, navigation, scene editing, quest progression, audio mixing, telemetry, release gates, recovery and the public browser facade.

CI should run the project's existing TypeScript typecheck and test commands plus any repository-specific deterministic guards. A local unit-test success is not treated as evidence that unrelated repository workflows have succeeded.
