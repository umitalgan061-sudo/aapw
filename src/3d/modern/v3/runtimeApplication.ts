import { createModernRuntime, tickModernRuntime, type RuntimeServices } from '../runtime';
import type { CameraState, RuntimeSnapshot } from '../types';
import { createBrowserFrameSource, type BrowserFrameSource } from './browserFrameSource.js';
import { createTypeSafeLegacyGameAdapter, type TypeSafeLegacyGameAdapter } from './legacyGameAdapter.js';
import {
  DEFAULT_V3_BUDGET,
  type V3Action,
  type V3CameraState,
  type V3RenderPacket,
  type V3RuntimeConfig,
  type V3RuntimeDependencies,
  type V3RuntimeSnapshot,
  type V3Viewport,
  normalizeV3Action,
} from './runtimeContracts.js';
import { createV3RuntimeKernel, type V3RuntimeKernel } from './runtimeKernel.js';

export interface V3ApplicationOptions {
  readonly canvas: HTMLCanvasElement;
  readonly seed?: number;
  readonly worldId?: string;
  readonly quality?: V3RuntimeConfig['quality'];
  readonly backend?: V3RuntimeConfig['backend'];
  readonly host?: V3RuntimeConfig['host'];
  readonly enableLegacyAdapter?: boolean;
  readonly enableModernRuntimeMetrics?: boolean;
  readonly maxDpr?: number;
}

export interface V3Application {
  readonly kernel: V3RuntimeKernel;
  readonly legacy: TypeSafeLegacyGameAdapter | undefined;
  readonly browser: BrowserFrameSource;
  readonly modernMetrics: RuntimeServices | undefined;
  start(): Promise<boolean>;
  pause(reason?: string): void;
  resume(reason?: string): void;
  stop(reason?: string): Promise<void>;
  frame(nowMs?: number): V3RuntimeSnapshot;
  dispatch(action: Omit<V3Action, 'timestamp' | 'frame'>): boolean;
  renderPacket(): V3RenderPacket;
  diagnostics(): Readonly<Record<string, unknown>>;
  dispose(): Promise<void>;
}

const makeWorldId = (value: string | undefined): string => {
  const normalized = (value ?? 'westeros').trim().replace(/[^a-zA-Z0-9:_-]/g, '-').slice(0, 80);
  return normalized || 'westeros';
};

const cameraFromLegacy = (): V3CameraState => {
  const candidate = globalThis as unknown as {
    __AapwGame3DState?: {
      camera?: { position?: { x?: number; y?: number; z?: number }; fov?: number; near?: number; far?: number };
      controls?: { target?: { x?: number; y?: number; z?: number } };
    };
  };
  const state = candidate.__AapwGame3DState;
  const position = state?.camera?.position;
  const target = state?.controls?.target;
  return Object.freeze({
    position: Object.freeze({ x: number(position?.x), y: number(position?.y, 80), z: number(position?.z, 120) }),
    target: Object.freeze({ x: number(target?.x), y: number(target?.y), z: number(target?.z) }),
    fov: number(state?.camera?.fov, 60), near: number(state?.camera?.near, 0.1), far: number(state?.camera?.far, 30_000), dpr: 1,
  });
};

function number(value: number | undefined, fallback = 0): number { return typeof value === 'number' && Number.isFinite(value) ? value : fallback; }

export async function createV3Application(options: V3ApplicationOptions): Promise<V3Application> {
  const browser = createBrowserFrameSource(options.canvas, { maxDpr: options.maxDpr, cameraProvider: cameraFromLegacy });
  const legacy = options.enableLegacyAdapter === false ? undefined : createTypeSafeLegacyGameAdapter({
    onBridgeEvent: event => { applicationKernel?.emit('runtime/legacy-bridge', event); },
  });
  const config: V3RuntimeConfig = Object.freeze({
    worldId: makeWorldId(options.worldId) as V3RuntimeConfig['worldId'],
    seed: Math.trunc(options.seed ?? 7202026), host: options.host ?? 'browser', mode: 'interactive',
    backend: options.backend ?? 'webgl2', quality: options.quality ?? 'high', fixedStepMs: 1000 / 60,
    maxDeltaMs: 250, maxCatchUpSteps: 6, budget: DEFAULT_V3_BUDGET,
    enableLegacyAdapter: options.enableLegacyAdapter !== false, enablePersistence: true, enableWorkers: true,
  });
  let applicationKernel: V3RuntimeKernel | undefined;
  const deps: V3RuntimeDependencies = Object.freeze({ now: () => browser.now(), frameSource: browser, legacy });
  applicationKernel = createV3RuntimeKernel({ config, dependencies: deps });
  let modernMetrics: RuntimeServices | undefined;
  if (options.enableModernRuntimeMetrics !== false) modernMetrics = await createModernRuntime({ canvas: options.canvas, initialQuality: options.quality });

  const app: V3Application = {
    kernel: applicationKernel,
    legacy,
    browser,
    modernMetrics,
    start: () => applicationKernel.start(),
    pause: reason => applicationKernel.pause(reason),
    resume: reason => applicationKernel.resume(reason),
    stop: reason => applicationKernel.stop(reason),
    frame: now => {
      const snapshot = applicationKernel.tick(now ?? browser.now());
      if (modernMetrics) {
        const camera: CameraState = Object.freeze({ position: snapshot.camera.position, target: snapshot.camera.target, fov: snapshot.camera.fov, near: snapshot.camera.near, far: snapshot.camera.far, viewportWidth: snapshot.viewport.width, viewportHeight: snapshot.viewport.height, dpr: snapshot.viewport.dpr });
        tickModernRuntime(modernMetrics, { frame: snapshot.frame as never, frameMs: snapshot.health.frameMs, cpuMs: snapshot.health.frameMs, drawCalls: applicationKernel.renderPacket().visibleIds.length, triangles: 0, visibleObjects: applicationKernel.renderPacket().visibleIds.length, textureBytes: 0, camera });
      }
      return snapshot;
    },
    dispatch: action => {
      const now = browser.now();
      const frame = applicationKernel.snapshot().frame;
      return applicationKernel.dispatch(normalizeV3Action(action, now, frame));
    },
    renderPacket: () => applicationKernel.renderPacket(),
    diagnostics: () => Object.freeze({ schema: 'aapw.runtime.v3', config, snapshot: applicationKernel.snapshot(), health: applicationKernel.health(), legacyLoaded: legacy?.isLoaded() ?? false, modernMetricsReady: Boolean(modernMetrics) }),
    dispose: () => applicationKernel.dispose(),
  };
  return Object.freeze(app);
}

export const bootV3Application = createV3Application;
