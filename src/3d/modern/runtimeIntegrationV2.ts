import { CombatAuthority, makeCombatActor, makeCombatTarget, type CombatEvent, type CombatTarget } from './combatAuthority.ts';
import { PlayerAuthority, defaultPlayerState, type PlayerInput, type PlayerEvent, type PlayerState } from './playerAuthority.ts';
import { WorldChunkRuntime, type ChunkFramePlan } from './worldChunkRuntime.ts';
import { SpatialHash2D, type SpatialItem } from './worldSpatialIndex.ts';
import { WorldClock, type WorldClockState } from './worldSimulation.ts';
import { deterministicStateHash, type Vec3, type Vec2 } from './types.ts';

export interface RuntimeIntegrationOptions {
  readonly playerId?: string;
  readonly worldSeed?: number;
  readonly chunkSize?: number;
  readonly chunkLoadRadius?: number;
  readonly chunkUnloadRadius?: number;
  readonly maxConcurrentChunkLoads?: number;
  readonly maxChunkBytes?: number;
  readonly now?: () => number;
}

export interface RuntimeFrameInput {
  readonly player?: PlayerInput;
  readonly deltaMs: number;
  readonly camera?: Vec2;
}

export interface RuntimeFrameResult {
  readonly frame: number;
  readonly time: WorldClockState;
  readonly player: PlayerState;
  readonly playerEvents: readonly PlayerEvent[];
  readonly combatEvents: readonly CombatEvent[];
  readonly chunks: ChunkFramePlan;
  readonly nearby: readonly string[];
  readonly digest: string;
}

export interface RuntimeIntegrationMetrics {
  readonly frame: number;
  readonly elapsedMs: number;
  readonly playerRevision: number;
  readonly spatialItems: number;
  readonly nearbyQueries: number;
  readonly chunkResidentBytes: number;
  readonly chunkActive: number;
  readonly combatActors: number;
  readonly combatTargets: number;
  readonly digest: string;
}

const noopLoader = async (_id: { key: string }, _signal: AbortSignal): Promise<{ bytes: number }> => ({ bytes: 0 });

export class RuntimeIntegrationV2 {
  readonly clock: WorldClock;
  readonly player: PlayerAuthority;
  readonly combat: CombatAuthority;
  readonly spatial: SpatialHash2D<{ kind: string; team?: string }>; 
  readonly chunks: WorldChunkRuntime;
  readonly #now: () => number;
  #frame = 0;
  #elapsedMs = 0;
  #nearbyQueries = 0;
  #lastDigest = '';

  constructor(options: RuntimeIntegrationOptions = {}, chunkLoader = noopLoader) {
    this.#now = options.now ?? (() => performance.now());
    this.clock = new WorldClock({ seed: options.worldSeed ?? 0x57455354 });
    this.player = new PlayerAuthority({ id: options.playerId ?? 'player-1', now: this.#now });
    this.combat = new CombatAuthority(undefined, { now: this.#now });
    this.spatial = new SpatialHash2D( Math.max(8, options.chunkSize ?? 32) );
    this.chunks = new WorldChunkRuntime({
      loadRadius: options.chunkLoadRadius ?? 4,
      unloadRadius: options.chunkUnloadRadius ?? 6,
      maxLoadsPerFrame: 2,
      maxUnloadsPerFrame: 2,
      maxConcurrentLoads: options.maxConcurrentChunkLoads ?? 2,
      maxResidentBytes: options.maxChunkBytes ?? 512 * 1024 * 1024,
      now: this.#now,
    }, chunkLoader);
    const actor = makeCombatActor(this.player.state.id, 'player');
    this.combat.registerActor(actor);
  }

  registerWorldActor(item: SpatialItem<{ kind: string; team?: string }>, combatTarget?: CombatTarget): void {
    this.spatial.set(item);
    if (combatTarget) this.combat.registerTarget(combatTarget);
  }

  unregisterWorldActor(id: string): void {
    this.spatial.remove(id);
    this.combat.removeTarget(id);
  }

  tick(input: RuntimeFrameInput): RuntimeFrameResult {
    const deltaMs = Math.min(100, Math.max(0, Number.isFinite(input.deltaMs) ? input.deltaMs : 0));
    this.#frame += 1;
    this.#elapsedMs += deltaMs;
    const time = this.clock.update(deltaMs / 1000);
    const playerResult = this.player.step(input.player ?? {
      moveX: 0, moveZ: 0, sprint: false, jumpPressed: false, dodgePressed: false,
      attackPressed: false, heavyPressed: false, block: false,
    }, deltaMs);
    const actor = this.combat.actor(this.player.state.id);
    if (actor) {
      this.combat.registerActor({ ...actor, x: this.player.state.transform.x, z: this.player.state.transform.z, yaw: this.player.state.transform.yaw, health: this.player.state.stats.health, stamina: this.player.state.stats.stamina, state: this.player.state.locomotion === 'dead' ? 'dead' : actor.state });
    }
    if (playerResult.events.some((event) => event.type === 'attack')) {
      const heavy = playerResult.events.some((event) => event.type === 'attack' && event.heavy);
      this.combat.startAttack(this.player.state.id, heavy);
    }
    const combatEvents = this.combat.step(deltaMs);
    this.combat.recover(deltaMs);
    const chunkCenter = input.camera ?? { x: Math.floor(this.player.state.transform.x / 32), y: Math.floor(this.player.state.transform.z / 32) };
    const chunks = this.chunks.plan(chunkCenter);
    const nearby = this.spatial.queryCircle({ x: this.player.state.transform.x, y: this.player.state.transform.z }, 24, { maxResults: 96, sortByDistance: true }).map((item) => item.id);
    this.#nearbyQueries += 1;
    const digestPayload = {
      frame: this.#frame,
      elapsedMs: this.#elapsedMs,
      time,
      player: this.player.state,
      nearby,
      chunkKeys: this.chunks.loadedKeys(),
      combatEvents: combatEvents.map((event) => ({ type: event.type, actorId: event.actorId, attackId: event.attackId, targetId: event.hit?.targetId, damage: event.hit?.damage })),
    };
    this.#lastDigest = deterministicStateHash(digestPayload);
    return Object.freeze({ frame: this.#frame, time, player: this.player.state, playerEvents: playerResult.events, combatEvents, chunks, nearby, digest: this.#lastDigest });
  }

  snapshot(): RuntimeIntegrationMetrics {
    const chunkMetrics = this.chunks.metrics();
    return Object.freeze({
      frame: this.#frame,
      elapsedMs: this.#elapsedMs,
      playerRevision: this.player.state.revision,
      spatialItems: this.spatial.size,
      nearbyQueries: this.#nearbyQueries,
      chunkResidentBytes: chunkMetrics.residentBytes,
      chunkActive: chunkMetrics.active,
      combatActors: [...this.combatActors()].length,
      combatTargets: [...this.combatTargets()].length,
      digest: this.#lastDigest,
    });
  }

  *combatActors(): IterableIterator<string> { yield this.player.state.id; }
  *combatTargets(): IterableIterator<string> { for (const item of this.spatial.queryBounds({ x: -Infinity, y: -Infinity }, { x: Infinity, y: Infinity })) if (item.value.team !== 'player') yield item.id; }

  reset(): void {
    this.#frame = 0;
    this.#elapsedMs = 0;
    this.#nearbyQueries = 0;
    this.#lastDigest = '';
    this.player.reset(defaultPlayerState(this.player.state.id));
    this.spatial.clear();
    this.chunks.dispose();
  }

  dispose(): void { this.chunks.dispose(); this.spatial.clear(); }
}

export const copyVec3 = (value: Vec3): Vec3 => Object.freeze({ x: value.x, y: value.y, z: value.z });
