import { gameEvents } from '../eventBus.js';
import { EVENTS } from '../config.js';
import { createProductionRuntime, type ProductionRuntime } from './productionRuntime';
import type { RuntimeSceneAdapter } from './runtimeSession';
import type { CameraFrameState, PlayerFrameState, WorldFrameState } from './runtimeContracts';
import { ensureRendererRegistry, getRegisteredRenderer, clearRegisteredRenderer, rendererRegistryDiagnostics } from './rendererRegistry';
import { RendererPresentationBridge } from './rendererPresentationBridge';

export interface Game3DEntryOptions {
  readonly canvas?: HTMLCanvasElement | null;
  readonly enableProductionRuntime?: boolean;
  readonly telemetry?: boolean;
  readonly networking?: boolean;
  readonly persistence?: boolean;
  readonly seed?: number;
  readonly onReady?: (runtime: ProductionRuntime | null) => void;
}

interface LegacyGameStateLike {
  player?: { object3D?: { position: { x: number; y: number; z: number }; rotation?: { y: number } } };
  camera?: { position: { x: number; y: number; z: number }; fov?: number; near?: number; far?: number };
  controls?: { target?: { x: number; y: number; z: number } };
  renderer?: { info?: { render?: { calls?: number; triangles?: number }; memory?: { textures?: number; geometries?: number } }; getPixelRatio?: () => number };
  settlementDiscovery?: { getDiscovered?: () => readonly string[] };
  settlementSeats?: readonly { id?: string }[];
  chunkManager?: { getLoadedChunkKeys?: () => readonly string[] };
  weather?: { kind?: string };
}

let activeRuntime: ProductionRuntime | null = null;
let bootPromise: Promise<ProductionRuntime | null> | null = null;
let unsubscribers: Array<() => void> = [];
let presentationBridge: RendererPresentationBridge | null = null;

function vec3(position: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
  return { x: Number.isFinite(position.x) ? position.x : 0, y: Number.isFinite(position.y) ? position.y : 0, z: Number.isFinite(position.z) ? position.z : 0 };
}

function getState(): LegacyGameStateLike | null {
  const candidate = globalThis as unknown as { __AapwGame3DState?: LegacyGameStateLike };
  return candidate.__AapwGame3DState ?? null;
}

async function initLegacyGame3D(): Promise<void> {
  // Explicit lazy boundary: the legacy renderer remains authoritative for world construction,
  // while TypeScript-first entry/runtime code avoids statically importing the JS implementation.
  const legacy = await import('../game3d.js');
  if (typeof legacy.initGame3D !== 'function') throw new Error('AAPW_LEGACY_GAME_INIT_MISSING');
  await legacy.initGame3D();
}

function sceneAdapter(): RuntimeSceneAdapter {
  return {
    capturePlayer(): PlayerFrameState {
      const state = getState();
      const position = state?.player?.object3D?.position ?? { x: 0, y: 0, z: 0 };
      return Object.freeze({ position: vec3(position), velocity: { x: 0, y: 0, z: 0 }, grounded: true, health: 100, maxHealth: 100 });
    },
    captureCamera(): CameraFrameState {
      const state = getState();
      const camera = state?.camera;
      const target = state?.controls?.target;
      return Object.freeze({
        position: vec3(camera?.position ?? { x: 0, y: 3, z: 6 }),
        target: vec3(target ?? { x: 0, y: 1, z: 0 }),
        yaw: 0,
        pitch: 0.25,
        zoom: 6,
      });
    },
    captureWorld(): WorldFrameState {
      const state = getState();
      const loadedCells = state?.chunkManager?.getLoadedChunkKeys?.() ?? [];
      const discovered = state?.settlementDiscovery?.getDiscovered?.() ?? [];
      return Object.freeze({
        timeOfDaySeconds: 0,
        weather: state?.weather?.kind ?? 'clear',
        loadedCells: Object.freeze([...loadedCells]),
        discoveredSettlements: Object.freeze([...discovered]),
      });
    },
    getViewport(): { readonly width: number; readonly height: number; readonly dpr: number } {
      const canvas = document.getElementById('game3d-canvas') as HTMLCanvasElement | null;
      const rect = canvas?.getBoundingClientRect();
      return { width: Math.max(1, Math.trunc(rect?.width ?? innerWidth)), height: Math.max(1, Math.trunc(rect?.height ?? innerHeight)), dpr: Math.max(1, Math.min(3, devicePixelRatio || 1)) };
    },
    getRenderMetrics() {
      const renderer = getRegisteredRenderer() ?? getState()?.renderer;
      const render = renderer?.info?.render;
      const memory = renderer?.info?.memory;
      return {
        drawCalls: Math.max(0, Math.trunc(render?.calls ?? 0)),
        triangles: Math.max(0, Math.trunc(render?.triangles ?? 0)),
        visibleObjects: Math.max(0, Math.trunc(render?.calls ?? 0)),
        textureBytes: Math.max(0, Math.trunc((memory?.textures ?? 0) * 1024 * 1024)),
      };
    },
  };
}

function publishRuntime(runtime: ProductionRuntime | null): void {
  const holder = globalThis as typeof globalThis & { __AapwProductionRuntime?: ProductionRuntime | null };
  holder.__AapwProductionRuntime = runtime;
  activeRuntime = runtime;
}

function runtimePressure(runtime: ProductionRuntime): number {
  const summary = runtime.performance.summary();
  return Number.isFinite(summary.pressure) ? summary.pressure : 0;
}

export function getProductionRuntime(): ProductionRuntime | null { return activeRuntime; }

export function getProductionRuntimeDiagnostics(): Readonly<Record<string, unknown>> | null {
  const runtime = activeRuntime;
  if (!runtime) return null;
  return Object.freeze({
    ...runtime.diagnostics(),
    rendererPresentation: presentationBridge?.diagnostics() ?? null,
    rendererRegistry: rendererRegistryDiagnostics(),
  });
}

export function disposeGame3DEntry(): void {
  for (const unsubscribe of unsubscribers.splice(0)) unsubscribe();
  presentationBridge?.dispose();
  presentationBridge = null;
  clearRegisteredRenderer();
  if (activeRuntime) void activeRuntime.stop();
  publishRuntime(null);
  bootPromise = null;
}

export async function bootGame3D(options: Game3DEntryOptions = {}): Promise<ProductionRuntime | null> {
  if (bootPromise) return bootPromise;
  bootPromise = (async () => {
    ensureRendererRegistry();
    await initLegacyGame3D();
    if (options.enableProductionRuntime === false) {
      options.onReady?.(null);
      return null;
    }
    const runtime = createProductionRuntime({ seed: options.seed, telemetry: options.telemetry ?? true, networking: options.networking ?? false, persistence: options.persistence ?? true }, sceneAdapter());
    const started = await runtime.start();
    if (!started) {
      publishRuntime(null);
      options.onReady?.(null);
      return null;
    }
    presentationBridge = new RendererPresentationBridge({
      rendererProvider: () => getRegisteredRenderer(),
      devicePixelRatio: () => typeof window !== 'undefined' ? window.devicePixelRatio : 1,
      maxPixelRatio: 2.5,
      minPixelRatio: 0.6,
      minFramesBetweenChanges: 18,
    });
    publishRuntime(runtime);
    const frame = () => {
      if (activeRuntime !== runtime) return;
      void runtime.frame().then((snapshot) => {
        presentationBridge?.apply({ quality: snapshot.quality, pressure: runtimePressure(runtime) });
      }).catch((error) => {
        console.error('[aapw] presentation frame failed', error);
      });
    };
    const handleVisibility = () => { if (document.hidden) void runtime.pause('document-hidden'); else void runtime.resume('document-visible'); };
    window.addEventListener('aapw-runtime-frame', frame);
    document.addEventListener('visibilitychange', handleVisibility);
    const refreshDpr = () => presentationBridge?.refreshDevicePixelRatio();
    window.addEventListener('resize', refreshDpr, { passive: true });
    unsubscribers.push(
      () => window.removeEventListener('aapw-runtime-frame', frame),
      () => document.removeEventListener('visibilitychange', handleVisibility),
      () => window.removeEventListener('resize', refreshDpr),
    );
    options.onReady?.(runtime);
    return runtime;
  })().catch((error) => {
    console.error('[aapw] production runtime bootstrap failed', error);
    presentationBridge?.dispose();
    presentationBridge = null;
    publishRuntime(null);
    options.onReady?.(null);
    return null;
  });
  return bootPromise;
}

export function requestProductionFrame(deltaMs?: number): Promise<Readonly<Record<string, unknown>> | null> {
  if (!activeRuntime) return Promise.resolve(null);
  return activeRuntime.frame(deltaMs).then(() => activeRuntime?.snapshot() ?? null);
}

export function dispatchProductionAction(type: string, payload?: unknown): boolean {
  return activeRuntime?.dispatchAction({ type, payload, source: 'programmatic' }) ?? false;
}

export async function saveProductionSession(slot?: number): Promise<boolean> {
  return activeRuntime?.session.requestSave('manual', slot) ?? false;
}

export function onGame3DReady(listener: (phase: string) => void): () => void {
  return gameEvents.on(EVENTS.GAME_READY, ({ phase }) => listener(phase));
}
