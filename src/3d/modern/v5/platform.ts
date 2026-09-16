import { DEFAULT_RUNTIME_CONFIG, RuntimeCapabilities, RuntimeConfig, RuntimePhase, RuntimeStatus, Tick, asTick } from './domain.ts';
import { EcsWorldV5 } from './ecs.ts';
import { CommandBusV5 } from './commandBus.ts';
import { FrameSchedulerV5 } from './scheduler.ts';
import { AssetGraphV5 } from './assetGraph.ts';
import { SnapshotHistoryV5, NetworkStateV5 } from './network.ts';
import { SaveRuntimeV5, MemorySaveStorage, snapshotFromWorld } from './persistence.ts';
import { TelemetryBufferV5, FrameHealthMonitorV5 } from './observability.ts';

export interface PlatformSnapshot {
  readonly status: RuntimeStatus;
  readonly phase: RuntimePhase;
  readonly tick: Tick;
  readonly capabilities: RuntimeCapabilities;
  readonly worldEntities: number;
  readonly pendingCommands: number;
  readonly residentAssetBytes: number;
  readonly healthScore: number;
}

export interface PlatformServices {
  readonly world: EcsWorldV5;
  readonly commands: CommandBusV5;
  readonly scheduler: FrameSchedulerV5;
  readonly assets: AssetGraphV5;
  readonly network: NetworkStateV5;
  readonly save: SaveRuntimeV5;
  readonly telemetry: TelemetryBufferV5;
  readonly health: FrameHealthMonitorV5;
}

export const detectCapabilities = (): RuntimeCapabilities => {
  const navigatorValue = typeof navigator === 'undefined' ? undefined : navigator;
  const hasWindow = typeof window !== 'undefined';
  const webgpu = !!(navigatorValue && 'gpu' in navigatorValue);
  const sharedArrayBuffer = typeof SharedArrayBuffer !== 'undefined';
  const offscreenCanvas = typeof OffscreenCanvas !== 'undefined';
  const gamepad = !!navigatorValue?.getGamepads;
  const touch = hasWindow && ('ontouchstart' in window || (navigatorValue?.maxTouchPoints ?? 0) > 0);
  return {
    webgl2: hasWindow && typeof WebGL2RenderingContext !== 'undefined',
    webgpu,
    sharedArrayBuffer,
    offscreenCanvas,
    gamepad,
    touch,
    hardwareConcurrency: Math.max(1, Number(navigatorValue?.hardwareConcurrency ?? 1)),
    devicePixelRatio: Math.max(1, Number(hasWindow ? window.devicePixelRatio : 1)),
  };
};

export class RuntimePlatformV5 {
  readonly config: RuntimeConfig;
  readonly capabilities: RuntimeCapabilities;
  readonly services: PlatformServices;
  #status: RuntimeStatus = 'cold';
  #phase: RuntimePhase = 'boot';
  #tick: Tick = asTick(0);
  #startedAt = 0;

  constructor(config: Partial<RuntimeConfig> = {}) {
    this.config = { ...DEFAULT_RUNTIME_CONFIG, ...config };
    this.capabilities = detectCapabilities();
    const telemetry = new TelemetryBufferV5();
    this.services = {
      world: new EcsWorldV5(this.config.maxEntities),
      commands: new CommandBusV5(this.config.maxCommandsPerTick),
      scheduler: new FrameSchedulerV5(1000 / this.config.tickRate),
      assets: new AssetGraphV5({ maxBytes: this.config.maxAssetBytes }),
      network: new NetworkStateV5({ maxBytesPerTick: this.config.maxNetworkBytesPerTick, maxHistory: this.config.snapshotHistory }),
      save: new SaveRuntimeV5(new MemorySaveStorage()),
      telemetry,
      health: new FrameHealthMonitorV5(telemetry),
    };
  }

  get status(): RuntimeStatus { return this.#status; }
  get phase(): RuntimePhase { return this.#phase; }
  get tick(): Tick { return this.#tick; }

  async start(signal?: AbortSignal): Promise<void> {
    if (this.#status === 'ready' || this.#status === 'starting') return;
    this.#status = 'starting';
    this.#phase = 'boot';
    this.#startedAt = Date.now();
    if (signal?.aborted) { this.#status = 'stopped'; return; }
    this.#status = 'ready';
    this.#phase = 'simulate';
    this.services.telemetry.log('info', 'platform', 'runtime started', { node: this.config.maxEntities, tickRate: this.config.tickRate });
  }

  async step(deltaSeconds: number, signal?: AbortSignal): Promise<void> {
    if (this.#status !== 'ready') throw new Error(`runtime is not ready: ${this.#status}`);
    const step = 1 / this.config.tickRate;
    let remaining = Math.max(0, deltaSeconds);
    let steps = 0;
    while (remaining >= step && steps < this.config.maxCatchUpSteps) {
      if (signal?.aborted) return;
      this.#phase = 'simulate';
      await this.services.commands.drain(this.#tick, signal);
      await this.services.scheduler.run(this.#tick, step, { signal });
      this.#tick = this.services.world.advanceTick();
      remaining -= step;
      steps += 1;
    }
    this.#phase = 'present';
    this.services.health.record(this.services.scheduler.getBudget().totalMs, this.services.scheduler.getBudget(), this.#tick);
    this.#phase = 'simulate';
  }

  async saveNow(): Promise<void> {
    this.#phase = 'save';
    const snapshot = snapshotFromWorld(this.services.world, { startedAt: this.#startedAt, status: this.#status });
    const result = await this.services.save.save(snapshot);
    if (!result.ok) this.services.telemetry.log('error', 'persistence', 'runtime save failed', { error: result.error });
    else this.services.telemetry.log('info', 'persistence', 'runtime saved', { bytes: result.bytes, checksum: result.checksum });
    this.#phase = 'simulate';
  }

  async stop(): Promise<void> {
    if (this.#status === 'stopped' || this.#status === 'cold') { this.#status = 'stopped'; return; }
    await this.saveNow();
    this.#phase = 'shutdown';
    this.#status = 'stopped';
    this.services.telemetry.log('info', 'platform', 'runtime stopped', { tick: this.#tick });
  }

  snapshot(): PlatformSnapshot {
    const health = this.services.telemetry.reportHealth();
    return {
      status: this.#status,
      phase: this.#phase,
      tick: this.#tick,
      capabilities: this.capabilities,
      worldEntities: this.services.world.stats().entities,
      pendingCommands: this.services.commands.pendingCount(),
      residentAssetBytes: this.services.assets.residentBytes(),
      healthScore: health.score,
    };
  }
}

export const installPlatform = (config: Partial<RuntimeConfig> = {}): RuntimePlatformV5 => new RuntimePlatformV5(config);
