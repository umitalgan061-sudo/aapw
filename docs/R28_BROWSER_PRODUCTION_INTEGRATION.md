# R28 Browser Production Integration

R28 connects the modern TypeScript runtime to real browser responsibilities while keeping simulation code independent from the renderer and DOM.

## Production ownership

BrowserRuntimeHost owns animation-frame scheduling, visibility suspension, error forwarding and input sampling. R27Runtime remains the deterministic state owner.

RuntimeSceneBridge and TypedRendererBridge consume renderer-neutral packets. Three.js therefore remains a presentation implementation detail rather than a gameplay dependency.

## Runtime services

RuntimeSession provides transport-independent connection state. WebSocketRuntimeTransport adapts the session contract to browser WebSocket APIs with bounded messages.

RuntimeAssetCoordinator adds requested-asset orchestration above AssetGraphRuntime, while FetchAssetLoader owns HTTP validation and cancellation.

BrowserLocalSaveStorage and BrowserStorageCodec provide bounded client persistence without requiring Node polyfills.

## Recovery, resources and quality

RuntimeLifecycleController prevents invalid lifecycle transitions. RuntimeRecoveryController applies bounded prioritized recovery actions.

RuntimeResourceRegistry centralizes disposal accounting. RuntimeTelemetry, RuntimeVirtualConsole and RuntimeDiagnosticsBridge make operational state inspectable without requiring external telemetry infrastructure.

RuntimeCameraController and RuntimeResizeManager keep camera and viewport policy deterministic and renderer-neutral.

## JavaScript migration

LegacySurfaceAudit and the R28 verification script provide a mechanical boundary around remaining JavaScript compatibility shims. New R28 implementation is TypeScript-only.

## Verification

Run:
npm run verify:modern:r28
npm run test:modern:r28
npm run check:modern:r28

The local container cannot reach GitHub directly in this execution environment, so CI remains the authoritative full install/build check.
