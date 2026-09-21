import type { InputFrame, Tick, Vec3 } from '../types.ts';
import { InputButton } from '../input.ts';
import type {
  ProductionFrameResult,
  RuntimeEventBus,
  RuntimeFault,
  RuntimeIdentity,
  RuntimeMode,
  RuntimeHealthReport,
  NetworkTransport,
} from './contracts.ts';
import { createProductionRuntimeController, type BrowserRuntimeAdapters, type ProductionRuntimeController } from './runtimeController.ts';

export interface LegacyGameStateLike {
  paused?: boolean;
  player?: { object3D?: { position?: Partial<Vec3>; rotation?: { y?: number } } };
  camera?: { position?: Partial<Vec3> };
  elapsedSeconds?: number;
  qualityTier?: string;
  renderer?: {
    info?: {
      render?: { calls?: number; triangles?: number; points?: number };
      memory?: { geometries?: number; textures?: number };
    };
    capabilities?: { isWebGL2?: boolean; maxTextureSize?: number };
  };
  entities?: readonly LegacyEntityLike[];
}

export interface LegacyEntityLike {
  id?: number | string;
  object3D?: {
    position?: Partial<Vec3>;
    rotation?: { y?: number };
    visible?: boolean;
  };
  health?: number;
  stamina?: number;
  flags?: number;
}

export interface ProductionBridgeConfig {
  readonly identity?: Partial<RuntimeIdentity>;
  readonly maxEntities?: number;
  readonly maxVisibleEntities?: number;
  readonly coarsePointer?: boolean;
  readonly session?: string;
}

export interface BridgeFrameContext {
  readonly nowMs?: number;
  readonly deltaSeconds: number;
  readonly input?: InputFrame;
  readonly paused?: boolean;
  readonly simulationMs?: number;
  readonly streamingMs?: number;
  readonly networkMs?: number;
  readonly renderMs?: number;
}

export interface BridgeStats {
  readonly attached: boolean;
  readonly frames: number;
  readonly importedEntities: number;
  readonly lastTick: Tick;
  readonly mode: RuntimeMode;
  readonly faults: number;
}

export class LegacyRuntimeBridge {
  readonly runtime: ProductionRuntimeController;
  readonly events: RuntimeEventBus;
  #attached = false;
  #frames = 0;
  #importedEntities = 0;
  #lastTick: Tick = 0 as Tick;
  #faults = 0;
  #unbind: Array<() => void> = [];
  #legacy: LegacyGameStateLike | undefined;

  constructor(runtime: ProductionRuntimeController = createProductionRuntimeController(), legacy?: LegacyGameStateLike) {
    this.runtime = runtime;
    this.events = runtime.events;
    this.#legacy = legacy;
  }

  attach(legacy: LegacyGameStateLike): void {
    if (this.#attached) this.detach();
    this.#legacy = legacy;
    this.#attached = true;
    this.#syncLegacyEntities(legacy);
    this.#unbind.push(this.events.on('fault', (fault) => {
      this.#faults += 1;
      this.#applyFault(fault);
    }));
    this.#unbind.push(this.events.on('health', (health) => this.#applyHealth(health)));
    this.#unbind.push(this.events.on('renderPlan', (plan) => {
      if (legacy.renderer?.info?.render) legacy.renderer.info.render.calls = plan.commands.length;
    }));
    legacy.paused = this.runtime.health().mode === 'paused';
  }

  detach(): void {
    for (const unsubscribe of this.#unbind.splice(0)) unsubscribe();
    this.#attached = false;
  }

  async start(): Promise<void> {
    await this.runtime.start();
    if (this.#legacy) this.#legacy.paused = false;
  }

  async pause(): Promise<boolean> {
    const ok = await this.runtime.pause();
    if (ok && this.#legacy) this.#legacy.paused = true;
    return ok;
  }

  async resume(): Promise<boolean> {
    const ok = await this.runtime.resume();
    if (ok && this.#legacy) this.#legacy.paused = false;
    return ok;
  }

  async stop(): Promise<void> {
    await this.runtime.stop();
    if (this.#legacy) this.#legacy.paused = true;
  }

  async frame(context: BridgeFrameContext): Promise<ProductionFrameResult> {
    if (!this.#attached && this.#legacy) this.attach(this.#legacy);
    if (this.#legacy) this.#syncLegacyEntities(this.#legacy);
    this.#frames += 1;
    const paused = context.paused ?? this.#legacy?.paused ?? false;
    const result = await this.runtime.frame({
      deltaSeconds: paused ? 0 : context.deltaSeconds,
      wallTimeMs: context.nowMs,
      input: context.input,
      budget: {
        simulationMs: context.simulationMs ?? 0,
        renderMs: context.renderMs ?? 0,
        streamingMs: context.streamingMs ?? 0,
        networkMs: context.networkMs ?? 0,
        totalMs: (context.simulationMs ?? 0) + (context.renderMs ?? 0) + (context.streamingMs ?? 0) + (context.networkMs ?? 0),
      },
    });
    this.#lastTick = result.tick;
    this.#applyResult(result);
    return result;
  }

  feedKeyboardLikeInput(tickValue: Tick, axes: { x: number; z: number }, buttons = 0, look = { x: 0, y: 0 }): boolean {
    return this.runtime.submitInput({
      tick: tickValue,
      moveX: clampAxis(axes.x),
      moveZ: clampAxis(axes.z),
      lookX: clampAxis(look.x),
      lookY: clampAxis(look.y),
      buttons: buttons >>> 0,
    });
  }

  importEntity(entity: LegacyEntityLike): number | undefined {
    const id = normalizeEntityId(entity.id);
    const position = normalizePosition(entity.object3D?.position);
    const payload = {
      id: id ?? undefined,
      position,
      yawRadians: entity.object3D?.rotation?.y ?? 0,
      health: entity.health ?? 100,
      stamina: entity.stamina ?? 100,
      flags: entity.flags ?? 0,
    };
    const created = this.runtime.entities.upsert(payload);
    const state = this.runtime.entities.get(created);
    if (state) this.runtime.runtime.indexEntity(created, state.transform.position.x, state.transform.position.z, state.transform.radiusMeters);
    this.#importedEntities += 1;
    return created;
  }

  importEntities(entities: readonly LegacyEntityLike[]): number {
    let count = 0;
    const sorted = [...entities].sort(compareLegacyEntities);
    for (const entity of sorted) if (this.importEntity(entity) !== undefined) count += 1;
    return count;
  }

  connectPeer(peerId: string, transport: NetworkTransport = 'loopback'): void {
    this.runtime.connectPeer(peerId, transport);
  }

  health(): RuntimeHealthReport {
    return this.runtime.health();
  }

  stats(): BridgeStats {
    return {
      attached: this.#attached,
      frames: this.#frames,
      importedEntities: this.#importedEntities,
      lastTick: this.#lastTick,
      mode: this.runtime.stats().mode,
      faults: this.#faults,
    };
  }

  dispose(): void {
    this.detach();
    void this.runtime.dispose();
  }

  #syncLegacyEntities(legacy: LegacyGameStateLike): void {
    const entities = legacy.entities ?? [];
    if (entities.length === 0 && legacy.player?.object3D) {
      const visible = this.runtime.entities.visibleIds();
      const id = visible[0] ?? this.runtime.createEntity({
        position: normalizePosition(legacy.player.object3D.position),
        yawRadians: legacy.player.object3D.rotation?.y ?? 0,
      });
      this.runtime.moveEntity(id, normalizePosition(legacy.player.object3D.position));
      return;
    }
    this.importEntities(entities.slice(0, this.runtime.entities.limits.maxEntities));
  }

  #applyResult(result: ProductionFrameResult): void {
    const legacy = this.#legacy;
    if (!legacy) return;
    legacy.elapsedSeconds = result.health.clock.simTimeSeconds;
    legacy.paused = result.mode === 'paused';
    legacy.qualityTier = result.renderPlan.tier;
    if (legacy.camera?.position) {
      const state = this.runtime.camera.state;
      legacy.camera.position.x = state.position.x;
      legacy.camera.position.y = state.position.y;
      legacy.camera.position.z = state.position.z;
    }
    if (legacy.renderer?.info?.render) {
      legacy.renderer.info.render.calls = result.renderPlan.commands.length;
      legacy.renderer.info.render.triangles = result.renderPlan.commands.reduce((sum, command) => sum + (command.lod === 0 ? 24 : command.lod === 1 ? 12 : 6), 0);
    }
  }

  #applyFault(fault: RuntimeFault): void {
    if (!this.#legacy) return;
    if (fault.subsystem === 'render') this.#legacy.qualityTier = 'safe';
    if (fault.subsystem === 'simulation') this.#legacy.paused = true;
  }

  #applyHealth(health: RuntimeHealthReport): void {
    if (this.#legacy && health.mode === 'faulted') this.#legacy.paused = true;
  }
}

function compareLegacyEntities(a: LegacyEntityLike, b: LegacyEntityLike): number {
  const left = normalizeEntityId(a.id) ?? Number.MAX_SAFE_INTEGER;
  const right = normalizeEntityId(b.id) ?? Number.MAX_SAFE_INTEGER;
  return left - right || String(a.id ?? '').localeCompare(String(b.id ?? ''));
}

function normalizeEntityId(value: number | string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = typeof value === 'number' ? value : Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return Math.floor(parsed);
}

function normalizePosition(value: Partial<Vec3> | undefined): Vec3 {
  return { x: finite(value?.x), y: finite(value?.y), z: finite(value?.z) };
}

function finite(value: number | undefined): number {
  return Number.isFinite(value) ? Number(value) : 0;
}

function clampAxis(value: number): number {
  return Math.min(1, Math.max(-1, Number.isFinite(value) ? value : 0));
}

export function detectBrowserAdapters(): BrowserRuntimeAdapters {
  return {
    nowMs: () => globalThis.performance?.now?.() ?? Date.now(),
    getCameraPosition: () => ({ x: 0, y: 0, z: 0 }),
    getCameraForward: () => ({ x: 0, y: 0, z: -1 }),
    getRenderCapabilities: () => {
      const memory = typeof globalThis.navigator?.deviceMemory === 'number' ? globalThis.navigator.deviceMemory : 4;
      const cores = globalThis.navigator?.hardwareConcurrency ?? 4;
      return {
        maxTextureSize: 4096,
        supportsInstancing: true,
        supportsWebGL2: true,
        deviceMemoryGb: memory,
        hardwareConcurrency: cores,
      };
    },
    isCoarsePointer: () => {
      try {
        return Boolean(globalThis.matchMedia?.('(pointer: coarse)').matches);
      } catch {
        return false;
      }
    },
  };
}

export function createLegacyRuntimeBridge(legacy?: LegacyGameStateLike, config: ProductionBridgeConfig = {}): LegacyRuntimeBridge {
  const adapters = detectBrowserAdapters();
  const controller = createProductionRuntimeController({
    identity: config.identity,
    maxEntities: config.maxEntities,
    maxVisibleEntities: config.maxVisibleEntities,
    coarsePointer: config.coarsePointer,
    networkSession: config.session,
  }, adapters);
  return new LegacyRuntimeBridge(controller, legacy);
}
