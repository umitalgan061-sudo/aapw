import {
  type EntityIdV4,
  type InputModeV4,
  type RenderViewV4,
  type RuntimeId,
  type RuntimeSnapshotV4,
  type RuntimeHealthV4,
  type RuntimeStatsV4,
  type TransformV4,
  type Vec3V4,
  type QualityTierV4,
  entityIdV4,
  transformV4,
  vec3V4,
  quaternionV4,
  tickId,
} from './runtimeContractsV4';
import { RuntimeOrchestratorV4, type RuntimeFrameResultV4 } from './runtimeOrchestratorV4';
import type { AssetFetcherV4 } from './assetStreamingV4';

export interface LegacyPlayerStateV4 {
  readonly id: string;
  readonly position: Vec3V4;
  readonly velocity: Vec3V4;
  readonly yaw: number;
  readonly pitch: number;
  readonly health: number;
  readonly stamina: number;
  readonly quality: QualityTierV4;
}

export interface LegacyRuntimeBridgeV4 {
  readonly runtimeId: string;
  readonly phase: string;
  readonly frame: number;
  readonly tick: number;
  readonly healthScore: number;
  readonly player: LegacyPlayerStateV4 | null;
}

export interface RuntimeFacadeOptionsV4 {
  readonly id?: string;
  readonly assetFetcher?: AssetFetcherV4;
  readonly now?: () => number;
}

export interface RuntimeFacadeHooksV4 {
  readonly onBridge?: (state: LegacyRuntimeBridgeV4) => void;
  readonly onFrame?: (frame: RuntimeFrameResultV4) => void;
  readonly onError?: (error: Error) => void;
}

const noopFetcher: AssetFetcherV4 = {
  fetch: async () => new ArrayBuffer(0),
};

export class RuntimeV4Facade {
  readonly runtime: RuntimeOrchestratorV4;
  readonly id: RuntimeId;
  readonly playerId: EntityIdV4;
  #hooks: RuntimeFacadeHooksV4 = {};
  #player: LegacyPlayerStateV4 | null = null;

  constructor(options: RuntimeFacadeOptionsV4 = {}) {
    this.runtime = new RuntimeOrchestratorV4({ id: options.id, now: options.now, assetFetcher: options.assetFetcher ?? noopFetcher });
    this.id = this.runtime.id;
    this.playerId = entityIdV4(1);
    this.#installBridgeHooks();
  }

  configure(hooks: RuntimeFacadeHooksV4): void {
    this.#hooks = hooks;
  }

  boot(): boolean {
    return this.runtime.start().ok;
  }

  pause(): boolean {
    return this.runtime.pause();
  }

  resume(): boolean {
    return this.runtime.resume();
  }

  shutdown(): boolean {
    return this.runtime.stop();
  }

  setQuality(quality: QualityTierV4): boolean {
    return this.runtime.setQuality(quality);
  }

  setInputMode(mode: InputModeV4): void {
    this.runtime.setInputMode(mode);
  }

  registerPlayer(transform: TransformV4): void {
    const existing = this.#player;
    this.#player = Object.freeze({
      id: String(this.playerId),
      position: transform.position,
      velocity: vec3V4(),
      yaw: 0,
      pitch: 0,
      health: existing?.health ?? 100,
      stamina: existing?.stamina ?? 100,
      quality: this.runtime.render.quality(),
    });
    this.runtime.spatial.upsert({ entity: this.playerId, position: transform.position, radius: 0.6, layer: 0, flags: 1 });
  }

  movePlayer(position: Vec3V4, velocity = vec3V4()): void {
    const player = this.#player;
    this.#player = Object.freeze({
      id: String(this.playerId),
      position,
      velocity,
      yaw: player?.yaw ?? 0,
      pitch: player?.pitch ?? 0,
      health: player?.health ?? 100,
      stamina: player?.stamina ?? 100,
      quality: this.runtime.render.quality(),
    });
    this.runtime.spatial.upsert({ entity: this.playerId, position, radius: 0.6, layer: 0, flags: 1 });
  }

  damagePlayer(amount: number): number {
    const player = this.#player;
    if (!player) return 0;
    const next = Math.max(0, player.health - Math.max(0, Number.isFinite(amount) ? amount : 0));
    this.#player = Object.freeze({ ...player, health: next });
    return player.health - next;
  }

  recoverPlayer(amount: number): number {
    const player = this.#player;
    if (!player) return 0;
    const next = Math.min(100, player.health + Math.max(0, Number.isFinite(amount) ? amount : 0));
    this.#player = Object.freeze({ ...player, health: next });
    return next - player.health;
  }

  consumeStamina(amount: number): number {
    const player = this.#player;
    if (!player) return 0;
    const next = Math.max(0, player.stamina - Math.max(0, Number.isFinite(amount) ? amount : 0));
    this.#player = Object.freeze({ ...player, stamina: next });
    return player.stamina - next;
  }

  regenerateStamina(amount: number): number {
    const player = this.#player;
    if (!player) return 0;
    const next = Math.min(100, player.stamina + Math.max(0, Number.isFinite(amount) ? amount : 0));
    this.#player = Object.freeze({ ...player, stamina: next });
    return next - player.stamina;
  }

  async renderFrame(view: RenderViewV4): Promise<RuntimeFrameResultV4 | null> {
    const result = await this.runtime.frame(view);
    if (!result.ok) {
      this.#hooks.onError?.(new Error(result.error.message));
      return null;
    }
    this.#hooks.onFrame?.(result.value);
    return result.value;
  }

  snapshot(): RuntimeSnapshotV4 {
    return this.runtime.snapshot();
  }

  restore(snapshot: RuntimeSnapshotV4): boolean {
    return this.runtime.restore(snapshot).ok;
  }

  health(): RuntimeHealthV4 {
    return this.runtime.health();
  }

  stats(): RuntimeStatsV4 {
    const health = this.runtime.health();
    const metrics = this.runtime.metrics();
    return { frame: metrics.frames, tick: tickId(metrics.ticks), deltaMs: this.runtime.fixedStepMs, cpuMs: 0, gpuMs: 0, entityCount: this.runtime.spatial.metrics().items, visibleCount: 0, queuedCommands: this.runtime.commandBus.size, queuedAssets: this.runtime.assets.metrics().queued };
  }

  bridgeState(): LegacyRuntimeBridgeV4 {
    return Object.freeze({ runtimeId: String(this.id), phase: this.runtime.phase(), frame: this.runtime.metrics().frames, tick: this.runtime.metrics().ticks, healthScore: this.runtime.health().score, player: this.#player });
  }

  asTransform(): TransformV4 {
    const player = this.#player;
    return transformV4(player?.position ?? vec3V4(), quaternionV4((player?.pitch ?? 0) * 0.5, (player?.yaw ?? 0) * 0.5, 0, 1), vec3V4(1, 1, 1));
  }

  #installBridgeHooks(): void {
    this.runtime.setHooks({
      onFrame: (frame) => this.#hooks.onFrame?.(frame),
      onError: (error) => this.#hooks.onError?.(error),
    });
  }

  get player(): LegacyPlayerStateV4 | null {
    return this.#player;
  }
}

export function createRuntimeV4Facade(options: RuntimeFacadeOptionsV4 = {}): RuntimeV4Facade {
  return new RuntimeV4Facade(options);
}
