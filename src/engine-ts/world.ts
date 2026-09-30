import type { FrameContext, EntityId, Tick, Vec3, Result } from './coreTypes.ts';
import { ENTITY_ID, TICK, clamp, err, ok, stableSort } from './coreTypes.ts';
import type { EngineEventMap, TypedEventBus } from './runtimeContracts.ts';

export type WorldPhase = 'dawn' | 'day' | 'dusk' | 'night';
export type WeatherType = 'clear' | 'cloudy' | 'rain' | 'snow' | 'storm' | 'fog';

export interface WorldTime {
  readonly day: number;
  readonly minuteOfDay: number;
  readonly phase: WorldPhase;
  readonly normalizedDay: number;
}

export interface WeatherState {
  readonly type: WeatherType;
  readonly intensity: number;
  readonly humidity: number;
  readonly windSpeed: number;
  readonly visibility: number;
  readonly transition: number;
}

export interface SpawnPoint {
  readonly id: string;
  readonly position: Vec3;
  readonly radius: number;
  readonly habitat: string;
  readonly tags: readonly string[];
  readonly maxPopulation: number;
}

export interface WorldEntity {
  readonly id: EntityId;
  readonly kind: string;
  readonly position: Vec3;
  readonly active: boolean;
  readonly lod: number;
  readonly spawnedAtTick: Tick;
}

export interface WorldSnapshot {
  readonly seed: string;
  readonly time: WorldTime;
  readonly weather: WeatherState;
  readonly entities: readonly WorldEntity[];
  readonly revision: number;
}

export interface WorldSeed {
  readonly value: string;
  readonly hash: number;
}

export const hashSeed = (seed: string): number => {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) hash = Math.imul(hash ^ seed.charCodeAt(index), 16777619) >>> 0;
  return hash >>> 0;
};

export const createWorldSeed = (seed: string | number): WorldSeed => {
  const value = String(seed);
  return Object.freeze({ value, hash: hashSeed(value) });
};

class XorShift32 {
  private state: number;
  constructor(seed: number) { this.state = seed >>> 0 || 0x9e3779b9; }
  nextUint(): number {
    let x = this.state;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.state = x >>> 0;
    return this.state;
  }
  next01(): number { return this.nextUint() / 0x1_0000_0000; }
  range(min: number, max: number): number { return min + (max - min) * this.next01(); }
  pick<T>(values: readonly T[]): T | undefined { return values[this.nextUint() % Math.max(1, values.length)]; }
}

export const worldTimeFromMinutes = (absoluteMinutes: number): WorldTime => {
  const minutes = Math.max(0, absoluteMinutes);
  const day = Math.floor(minutes / 1440);
  const minuteOfDay = minutes - day * 1440;
  const normalizedDay = minuteOfDay / 1440;
  const phase: WorldPhase = minuteOfDay < 300 ? 'night' : minuteOfDay < 420 ? 'dawn' : minuteOfDay < 1140 ? 'day' : minuteOfDay < 1320 ? 'dusk' : 'night';
  return Object.freeze({ day, minuteOfDay, normalizedDay, phase });
};

export const weatherTransition = (from: WeatherState, to: WeatherState, alpha: number): WeatherState => {
  const t = clamp(alpha, 0, 1);
  return Object.freeze({
    type: t < 0.5 ? from.type : to.type,
    intensity: from.intensity + (to.intensity - from.intensity) * t,
    humidity: from.humidity + (to.humidity - from.humidity) * t,
    windSpeed: from.windSpeed + (to.windSpeed - from.windSpeed) * t,
    visibility: from.visibility + (to.visibility - from.visibility) * t,
    transition: t,
  });
};

export interface FaunaProfile {
  readonly kind: string;
  readonly habitat: string;
  readonly minGroup: number;
  readonly maxGroup: number;
  readonly activity: number;
  readonly danger: number;
  readonly spawnWeight: number;
}

export const DEFAULT_FAUNA_PROFILES: readonly FaunaProfile[] = Object.freeze([
  { kind: 'wolf', habitat: 'forest', minGroup: 2, maxGroup: 5, activity: 0.8, danger: 0.75, spawnWeight: 0.7 },
  { kind: 'stag', habitat: 'forest', minGroup: 2, maxGroup: 8, activity: 0.75, danger: 0.2, spawnWeight: 0.9 },
  { kind: 'boar', habitat: 'forest', minGroup: 1, maxGroup: 4, activity: 0.65, danger: 0.35, spawnWeight: 0.8 },
  { kind: 'bear', habitat: 'mountain', minGroup: 1, maxGroup: 1, activity: 0.45, danger: 0.9, spawnWeight: 0.3 },
  { kind: 'eagle', habitat: 'mountain', minGroup: 1, maxGroup: 2, activity: 0.9, danger: 0.1, spawnWeight: 0.5 },
  { kind: 'raven', habitat: 'mountain', minGroup: 2, maxGroup: 6, activity: 0.9, danger: 0.08, spawnWeight: 0.7 },
  { kind: 'rabbit', habitat: 'meadow', minGroup: 2, maxGroup: 10, activity: 0.95, danger: 0.03, spawnWeight: 1 },
  { kind: 'fox', habitat: 'meadow', minGroup: 1, maxGroup: 3, activity: 0.85, danger: 0.18, spawnWeight: 0.6 },
]);

export interface FaunaSpawnDecision {
  readonly spawnId: string;
  readonly profile: string;
  readonly position: Vec3;
  readonly groupSize: number;
  readonly priority: number;
}

export class DeterministicFaunaSpawner {
  private readonly seed: WorldSeed;
  private readonly profiles: readonly FaunaProfile[];
  constructor(seed: WorldSeed, profiles = DEFAULT_FAUNA_PROFILES) { this.seed = seed; this.profiles = stableSort(profiles, (a, b) => a.kind.localeCompare(b.kind)); }

  plan(points: readonly SpawnPoint[], time: WorldTime, weather: WeatherState, populationByHabitat: ReadonlyMap<string, number>): readonly FaunaSpawnDecision[] {
    const decisions: FaunaSpawnDecision[] = [];
    for (const point of stableSort(points, (a, b) => a.id.localeCompare(b.id))) {
      const rng = new XorShift32(this.seed.hash ^ hashSeed(point.id) ^ Math.imul(time.day + 1, 0x45d9f3b));
      const population = populationByHabitat.get(point.habitat) ?? 0;
      if (population >= point.maxPopulation) continue;
      const profilePool = this.profiles.filter(profile => profile.habitat === point.habitat);
      const profile = rng.pick(profilePool);
      if (!profile) continue;
      const phaseMultiplier = time.phase === 'night' ? (profile.kind === 'wolf' || profile.kind === 'fox' ? 1.15 : 0.55) : time.phase === 'day' ? 1 : 0.82;
      const weatherMultiplier = weather.type === 'storm' ? 0.35 : weather.type === 'fog' ? 0.75 : weather.type === 'rain' || weather.type === 'snow' ? 0.8 : 1;
      const chance = clamp(profile.spawnWeight * profile.activity * phaseMultiplier * weatherMultiplier, 0, 1);
      if (rng.next01() > chance) continue;
      const angle = rng.range(0, Math.PI * 2);
      const radius = Math.sqrt(rng.next01()) * Math.max(1, point.radius);
      const groupSize = Math.min(point.maxPopulation - population, Math.max(profile.minGroup, Math.min(profile.maxGroup, Math.trunc(profile.minGroup + rng.next01() * (profile.maxGroup - profile.minGroup + 1)))));
      const priority = chance * (1 + profile.danger) * (1 + point.tags.length * 0.05);
      decisions.push(Object.freeze({
        spawnId: `${point.id}:${time.day}:${Math.trunc(time.minuteOfDay / 30)}:${profile.kind}`,
        profile: profile.kind,
        position: { x: point.position.x + Math.cos(angle) * radius, y: point.position.y, z: point.position.z + Math.sin(angle) * radius },
        groupSize,
        priority,
      }));
    }
    return stableSort(decisions, (a, b) => b.priority - a.priority || a.spawnId.localeCompare(b.spawnId));
  }
}

export class WorldState implements WorldSnapshot {
  private readonly seedValue: WorldSeed;
  private timeValue: WorldTime = worldTimeFromMinutes(480);
  private weatherValue: WeatherState = Object.freeze({ type: 'clear', intensity: 0, humidity: 0.45, windSpeed: 3, visibility: 1, transition: 0 });
  private readonly entitiesValue = new Map<EntityId, WorldEntity>();
  private revisionValue = 0;

  constructor(seed: string | number, private readonly events?: TypedEventBus) { this.seedValue = createWorldSeed(seed); }

  get seed(): string { return this.seedValue.value; }
  get time(): WorldTime { return this.timeValue; }
  get weather(): WeatherState { return this.weatherValue; }
  get entities(): readonly WorldEntity[] { return stableSort([...this.entitiesValue.values()], (a, b) => String(a.id).localeCompare(String(b.id))); }
  get revision(): number { return this.revisionValue; }

  advance(deltaSeconds: number): void {
    const minutes = Math.max(0, deltaSeconds) / 60;
    const oldPhase = this.timeValue.phase;
    this.timeValue = worldTimeFromMinutes(this.timeValue.day * 1440 + this.timeValue.minuteOfDay + minutes);
    this.revisionValue += 1;
    if (oldPhase !== this.timeValue.phase) this.events?.emit('world/phase-changed', { from: oldPhase, to: this.timeValue.phase, tick: TICK(this.revisionValue) });
  }

  setWeather(next: WeatherState): void { this.weatherValue = Object.freeze({ ...next, intensity: clamp(next.intensity, 0, 1), humidity: clamp(next.humidity, 0, 1), visibility: clamp(next.visibility, 0, 1) }); this.revisionValue += 1; }

  spawn(kind: string, position: Vec3, lod = 0, tick = TICK(this.revisionValue)): EntityId {
    const id = ENTITY_ID(`${kind}:${this.entitiesValue.size.toString(36)}:${this.seedValue.hash.toString(36)}`);
    const entity: WorldEntity = Object.freeze({ id, kind, position: Object.freeze({ ...position }), active: true, lod: Math.max(0, Math.trunc(lod)), spawnedAtTick: tick });
    this.entitiesValue.set(id, entity);
    this.revisionValue += 1;
    this.events?.emit('entity/spawned', { entity: id });
    return id;
  }

  despawn(entity: EntityId): boolean {
    const removed = this.entitiesValue.delete(entity);
    if (removed) { this.revisionValue += 1; this.events?.emit('entity/despawned', { entity }); }
    return removed;
  }

  setLod(entity: EntityId, lod: number): boolean {
    const existing = this.entitiesValue.get(entity);
    if (!existing) return false;
    this.entitiesValue.set(entity, Object.freeze({ ...existing, lod: Math.max(0, Math.trunc(lod)) }));
    return true;
  }

  snapshot(): WorldSnapshot {
    return Object.freeze({ seed: this.seed, time: this.time, weather: this.weather, entities: this.entities, revision: this.revision });
  }

  restore(snapshot: unknown): Result<void, string> {
    if (!snapshot || typeof snapshot !== 'object') return err('world snapshot must be an object');
    const value = snapshot as Record<string, unknown>;
    if (value.seed !== this.seed) return err('world seed mismatch');
    if (!value.time || typeof value.time !== 'object' || !value.weather || typeof value.weather !== 'object' || !Array.isArray(value.entities)) return err('world snapshot schema invalid');
    this.timeValue = value.time as WorldTime;
    this.weatherValue = value.weather as WeatherState;
    this.entitiesValue.clear();
    for (const raw of value.entities) {
      if (!raw || typeof raw !== 'object') continue;
      const entity = raw as WorldEntity;
      if (entity.id && entity.kind && entity.position) this.entitiesValue.set(entity.id, Object.freeze({ ...entity }));
    }
    this.revisionValue = Number.isFinite(value.revision) ? Math.max(0, Math.trunc(Number(value.revision))) : 0;
    return ok(undefined);
  }
}

export interface WorldSystem {
  readonly id: string;
  readonly order: number;
  update(world: WorldState, context: FrameContext): void;
}

export class WorldSystemPipeline {
  private readonly systems: WorldSystem[] = [];
  add(system: WorldSystem): void {
    if (this.systems.some(item => item.id === system.id)) throw new Error(`world system collision: ${system.id}`);
    this.systems.push(system);
    this.systems.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  }
  remove(id: string): boolean {
    const index = this.systems.findIndex(system => system.id === id);
    if (index < 0) return false;
    this.systems.splice(index, 1);
    return true;
  }
  update(world: WorldState, context: FrameContext): void { for (const system of this.systems) system.update(world, context); }
  get size(): number { return this.systems.length; }
}

export const createWeather = (type: WeatherType, intensity: number, windSpeed = 2): WeatherState => Object.freeze({
  type,
  intensity: clamp(intensity, 0, 1),
  humidity: clamp(0.35 + intensity * 0.55, 0, 1),
  windSpeed: Math.max(0, windSpeed),
  visibility: clamp(1 - intensity * (type === 'fog' ? 0.75 : type === 'storm' ? 0.35 : 0.2), 0.1, 1),
  transition: 1,
});
