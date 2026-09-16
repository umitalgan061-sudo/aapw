/**
 * V6 scene planning layer.
 * Converts camera/player state into stable visibility, LOD and streaming intents.
 * It never mutates a Three.js scene; rendering remains a consumer responsibility.
 */

export type LodTier = 0 | 1 | 2 | 3 | 4;
export type ScenePriority = 'critical' | 'near' | 'mid' | 'far' | 'background';
export type VisibilityReason = 'distance' | 'frustum' | 'occlusion' | 'budget' | 'disabled';

export interface Vector3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface CameraState {
  readonly position: Vector3;
  readonly forward: Vector3;
  readonly horizontalFovRadians: number;
  readonly verticalFovRadians: number;
  readonly nearDistance: number;
  readonly farDistance: number;
}

export interface SceneObjectDescriptor {
  readonly id: string;
  readonly position: Vector3;
  readonly radius: number;
  readonly importance: number;
  readonly minLod?: LodTier;
  readonly maxLod?: LodTier;
  readonly tags: readonly string[];
  readonly alwaysVisible?: boolean;
}

export interface SceneDecision {
  readonly id: string;
  readonly visible: boolean;
  readonly tier: LodTier;
  readonly priority: ScenePriority;
  readonly distanceMeters: number;
  readonly projectedPixels: number;
  readonly reason: VisibilityReason;
  readonly streamRequired: boolean;
}

export interface SceneBudget {
  readonly maxVisible: number;
  readonly maxHighDetail: number;
  readonly maxMediumDetail: number;
  readonly maxLowDetail: number;
  readonly projectedPixelBudget: number;
}

export interface ScenePlannerConfig {
  readonly budgets: SceneBudget;
  readonly lodDistances: readonly [number, number, number, number];
  readonly pixelScale: number;
  readonly hysteresisRatio: number;
}

export interface ScenePlan {
  readonly frame: number;
  readonly decisions: readonly SceneDecision[];
  readonly visibleCount: number;
  readonly streamCount: number;
  readonly budgetUsedPixels: number;
}

const DEFAULT_CONFIG: ScenePlannerConfig = {
  budgets: {
    maxVisible: 600,
    maxHighDetail: 100,
    maxMediumDetail: 180,
    maxLowDetail: 300,
    projectedPixelBudget: 2_000_000,
  },
  lodDistances: [55, 140, 350, 900],
  pixelScale: 780,
  hysteresisRatio: 0.08,
};

function finite(value: number, name: string): number {
  if (!Number.isFinite(value)) throw new RangeError(`${name} must be finite`);
  return value;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function length(v: Vector3): number {
  return Math.hypot(v.x, v.y, v.z);
}

function dot(a: Vector3, b: Vector3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function normalize(v: Vector3): Vector3 {
  const magnitude = length(v);
  if (magnitude <= 1e-8) return { x: 0, y: 0, z: -1 };
  return { x: v.x / magnitude, y: v.y / magnitude, z: v.z / magnitude };
}

function distance(a: Vector3, b: Vector3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function priorityFor(object: SceneObjectDescriptor, distanceMeters: number): ScenePriority {
  if (object.alwaysVisible || object.importance >= 0.95) return 'critical';
  if (distanceMeters < 90 || object.importance >= 0.75) return 'near';
  if (distanceMeters < 320 || object.importance >= 0.45) return 'mid';
  if (distanceMeters < 850 || object.importance >= 0.2) return 'far';
  return 'background';
}

function tierFor(distanceMeters: number, lodDistances: readonly [number, number, number, number]): LodTier {
  if (distanceMeters < lodDistances[0]) return 0;
  if (distanceMeters < lodDistances[1]) return 1;
  if (distanceMeters < lodDistances[2]) return 2;
  if (distanceMeters < lodDistances[3]) return 3;
  return 4;
}

export function projectPixels(radius: number, distanceMeters: number, pixelScale: number): number {
  const safeRadius = Math.max(0, radius);
  const safeDistance = Math.max(0.5, distanceMeters);
  return clamp((safeRadius / safeDistance) * pixelScale, 0, pixelScale * 4);
}

export function isInsideFrustum(object: SceneObjectDescriptor, camera: CameraState): boolean {
  if (object.alwaysVisible) return true;
  const offset = {
    x: object.position.x - camera.position.x,
    y: object.position.y - camera.position.y,
    z: object.position.z - camera.position.z,
  };
  const dist = length(offset);
  if (dist - object.radius > camera.farDistance) return false;
  if (dist + object.radius < camera.nearDistance) return false;
  if (dist <= object.radius) return true;
  const direction = normalize(offset);
  const forward = normalize(camera.forward);
  const cosine = clamp(dot(direction, forward), -1, 1);
  const angle = Math.acos(cosine);
  const horizontalLimit = camera.horizontalFovRadians * 0.5 + Math.asin(clamp(object.radius / Math.max(dist, 1), -0.99, 0.99));
  const verticalLimit = camera.verticalFovRadians * 0.5 + Math.asin(clamp(object.radius / Math.max(dist, 1), -0.99, 0.99));
  if (Math.abs(angle) <= Math.max(horizontalLimit, verticalLimit)) return true;
  return false;
}

export class ScenePlanner {
  readonly #config: ScenePlannerConfig;
  readonly #objects = new Map<string, SceneObjectDescriptor>();
  readonly #lastTier = new Map<string, LodTier>();
  #frame = 0;
  #lastPlan: ScenePlan = { frame: 0, decisions: [], visibleCount: 0, streamCount: 0, budgetUsedPixels: 0 };

  constructor(config: Partial<ScenePlannerConfig> = {}) {
    const budget = { ...DEFAULT_CONFIG.budgets, ...(config.budgets ?? {}) };
    const distances = config.lodDistances ?? DEFAULT_CONFIG.lodDistances;
    if (distances.length !== 4 || distances.some((value) => !Number.isFinite(value) || value <= 0)) throw new RangeError('invalid LOD distances');
    this.#config = {
      budgets: {
        maxVisible: Math.max(1, Math.floor(budget.maxVisible)),
        maxHighDetail: Math.max(0, Math.floor(budget.maxHighDetail)),
        maxMediumDetail: Math.max(0, Math.floor(budget.maxMediumDetail)),
        maxLowDetail: Math.max(0, Math.floor(budget.maxLowDetail)),
        projectedPixelBudget: Math.max(1, budget.projectedPixelBudget),
      },
      lodDistances: distances as [number, number, number, number],
      pixelScale: Math.max(1, config.pixelScale ?? DEFAULT_CONFIG.pixelScale),
      hysteresisRatio: clamp(config.hysteresisRatio ?? DEFAULT_CONFIG.hysteresisRatio, 0, 0.5),
    };
  }

  upsert(object: SceneObjectDescriptor): void {
    if (!object.id || object.id.length > 128) throw new TypeError('invalid scene object id');
    finite(object.position.x, 'position.x');
    finite(object.position.y, 'position.y');
    finite(object.position.z, 'position.z');
    if (!Number.isFinite(object.radius) || object.radius < 0) throw new RangeError('invalid object radius');
    if (!Number.isFinite(object.importance) || object.importance < 0 || object.importance > 1) throw new RangeError('importance must be in [0,1]');
    this.#objects.set(object.id, { ...object, tags: [...new Set(object.tags)] });
  }

  remove(id: string): boolean {
    this.#lastTier.delete(id);
    return this.#objects.delete(id);
  }

  clear(): void {
    this.#objects.clear();
    this.#lastTier.clear();
  }

  plan(camera: CameraState, frame = this.#frame + 1): ScenePlan {
    this.#frame = Math.max(this.#frame, Math.floor(frame));
    const candidates = [...this.#objects.values()]
      .map((object) => {
        const distanceMeters = distance(object.position, camera.position);
        const inFrustum = isInsideFrustum(object, camera);
        const projectedPixels = projectPixels(object.radius, distanceMeters, this.#config.pixelScale);
        const baselineTier = tierFor(distanceMeters, this.#config.lodDistances);
        const previous = this.#lastTier.get(object.id);
        const tier = this.#applyHysteresis(object, baselineTier, previous, distanceMeters);
        const priority = priorityFor(object, distanceMeters);
        return { object, distanceMeters, projectedPixels, inFrustum, tier, priority };
      })
      .filter((candidate) => candidate.inFrustum)
      .sort((a, b) => {
        const scoreA = a.object.importance * 10_000 + a.projectedPixels - a.distanceMeters;
        const scoreB = b.object.importance * 10_000 + b.projectedPixels - b.distanceMeters;
        return scoreB - scoreA || a.object.id.localeCompare(b.object.id);
      });

    let visibleCount = 0;
    let high = 0;
    let medium = 0;
    let low = 0;
    let budgetUsedPixels = 0;
    let streamCount = 0;
    const decisions: SceneDecision[] = [];
    for (const candidate of candidates) {
      const { object, distanceMeters, projectedPixels, tier, priority } = candidate;
      const withinCount = visibleCount < this.#config.budgets.maxVisible;
      const highAllowed = tier === 0 && high < this.#config.budgets.maxHighDetail;
      const mediumAllowed = tier <= 1 && medium < this.#config.budgets.maxMediumDetail;
      const lowAllowed = tier <= 2 && low < this.#config.budgets.maxLowDetail;
      const pixelAllowed = budgetUsedPixels + projectedPixels <= this.#config.budgets.projectedPixelBudget;
      let visible = withinCount && pixelAllowed;
      let reason: VisibilityReason = visible ? 'distance' : 'budget';
      let finalTier = tier;
      if (visible && tier === 0 && !highAllowed) finalTier = 1;
      if (visible && finalTier <= 1 && !mediumAllowed && tier !== 0) finalTier = 2;
      if (visible && finalTier <= 2 && !lowAllowed && tier >= 2) finalTier = 3;
      if (object.alwaysVisible) {
        visible = true;
        reason = 'distance';
        finalTier = Math.min(finalTier, object.minLod ?? 0) as LodTier;
      }
      if (!visible && priority === 'critical') {
        visible = true;
        reason = 'budget';
      }
      if (visible) {
        visibleCount += 1;
        budgetUsedPixels += projectedPixels;
        if (finalTier === 0) high += 1;
        else if (finalTier <= 1) medium += 1;
        else if (finalTier <= 2) low += 1;
      }
      const streamRequired = visible && finalTier <= 3 && (object.tags.includes('streamable') || projectedPixels > 1);
      if (streamRequired) streamCount += 1;
      this.#lastTier.set(object.id, finalTier);
      if (!visible && distanceMeters > camera.farDistance) reason = 'distance';
      decisions.push({
        id: object.id,
        visible,
        tier: finalTier,
        priority,
        distanceMeters,
        projectedPixels,
        reason,
        streamRequired,
      });
    }
    decisions.sort((a, b) => a.id.localeCompare(b.id));
    this.#lastPlan = { frame: this.#frame, decisions, visibleCount, streamCount, budgetUsedPixels };
    return this.#lastPlan;
  }

  lastPlan(): ScenePlan {
    return this.#lastPlan;
  }

  objects(): readonly SceneObjectDescriptor[] {
    return [...this.#objects.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  #applyHysteresis(object: SceneObjectDescriptor, baseline: LodTier, previous: LodTier | undefined, distanceMeters: number): LodTier {
    let tier = baseline;
    if (previous === undefined) return this.#clampObjectTier(object, tier);
    const margin = distanceMeters * this.#config.hysteresisRatio;
    if (baseline > previous) {
      const boundary = this.#config.lodDistances[Math.min(previous, 3)]!;
      if (distanceMeters < boundary + margin) tier = previous;
    } else if (baseline < previous) {
      const boundary = this.#config.lodDistances[Math.min(baseline, 3)]!;
      if (distanceMeters > boundary - margin) tier = previous;
    }
    return this.#clampObjectTier(object, tier);
  }

  #clampObjectTier(object: SceneObjectDescriptor, tier: LodTier): LodTier {
    const min = object.minLod ?? 0;
    const max = object.maxLod ?? 4;
    return clamp(tier, min, max) as LodTier;
  }
}

export interface SceneCell {
  readonly x: number;
  readonly z: number;
  readonly size: number;
}

export function cellKey(x: number, z: number): string {
  return `${Math.floor(x)}:${Math.floor(z)}`;
}

export function objectCell(position: Vector3, size: number): SceneCell {
  if (!(size > 0)) throw new RangeError('cell size must be > 0');
  return { x: Math.floor(position.x / size), z: Math.floor(position.z / size), size };
}

export function cellsInRadius(center: Vector3, radius: number, size: number): string[] {
  const cell = objectCell(center, size);
  const span = Math.ceil(Math.max(0, radius) / size);
  const keys: string[] = [];
  for (let z = cell.z - span; z <= cell.z + span; z += 1) {
    for (let x = cell.x - span; x <= cell.x + span; x += 1) keys.push(cellKey(x, z));
  }
  return keys.sort();
}
