import type { CameraState, FrameId, QualityTier, UnixMillis } from './types';
import { RuntimeKernel, type KernelFrameInput } from './runtimeKernel';
import { RuntimeStateGraph } from './runtimeState';
import { RuntimeSecurityBoundary } from './runtimeSecurity';
import { RuntimeTransport, LoopbackTransport, type TransportAdapter } from './networkTransport';
import { RuntimeSession, type RuntimeSceneAdapter } from './runtimeSession';
import { PerformanceLab } from './performanceLab';
import { TelemetryStore } from './telemetryStore';
import { SaveCoordinator } from './saveCoordinator';

export interface ProductionRuntimeConfig {
  readonly seed?: number;
  readonly fixedStepMs?: number;
  readonly telemetry?: boolean;
  readonly networking?: boolean;
  readonly persistence?: boolean;
  readonly security?: Partial<ConstructorParameters<typeof RuntimeSecurityBoundary>[0]>;
  readonly transport?: TransportAdapter;
  readonly now?: () => UnixMillis;
  readonly maxEntities?: number;
  readonly maxStateHistory?: number;
}

export interface ProductionRuntimeState {
  readonly lifecycle: 'created' | 'starting' | 'running' | 'paused' | 'stopping' | 'stopped' | 'faulted';
  readonly frame: FrameId;
  readonly quality: QualityTier;
  readonly backend: string;
  readonly network: ReturnType<RuntimeTransport<unknown>['stats']> | null;
  readonly performance: Readonly<Record<string, unknown>>;
  readonly telemetry: Readonly<Record<string, unknown>>;
  readonly stateDigest: string;
}

interface RuntimeGraphState extends Record<string, unknown> {
  frame: number;
  elapsedMs: number;
  quality: QualityTier;
  backend: string;
  paused: boolean;
  player: Record<string, unknown>;
  world: Record<string, unknown>;
}

const DEFAULT_STATE: RuntimeGraphState = {
  frame: 0,
  elapsedMs: 0,
  quality: 'high',
  backend: 'headless',
  paused: false,
  player: {},
  world: {},
};

function finiteDelta(value: number, fallback: number): number { return Number.isFinite(value) ? Math.max(0, Math.min(250, value)) : fallback; }
function viewportCamera(camera: CameraState): CameraState { return Object.freeze(structuredClone(camera)); }

/**
 * Production-level composition root for the browser game.
 *
 * The coordinator deliberately keeps all mutable cross-system state behind RuntimeStateGraph.
 * Kernel, persistence, telemetry, networking and security are replaceable services; the legacy
 * Three.js scene remains an adapter through RuntimeSceneAdapter.
 */
export class ProductionRuntime {
  readonly kernel: RuntimeKernel;
  readonly session: RuntimeSession;
  readonly state: RuntimeStateGraph<RuntimeGraphState>;
  readonly security: RuntimeSecurityBoundary;
  readonly performance: PerformanceLab;
  readonly telemetry: TelemetryStore;
  readonly saves: SaveCoordinator;
  readonly network: RuntimeTransport<unknown> | null;
  #now: () => UnixMillis;
  #status: ProductionRuntimeState['lifecycle'] = 'created';
  #scene?: RuntimeSceneAdapter;
  #networkEnabled: boolean;
  #telemetryEnabled: boolean;
  #persistenceEnabled: boolean;
  #startedAt: UnixMillis | null = null;
  #lastFrameAt: UnixMillis | null = null;
  #dispose: Array<() => void> = [];

  constructor(config: ProductionRuntimeConfig = {}, scene?: RuntimeSceneAdapter) {
    this.#now = config.now ?? (() => Date.now() as UnixMillis);
    this.#scene = scene;
    this.#networkEnabled = config.networking ?? false;
    this.#telemetryEnabled = config.telemetry ?? true;
    this.#persistenceEnabled = config.persistence ?? true;
    this.security = new RuntimeSecurityBoundary(config.security, this.#now);
    this.kernel = new RuntimeKernel({ seed: config.seed, fixedStepMs: config.fixedStepMs, maxEntities: config.maxEntities });
    this.session = new RuntimeSession({ seed: config.seed, fixedStepMs: config.fixedStepMs, scene, nowClock(this.#now), telemetryCapacity: 3600 });
    this.state = new RuntimeStateGraph<RuntimeGraphState>({ initial: DEFAULT_STATE, now: this.#now, maxHistory: config.maxStateHistory ?? 1200 });
    this.performance = new PerformanceLab({ now: this.#now });
    this.telemetry = new TelemetryStore({ now: this.#now, capacity: 7200, sampleRate: 1 });
    this.saves = new SaveCoordinator({ now: this.#now });
    this.network = this.#networkEnabled ? new RuntimeTransport(config.transport ?? new LoopbackTransport(), { now: this.#now, security: this.security }) : null;
    this.#wireEvents();
  }

  async start(): Promise<boolean> {
    if (this.#status === 'running') return true;
    if (this.#status === 'stopped') return false;
    this.#status = 'starting';
    try {
      this.kernel.start();
      this.session.start();
      if (this.network) {
        const connection = await this.network.connect();
        if (!connection.ok) this.security.sanitizeError(connection.error, 'network');
      }
      const now = this.#now();
      this.#startedAt = now;
      this.#lastFrameAt = now;
      this.#status = 'running';
      this.state.transaction({ source: 'system' }).set('backend', this.kernel.profile.preferredBackend).set('paused', false).commit();
      return true;
    } catch (error) {
      this.#status = 'faulted';
      this.security.sanitizeError(error, 'runtime');
      return false;
    }
  }

  async pause(reason = 'manual'): Promise<void> {
    if (this.#status !== 'running') return;
    this.#status = 'paused';
    await this.session.stop(false);
    this.kernel.stop();
    this.state.transaction({ source: 'system', reason }).set('paused', true).commit();
  }

  async resume(reason = 'manual'): Promise<boolean> {
    if (this.#status !== 'paused') return this.#status === 'running';
    this.#status = 'starting';
    try {
      this.kernel.start();
      this.session.start();
      this.#status = 'running';
      this.state.transaction({ source: 'system', reason }).set('paused', false).commit();
      return true;
    } catch (error) {
      this.#status = 'faulted';
      this.security.sanitizeError(error, 'runtime');
      return false;
    }
  }

  async stop(): Promise<void> {
    if (this.#status === 'stopped') return;
    this.#status = 'stopping';
    if (this.#persistenceEnabled) await this.session.stop(true);
    else await this.session.stop(false);
    this.kernel.stop();
    await this.network?.close();
    this.#status = 'stopped';
    for (const dispose of this.#dispose.splice(0)) dispose();
  }

  async frame(deltaMs = 1000 / 60): Promise<ProductionRuntimeState> {
    if (this.#status !== 'running' && !(await this.start())) throw new Error('Runtime is not running');
    const now = this.#now();
    const delta = finiteDelta(deltaMs, this.#lastFrameAt === null ? 16.6667 : Number(now) - Number(this.#lastFrameAt));
    this.#lastFrameAt = now;
    const session = await this.session.tick(delta);
    const frame = session.snapshot.frame;
    const quality = session.runtime.context.quality;
    const backend = session.runtime.packet.backend;
    const graph = this.state.transaction({ source: 'engine', frame }).
      set('frame', Number(frame)).
      set('elapsedMs', Number(frame) * delta).
      set('quality', quality).
      set('backend', backend).
      set('paused', false);
    if (session.snapshot.player) graph.set('player', session.snapshot.player as unknown as Record<string, unknown>);
    if (session.snapshot.world) graph.set('world', session.snapshot.world as unknown as Record<string, unknown>);
    graph.commit();

    if (this.#telemetryEnabled) {
      this.telemetry.record('frame', session.metrics.frameMs, frame);
      this.telemetry.record('simulation', session.metrics.simulationMs, frame);
      this.telemetry.record('presentation', session.metrics.presentationMs, frame);
      this.telemetry.record('pressure', session.metrics.pressure, frame);
    }
    if (this.network) {
      void this.network.send('runtime.frame', { frame, quality, backend, digest: session.snapshot.digest }, { priority: 1, reliable: false });
    }
    return this.snapshot();
  }

  dispatchAction(action: { readonly type: string; readonly payload?: unknown; readonly source?: 'ui' | 'engine' | 'network' | 'replay' }): boolean {
    const inspected = this.security.inspectPayload(action, action.source === 'network' ? 'network' : 'input', 'runtime-action');
    if (!inspected.ok) return false;
    try {
      this.session.handleAction({
        action: action.type,
        value: typeof action.payload === 'number' ? action.payload : 0,
        phase: 'value',
        source: action.source ?? 'ui',
        repeat: false,
      });
      return true;
    } catch (error) {
      this.security.sanitizeError(error, 'input');
      return false;
    }
  }

  snapshot(): ProductionRuntimeState {
    return Object.freeze({
      lifecycle: this.#status,
      frame: this.state.frame,
      quality: this.kernel.quality.tier,
      backend: this.kernel.profile.preferredBackend,
      network: this.network?.stats() ?? null,
      performance: this.performance.summary(),
      telemetry: this.telemetry.summary(),
      stateDigest: this.state.version().checksum,
    });
  }

  diagnostics(): Readonly<Record<string, unknown>> {
    return Object.freeze({
      status: this.snapshot(),
      security: { findings: this.security.findings(), blocked: [...this.security.findings().filter((item) => item.severity === 'blocker').map((item) => item.code)] },
      kernel: this.kernel.diagnosticsSnapshot(),
      session: this.session.diagnostics(),
      state: { revision: this.state.revision, history: this.state.history().length },
      network: this.network?.stats() ?? null,
    });
  }

  #wireEvents(): void {
    const unsubscribeQuality = this.kernel.events.on('render:quality-changed', ({ next }) => {
      this.state.transaction({ source: 'engine' }).set('quality', next).commit();
    });
    const unsubscribeFrame = this.kernel.events.on('runtime:frame', ({ frame }) => {
      this.state.transaction({ source: 'engine', frame }).set('frame', Number(frame)).commit();
    });
    this.#dispose.push(unsubscribeQuality, unsubscribeFrame);
  }
}

function nowClock(now: () => UnixMillis) {
  return { now, sleep: async (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)) };
}

export function createProductionRuntime(config: ProductionRuntimeConfig = {}, scene?: RuntimeSceneAdapter): ProductionRuntime {
  return new ProductionRuntime(config, scene);
}
