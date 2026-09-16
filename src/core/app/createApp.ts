import { detectCapabilities, preferredInputMode, preferredRenderBackend, type CapabilitySnapshot } from '../platform/capabilities.ts';
import { ActionRouter, buildBrowserInputRouter, type InputFrame } from '../input/actionRouter.ts';
import { createWorldStore, seedKingdom, worldSummary, type WorldAction } from '../world/worldStore.ts';
import { RuntimeKernel, type RuntimeSnapshot } from '../runtime/runtimeKernel.ts';
import { RuntimeTelemetry, PerfTimer } from '../telemetry/runtimeTelemetry.ts';
import { AssetRegistry, createFetchJsonLoader } from '../assets/assetRegistry.ts';
import { RenderOrchestrator, createFramePacket } from '../render/renderContract.ts';
import { browserStorage, VersionedStorage } from '../storage/versionedStorage.ts';
import { freeze, type WorldState } from '../domain/contracts.ts';
import { installBridge, notifyLegacy, readLegacyKingdoms, toKingdomState } from '../legacy/legacyBridge.ts';

export interface AapwAppOptions {
  readonly worldId?: string;
  readonly attachInputListeners?: boolean;
  readonly autoStart?: boolean;
  readonly telemetryLevel?: ConstructorParameters<typeof RuntimeTelemetry>[0]['level'];
}

export interface AapwApp {
  readonly capabilities: CapabilitySnapshot;
  readonly store: ReturnType<typeof createWorldStore>;
  readonly kernel: RuntimeKernel;
  readonly telemetry: RuntimeTelemetry;
  readonly assets: AssetRegistry;
  readonly renderer: RenderOrchestrator;
  readonly input: ActionRouter;
  start(): void;
  tick(deltaMs: number): RuntimeSnapshot;
  dispatch(action: WorldAction): void;
  getWorld(): WorldState;
  dispose(): void;
}

const STORAGE_KEY = 'aapw.modern-world.v2';

export const createAapwApp = (options: AapwAppOptions = {}): AapwApp => {
  const capabilities = detectCapabilities();
  const store = createWorldStore(options.worldId ?? 'westeros');
  const input = new ActionRouter();
  const telemetry = new RuntimeTelemetry({ level: options.telemetryLevel ?? 'normal', capacity: 8192 });
  const assets = new AssetRegistry();
  const renderer = new RenderOrchestrator(preferredRenderBackend(capabilities));
  const timer = new PerfTimer(telemetry);
  const persistence = new VersionedStorage(browserStorage(), STORAGE_KEY, 2, [
    { from: 1, to: 2, migrate: (payload) => payload },
  ]);

  for (const legacy of readLegacyKingdoms()) {
    store.dispatch({ type: 'kingdom/upsert', kingdom: toKingdomState(legacy, 1) });
  }

  const inputCleanup = options.attachInputListeners === false ? () => undefined : buildBrowserInputRouter(input);
  const kernel = new RuntimeKernel({
    getWorld: () => store.getState(),
    getInput: () => input.snapshot(),
    samplePressure: () => {
      const frameTimeMs = kernel.metrics().frameTimeMs || 16.67;
      const memory = typeof performance !== 'undefined' && 'memory' in performance
        ? Math.min(1, ((performance as Performance & { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } }).memory?.usedJSHeapSize ?? 0) / Math.max(1, (performance as Performance & { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } }).memory?.jsHeapSizeLimit ?? 1))
        : 0;
      return { cpu: Math.min(1, frameTimeMs / 33), gpu: Math.min(1, frameTimeMs / 28), memory, thermal: 0, network: 0, frameTimeMs, timestamp: performance.now() };
    },
    publishQuality: (policy) => {
      renderer.setBackend(preferredRenderBackend(capabilities));
      telemetry.gauge('quality.level', policy.level);
      telemetry.gauge('quality.resolution', policy.resolutionScale);
    },
  });

  kernel.register({
    name: 'world-store-bridge',
    priority: -100,
    update: () => {
      const world = store.getState();
      telemetry.gauge('world.kingdoms', world.kingdoms.size);
      telemetry.gauge('world.revision', Number(world.revision));
    },
  });

  kernel.register({
    name: 'input-normalization',
    priority: -50,
    update: () => {
      const frame: InputFrame = input.nextFrame();
      telemetry.gauge('input.sequence', frame.sequence);
      telemetry.count(`input.device.${frame.activeDevice}`);
    },
  });

  kernel.register({
    name: 'render-packet',
    priority: 50,
    update: (context) => {
      timer.start('render.packet');
      const world = store.getState();
      const intent = {
        camera: { position: { x: 0, y: 40, z: 60 }, target: { x: 0, y: 0, z: 0 }, fov: 60 },
        quality: {
          resolutionScale: kernel.quality().policy.resolutionScale,
          shadows: kernel.quality().policy.shadowMapScale > 0.25,
          postFx: kernel.quality().policy.postFx,
        },
      } as Parameters<typeof createFramePacket>[3];
      const packet = createFramePacket(context.frame, Number(world.revision), context.dt, intent, [...world.kingdoms.keys()].map(String));
      renderer.render(packet);
      timer.end('render.packet');
    },
  });

  const api: AapwApp = {
    capabilities,
    store,
    kernel,
    telemetry,
    assets,
    renderer,
    input,
    start() {
      kernel.start();
      notifyLegacy(`Modern TypeScript çekirdeği aktif · ${preferredRenderBackend(capabilities)} / ${preferredInputMode(capabilities)}`);
    },
    tick(deltaMs) { return kernel.tick(deltaMs); },
    dispatch(action) { store.dispatch(action); },
    getWorld() { return store.getState(); },
    dispose() {
      inputCleanup();
      kernel.dispose();
      input.dispose();
      assets.dispose();
      telemetry.count('runtime.disposed');
    },
  };

  installBridge({
    version: '2.0.0-ts',
    getWorld: api.getWorld,
    syncLegacyKingdoms: () => {
      let count = 0;
      for (const legacy of readLegacyKingdoms()) {
        store.dispatch({ type: 'kingdom/upsert', kingdom: toKingdomState(legacy, Number(store.getRevision()) + 1) });
        count += 1;
      }
      return count;
    },
    selectKingdom: (id) => api.dispatch({ type: 'world/selectKingdom', kingdomId: id as never }),
    save: () => {
      const result = persistence.save(store.getState());
      if (result.ok) telemetry.count('world.saved');
      return result.ok;
    },
    load: () => {
      const result = persistence.load();
      if (!result.ok) return false;
      telemetry.count('world.loaded');
      return true;
    },
  });

  if (options.autoStart ?? false) api.start();
  telemetry.count('runtime.created');
  telemetry.gauge('runtime.kingdoms', worldSummary(store.getState()).kingdoms);
  return api;
};

export const exposeDevelopmentDiagnostics = (app: AapwApp): Readonly<Record<string, unknown>> => freeze({
  renderer: app.renderer.backend,
  capabilities: app.capabilities.supported,
  world: worldSummary(app.getWorld()),
  telemetry: app.telemetry.snapshot(),
});
