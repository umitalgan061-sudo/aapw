/** Compatibility boundary for gradually moving legacy world systems into TypeScript. */

import { NextGenRuntimeV3 } from './runtimeFacadeV3';
import type { PlayerInput, PlayerState } from './playerPrediction';
import type { Vec3 } from './deterministicMath';

export interface LegacyPlayerLike {
  position?: { x?: number; y?: number; z?: number };
  velocity?: { x?: number; y?: number; z?: number };
  rotationY?: number;
  health?: number;
  stamina?: number;
}

export interface LegacySceneAdapter {
  readPlayer(): LegacyPlayerLike | null;
  writePlayer(state: PlayerState): void;
  readEntities(): readonly { id?: number; position?: Partial<Vec3> }[];
  onRuntimeEvent?(event: RuntimeInteropEvent): void;
}

export interface RuntimeInteropEvent {
  type: 'attached' | 'detached' | 'player-sync' | 'runtime-warning';
  entityId: number | null;
  tick: number;
  detail: string;
}

function numeric(value: unknown, fallback = 0): number { return typeof value === 'number' && Number.isFinite(value) ? value : fallback; }
function vec3FromLegacy(value: LegacyPlayerLike['position']): Vec3 { return { x: numeric(value?.x), y: numeric(value?.y), z: numeric(value?.z) }; }
function velocityFromLegacy(value: LegacyPlayerLike['velocity']): Vec3 { return { x: numeric(value?.x), y: numeric(value?.y), z: numeric(value?.z) }; }

export class LegacyInteropV3 {
  readonly runtime: NextGenRuntimeV3;
  readonly adapter: LegacySceneAdapter;
  #playerEntity: number | null = null;
  #attached = false;
  #nextInputSequence = 1;

  constructor(runtime: NextGenRuntimeV3, adapter: LegacySceneAdapter) {
    this.runtime = runtime;
    this.adapter = adapter;
  }

  attach(): number {
    if (this.#attached && this.#playerEntity !== null) return this.#playerEntity;
    const legacy = this.adapter.readPlayer();
    const initial = this.fromLegacyPlayer(legacy);
    this.#playerEntity = this.runtime.createPlayer(initial);
    this.#attached = true;
    this.emit({ type: 'attached', entityId: this.#playerEntity, tick: this.runtime.kernel.clock.tick, detail: 'next-generation runtime attached to legacy world' });
    this.syncToLegacy();
    return this.#playerEntity;
  }

  detach(): void {
    if (!this.#attached) return;
    this.emit({ type: 'detached', entityId: this.#playerEntity, tick: this.runtime.kernel.clock.tick, detail: 'next-generation runtime detached' });
    this.#attached = false;
    this.#playerEntity = null;
  }

  syncFromLegacy(): void {
    if (!this.#attached || this.#playerEntity === null) return;
    const legacy = this.adapter.readPlayer();
    if (!legacy) return;
    const state = this.fromLegacyPlayer(legacy);
    this.runtime.reconcilePlayer(this.#playerEntity, { tick: this.runtime.kernel.clock.tick, state });
  }

  syncToLegacy(): void {
    if (!this.#attached || this.#playerEntity === null) return;
    const state = this.runtime.getPlayerState(this.#playerEntity);
    if (state) {
      this.adapter.writePlayer(state);
      this.emit({ type: 'player-sync', entityId: this.#playerEntity, tick: this.runtime.kernel.clock.tick, detail: 'player state copied into legacy adapter' });
    } else {
      this.emit({ type: 'runtime-warning', entityId: this.#playerEntity, tick: this.runtime.kernel.clock.tick, detail: 'interop player state unavailable' });
    }
  }

  convertInput(legacy: Partial<PlayerInput>): PlayerInput {
    if (this.#playerEntity === null) throw new Error('interop player not attached');
    const sequence = legacy.sequence ?? this.#nextInputSequence++;
    if (sequence >= this.#nextInputSequence) this.#nextInputSequence = sequence + 1;
    return {
      tick: legacy.tick ?? this.runtime.kernel.clock.tick + 1,
      sequence,
      move: legacy.move ?? { x: 0, y: 0 },
      lookYaw: legacy.lookYaw ?? 0,
      jump: Boolean(legacy.jump),
      sprint: Boolean(legacy.sprint),
      dodge: Boolean(legacy.dodge),
    };
  }

  entityCount(): number { return this.adapter.readEntities().length; }
  get playerEntity(): number | null { return this.#playerEntity; }
  get attached(): boolean { return this.#attached; }

  private fromLegacyPlayer(legacy: LegacyPlayerLike | null): PlayerState {
    return {
      position: vec3FromLegacy(legacy?.position),
      velocity: velocityFromLegacy(legacy?.velocity),
      yaw: numeric(legacy?.rotationY),
      stamina: numeric(legacy?.stamina, 100),
      grounded: true,
      jumpTicks: 0,
      lastProcessedInput: 0,
    };
  }

  private emit(event: RuntimeInteropEvent): void { this.adapter.onRuntimeEvent?.(event); }
}

export function createLegacyInterop(runtime: NextGenRuntimeV3, adapter: LegacySceneAdapter): LegacyInteropV3 { return new LegacyInteropV3(runtime, adapter); }
