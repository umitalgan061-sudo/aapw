import type { CameraState, FrameId, RuntimeSnapshot, QualityTier } from './types';
import { createModernRuntime, tickModernRuntime, type RuntimeFrameInput, type RuntimeServices } from './runtime';
import { installEntryGate, type EntryGateController } from './entryGate';
import { platformEvents } from './eventBus';
import { modernState } from './stateStore';
import { readLegacyRenderMetrics, RendererPresentationBridge, type RendererPresentationLike } from './rendererPresentationBridge';

export interface Game3DEntryOptions {
  readonly canvas?: HTMLCanvasElement;
  readonly canvasId?: string;
  readonly loadingId?: string;
  readonly installGate?: boolean;
  readonly gateOptions?: Parameters<typeof installEntryGate>[0];
  readonly initialQuality?: QualityTier;
  readonly maxTelemetrySamples?: number;
  readonly startLoop?: boolean;
  readonly legacyLoader?: () => void | Promise<void>;
  readonly camera?: () => CameraState;
  readonly onReady?: (session: ModernGame3DSession) => void;
  readonly onFrame?: (snapshot: RuntimeSnapshot) => void;
  readonly onError?: (error: unknown) => void;
}

export interface LegacyGameModule {
  readonly initGame3D?: () => void | Promise<void>;
}

export interface LegacyEventBusModule {
  readonly gameEvents?: { readonly on?: (event: string, handler: (payload: unknown) => void) => void };
  readonly EVENTS?: Readonly<Record<string, string>>;
}

interface LegacyGameStateLike {
  readonly renderer?: RendererPresentationLike;
}

let activeSession: ModernGame3DSession | undefined;

export interface ModernGame3DSession {
  readonly runtime: RuntimeServices;
  readonly gate?: EntryGateController;
  readonly snapshot: () => RuntimeSnapshot | undefined;
  readonly frame: () => FrameId;
  readonly tick: (input?: Partial<RuntimeFrameInput>) => RuntimeSnapshot;
  readonly start: () => boolean;
  readonly stop: () => void;
  readonly dispose: () => void;
}

const DEFAULT_CAMERA: CameraState = Object.freeze({
  position: Object.freeze({ x: 0, y: 80, z: 120 }),
  target: Object.freeze({ x: 0, y: 0, z: 0 }),
  fov: 60,
  near: 0.1,
  far: 30_000,
  viewportWidth: 1,
  viewportHeight: 1,
  dpr: 1,
});

export async function bootstrapModernGame3D(options: Game3DEntryOptions = {}): Promise<ModernGame3DSession | undefined> {
  const loading = resolveElement(options.loadingId ?? 'game3d-loading');
  try {
    const canvas = options.canvas ?? resolveCanvas(options.canvasId ?? 'game3d-canvas');
    if (!canvas) throw new Error('GAME3D_CANVAS_MISSING');
    const runtime = await createModernRuntime({ canvas, initialQuality: options.initialQuality, maxTelemetrySamples: options.maxTelemetrySamples });
    const gate = options.installGate === false ? undefined : installEntryGate(options.gateOptions);
    const legacyLoaded = options.legacyLoader ? await options.legacyLoader() : await loadLegacyGame();
    bridgeLegacyEvents();
    const presentationBridge = new RendererPresentationBridge({
      rendererProvider: () => getLegacyGameState()?.renderer ?? null,
      minFramesBetweenChanges: 18,
      maxPixelRatio: 2.5,
      minPixelRatio: 0.6,
    });
    const refreshPresentationDpr = () => presentationBridge.refreshDevicePixelRatio();
    if (typeof window !== 'undefined') window.addEventListener('resize', refreshPresentationDpr, { passive: true });

    const state: { running: boolean; raf: number | undefined; lastTime: number | undefined; lastSnapshot: RuntimeSnapshot | undefined } = { running: false, raf: undefined, lastTime: undefined, lastSnapshot: undefined };
    const getCamera = (): CameraState => options.camera?.() ?? viewportCamera(canvas);

    const tick = (input: Partial<RuntimeFrameInput> = {}): RuntimeSnapshot => {
      const now = performanceNow();
      const previous = state.lastTime ?? now;
      const frameMs = input.frameMs ?? Math.max(0, Math.min(250, now - previous));
      runtime.clock.advance(frameMs);
      const frame = Number(runtime.clock.frame()) as FrameId;
      const renderState = getLegacyGameState();
      const legacyMetrics = readLegacyRenderMetrics(renderState);
      const snapshot = tickModernRuntime(runtime, {
        frame,
        frameMs,
        cpuMs: input.cpuMs ?? frameMs,
        gpuMs: input.gpuMs,
        drawCalls: input.drawCalls ?? legacyMetrics.drawCalls,
        triangles: input.triangles ?? legacyMetrics.triangles,
        visibleObjects: input.visibleObjects ?? 0,
        // Three.js exposes counts here but not a portable aggregate texture-byte budget.
        textureBytes: input.textureBytes ?? 0,
        memoryPressure: input.memoryPressure,
        thermalPressure: input.thermalPressure,
        camera: input.camera ?? getCamera(),
      });
      presentationBridge.apply(snapshot);
      state.lastTime = now;
      state.lastSnapshot = snapshot;
      modernState.patch({
        isLoading: false,
        loadProgress: 1,
        fps: frameMs > 0 ? 1000 / frameMs : 0,
        frameMs,
      });
      options.onFrame?.(snapshot);
      return snapshot;
    };

    const loop = (time: number): void => {
      if (!state.running) return;
      const previous = state.lastTime ?? time;
      tick({ frameMs: Math.max(0, Math.min(250, time - previous)) });
      state.raf = requestAnimationFrame(loop);
    };

    const start = (): boolean => {
      if (state.running) return true;
      state.running = true;
      state.lastTime = performanceNow();
      state.raf = requestAnimationFrame(loop);
      platformEvents.emit('runtime:loop', { action: 'start' });
      return true;
    };

    const stop = (): void => {
      if (!state.running) return;
      state.running = false;
      if (state.raf !== undefined) cancelAnimationFrame(state.raf);
      state.raf = undefined;
      platformEvents.emit('runtime:loop', { action: 'stop' });
    };

    const dispose = (): void => {
      stop();
      gate?.dispose();
      if (typeof window !== 'undefined') window.removeEventListener('resize', refreshPresentationDpr);
      presentationBridge.dispose();
      if (activeSession?.runtime === runtime) activeSession = undefined;
    };

    const session: ModernGame3DSession = Object.freeze({
      runtime,
      gate,
      snapshot: () => state.lastSnapshot,
      frame: () => Number(runtime.clock.frame()) as FrameId,
      tick,
      start,
      stop,
      dispose,
    });
    activeSession = session;
    tick({ frameMs: 0, cpuMs: 0, camera: getCamera() });
    loading?.classList.add('g3d-loading-hidden');
    platformEvents.emit('runtime:session', { backend: runtime.capabilities.backend, legacyLoaded: Boolean(legacyLoaded) });
    options.onReady?.(session);
    if (options.startLoop !== false && typeof requestAnimationFrame === 'function') start();
    return session;
  } catch (error) {
    showEntryError(loading, error);
    options.onError?.(error);
    return undefined;
  }
}

export const bootModernGame3D = bootstrapModernGame3D;

export function getActiveModernGame3DSession(): ModernGame3DSession | undefined { return activeSession; }

async function loadLegacyGame(): Promise<boolean> {
  const module = await import('../game3d.js') as unknown as LegacyGameModule;
  if (typeof module.initGame3D !== 'function') throw new Error('LEGACY_GAME_INIT_MISSING');
  await module.initGame3D();
  return true;
}

async function bridgeLegacyEvents(): Promise<void> {
  try {
    const module = await import('../eventBus.js') as unknown as LegacyEventBusModule;
    const events = module.gameEvents;
    const names = module.EVENTS ?? {};
    if (!events?.on) return;
    if (names.GAME_READY) events.on(names.GAME_READY, payload => platformEvents.emit('legacy:ready', payload));
    if (names.GAME_ERROR) events.on(names.GAME_ERROR, payload => platformEvents.emit('legacy:error', payload));
  } catch (error) {
    platformEvents.emit('legacy:bridge-error', { error: String(error) });
  }
}

function getLegacyGameState(): LegacyGameStateLike | null {
  const candidate = globalThis as typeof globalThis & { __AapwGame3DState?: LegacyGameStateLike };
  return candidate.__AapwGame3DState ?? null;
}

function resolveCanvas(id: string): HTMLCanvasElement | undefined {
  if (typeof document === 'undefined') return undefined;
  const element = document.getElementById(id);
  return element instanceof HTMLCanvasElement ? element : undefined;
}

function resolveElement(id: string): HTMLElement | undefined {
  if (typeof document === 'undefined') return undefined;
  const element = document.getElementById(id);
  return element instanceof HTMLElement ? element : undefined;
}

function viewportCamera(canvas: HTMLCanvasElement): CameraState {
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width || window.innerWidth));
  const height = Math.max(1, Math.round(rect.height || window.innerHeight));
  return { ...DEFAULT_CAMERA, viewportWidth: width, viewportHeight: height, dpr: Math.min(2.5, Math.max(1, window.devicePixelRatio || 1)) };
}

function performanceNow(): number { return typeof performance !== 'undefined' ? performance.now() : Date.now(); }
function showEntryError(loading: HTMLElement | undefined, error: unknown): void {
  if (!loading) return;
  loading.textContent = 'Bir şeyler ters gitti: 3D dünya başlatılamadı. Sayfayı yenilemeyi deneyin.';
  loading.classList.remove('g3d-loading-hidden');
  loading.classList.add('g3d-loading-error');
  console.error('[aapw/modern-entry]', error);
}
