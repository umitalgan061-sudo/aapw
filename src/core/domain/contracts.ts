export type Brand<T, B extends string> = T & { readonly __brand: B };

export type KingdomId = Brand<string, 'KingdomId'>;
export type PlayerId = Brand<string, 'PlayerId'>;
export type EntityId = Brand<string, 'EntityId'>;
export type AssetId = Brand<string, 'AssetId'>;
export type Revision = Brand<number, 'Revision'>;
export type UnixMs = Brand<number, 'UnixMs'>;

export const kingdomId = (value: string): KingdomId => value.trim() as KingdomId;
export const playerId = (value: string): PlayerId => value.trim() as PlayerId;
export const entityId = (value: string): EntityId => value.trim() as EntityId;
export const assetId = (value: string): AssetId => value.trim() as AssetId;
export const revision = (value: number): Revision => Math.max(0, Math.floor(value)) as Revision;
export const unixMs = (value: number): UnixMs => Math.max(0, Math.floor(value)) as UnixMs;

export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface Bounds2D {
  readonly min: Vec2;
  readonly max: Vec2;
}

export interface Bounds3D {
  readonly min: Vec3;
  readonly max: Vec3;
}

export interface NumericRange {
  readonly min: number;
  readonly max: number;
}

export interface KingdomStats {
  readonly army: number;
  readonly gold: number;
  readonly morale: number;
  readonly navy: number;
  readonly technology: number;
  readonly population: number;
  readonly supply: number;
  readonly stability: number;
}

export interface KingdomState {
  readonly id: KingdomId;
  readonly name: string;
  readonly owner: PlayerId | null;
  readonly position: Vec2;
  readonly stats: KingdomStats;
  readonly neighbors: readonly KingdomId[];
  readonly revision: Revision;
  readonly updatedAt: UnixMs;
}

export interface SeasonState {
  readonly year: number;
  readonly turn: number;
  readonly phase: 'spring' | 'summer' | 'autumn' | 'winter';
  readonly day: number;
  readonly progress: number;
}

export interface WorldState {
  readonly schema: 2;
  readonly worldId: string;
  readonly season: SeasonState;
  readonly kingdoms: ReadonlyMap<KingdomId, KingdomState>;
  readonly selectedKingdom: KingdomId | null;
  readonly revision: Revision;
}

export interface InputSnapshot {
  readonly sequence: number;
  readonly device: 'keyboard' | 'mouse' | 'gamepad' | 'touch' | 'unknown';
  readonly actions: Readonly<Record<string, boolean>>;
  readonly axes: Readonly<Record<string, number>>;
  readonly pointer: Vec2 | null;
}

export interface FrameContext {
  readonly frame: number;
  readonly dt: number;
  readonly elapsed: number;
  readonly input: InputSnapshot;
  readonly worldRevision: Revision;
}

export interface RuntimeHealth {
  readonly fps: number;
  readonly frameTimeMs: number;
  readonly heapUsedMb: number | null;
  readonly cpuPressure: number;
  readonly gpuPressure: number;
  readonly degraded: boolean;
  readonly degradationLevel: 0 | 1 | 2 | 3 | 4;
}

export interface RuntimeSnapshot {
  readonly runtimeRevision: Revision;
  readonly frame: number;
  readonly worldRevision: Revision;
  readonly health: RuntimeHealth;
  readonly activeFeatures: readonly string[];
  readonly warnings: readonly string[];
}

export interface AudioIntent {
  readonly id: string;
  readonly category: 'ui' | 'ambience' | 'combat' | 'voice' | 'music' | 'environment';
  readonly gain: number;
  readonly priority: number;
  readonly position: Vec3 | null;
  readonly loop: boolean;
}

export interface RenderIntent {
  readonly camera: {
    readonly position: Vec3;
    readonly target: Vec3;
    readonly fov: number;
  };
  readonly quality: {
    readonly resolutionScale: number;
    readonly shadows: boolean;
    readonly postFx: boolean;
    readonly foliageDensity: number;
  };
}

export interface PersistenceEnvelope<T> {
  readonly schema: number;
  readonly savedAt: UnixMs;
  readonly checksum: string;
  readonly payload: T;
}

export interface Result<T, E = RuntimeError> {
  readonly ok: boolean;
  readonly value?: T;
  readonly error?: E;
}

export interface RuntimeError {
  readonly code: string;
  readonly message: string;
  readonly detail?: Readonly<Record<string, unknown>>;
}

export const ok = <T>(value: T): Result<T> => Object.freeze({ ok: true, value });
export const err = <E extends RuntimeError>(error: E): Result<never, E> => Object.freeze({ ok: false, error });

export const freeze = <T>(value: T): T => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) {
    if (child && typeof child === 'object') freeze(child);
  }
  return value;
};

export const clamp = (value: number, min: number, max: number): number => {
  if (!Number.isFinite(value)) return min;
  if (min > max) return min;
  return Math.min(max, Math.max(min, value));
};

export const finite = (value: unknown, fallback = 0): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

export const normalizeRange = (range: NumericRange): NumericRange => {
  const min = finite(range.min);
  const max = finite(range.max, min);
  return freeze({ min: Math.min(min, max), max: Math.max(min, max) });
};

export const normalizeVec2 = (value?: Partial<Vec2> | null): Vec2 =>
  freeze({ x: finite(value?.x), y: finite(value?.y) });

export const normalizeVec3 = (value?: Partial<Vec3> | null): Vec3 =>
  freeze({ x: finite(value?.x), y: finite(value?.y), z: finite(value?.z) });

export const distance2 = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
export const distance3 = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

export const lerp = (a: number, b: number, alpha: number): number => a + (b - a) * clamp(alpha, 0, 1);
export const smoothstep = (edge0: number, edge1: number, value: number): number => {
  const t = clamp((value - edge0) / Math.max(1e-9, edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
};

export const vectorLerp = (a: Vec3, b: Vec3, alpha: number): Vec3 => freeze({
  x: lerp(a.x, b.x, alpha),
  y: lerp(a.y, b.y, alpha),
  z: lerp(a.z, b.z, alpha),
});

export const makeRevision = (current: Revision, next = Number(current) + 1): Revision => revision(next);

export const validateStats = (stats: Partial<KingdomStats>): KingdomStats => freeze({
  army: clamp(finite(stats.army), 0, 10_000_000),
  gold: clamp(finite(stats.gold), 0, 10_000_000_000),
  morale: clamp(finite(stats.morale, 50), 0, 100),
  navy: clamp(finite(stats.navy), 0, 1_000_000),
  technology: clamp(finite(stats.technology), 0, 100),
  population: clamp(finite(stats.population), 0, 1_000_000_000),
  supply: clamp(finite(stats.supply, 100), 0, 100),
  stability: clamp(finite(stats.stability, 100), 0, 100),
});

export const makeDefaultSeason = (): SeasonState => freeze({
  year: 1,
  turn: 1,
  phase: 'spring',
  day: 1,
  progress: 0,
});

export const advanceSeason = (season: SeasonState, days = 1): SeasonState => {
  const safeDays = Math.max(0, Math.floor(days));
  let day = season.day + safeDays;
  let turn = season.turn;
  let year = season.year;
  let phase: SeasonState['phase'] = season.phase;
  const phases: SeasonState['phase'][] = ['spring', 'summer', 'autumn', 'winter'];
  const phaseIndex = (): number => phases.indexOf(phase);
  while (day > 30) {
    day -= 30;
    turn += 1;
    if (turn % 4 === 1) {
      year += 1;
      phase = 'spring';
    } else {
      phase = phases[(phaseIndex() + 1) % phases.length];
    }
  }
  return freeze({ year, turn, phase, day, progress: clamp(day / 30, 0, 1) });
};

export const stableKey = (...parts: readonly unknown[]): string => parts
  .map((part) => typeof part === 'string' ? part : JSON.stringify(part))
  .join('|');
