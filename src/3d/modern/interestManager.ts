export type InterestTier = 0 | 1 | 2 | 3 | 4;
export type InterestReason = 'player' | 'combat' | 'camera' | 'quest' | 'audio' | 'nearby' | 'background';

export interface InterestSource { readonly id: string; readonly x: number; readonly z: number; readonly radius: number; readonly weight: number; readonly reason: InterestReason; }
export interface InterestEntity { readonly id: string; readonly x: number; readonly z: number; readonly importance: number; readonly baseTier?: InterestTier; }
export interface InterestScore { readonly id: string; readonly tier: InterestTier; readonly score: number; readonly nearestReason: InterestReason; readonly distance: number; readonly active: boolean; }
export interface InterestFrame { readonly frame: number; readonly active: readonly string[]; readonly tiers: Readonly<Record<InterestTier, readonly string[]>>; readonly scores: readonly InterestScore[]; }

const clamp = (value: number, min = 0, max = 1): number => Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
const distance = (a: { x: number; z: number }, b: { x: number; z: number }): number => Math.hypot(a.x - b.x, a.z - b.z);

export interface InterestPolicy {
  readonly tierRadii: Readonly<Record<InterestTier, number>>;
  readonly tierBudgets: Readonly<Record<InterestTier, number>>;
  readonly activeBudget: number;
}

export const defaultInterestPolicy: InterestPolicy = Object.freeze({
  tierRadii: Object.freeze({ 0: 18, 1: 45, 2: 120, 3: 300, 4: 1000 }),
  tierBudgets: Object.freeze({ 0: 256, 1: 768, 2: 2500, 3: 7500, 4: 20_000 }),
  activeBudget: 12_000,
});

export class InterestManager {
  readonly #policy: InterestPolicy;
  readonly #sources = new Map<string, InterestSource>();
  readonly #entities = new Map<string, InterestEntity>();
  #frame = 0;
  #last: InterestFrame = Object.freeze({ frame: 0, active: [], tiers: Object.freeze({ 0: [], 1: [], 2: [], 3: [], 4: [] }), scores: [] });

  constructor(policy: InterestPolicy = defaultInterestPolicy) { this.#policy = policy; }
  addSource(source: InterestSource): void { this.#sources.set(source.id, Object.freeze({ ...source, radius: Math.max(0, source.radius), weight: Math.max(0, source.weight) })); }
  removeSource(id: string): void { this.#sources.delete(id); }
  addEntity(entity: InterestEntity): void { this.#entities.set(entity.id, Object.freeze({ ...entity, importance: clamp(entity.importance), baseTier: entity.baseTier })); }
  removeEntity(id: string): void { this.#entities.delete(id); }

  evaluate(): InterestFrame {
    this.#frame += 1;
    const scores: InterestScore[] = [];
    for (const entity of this.#entities.values()) {
      let bestScore = 0;
      let bestDistance = Number.POSITIVE_INFINITY;
      let nearestReason: InterestReason = 'background';
      for (const source of this.#sources.values()) {
        const d = distance(entity, source);
        if (d > source.radius) continue;
        const falloff = 1 - d / Math.max(0.001, source.radius);
        const score = clamp(falloff * source.weight + entity.importance * 0.25);
        if (score > bestScore || (score === bestScore && d < bestDistance)) { bestScore = score; bestDistance = d; nearestReason = source.reason; }
      }
      let tier = entity.baseTier ?? this.#tierFromDistance(bestDistance);
      if (bestScore > 0.82) tier = Math.min(tier, 0) as InterestTier;
      else if (bestScore > 0.58) tier = Math.min(tier, 1) as InterestTier;
      const active = tier <= 2 && bestScore > 0.08;
      scores.push(Object.freeze({ id: entity.id, tier, score: Number(bestScore.toFixed(5)), nearestReason, distance: Number(bestDistance.toFixed(3)), active }));
    }
    scores.sort((a, b) => a.tier - b.tier || b.score - a.score || a.id.localeCompare(b.id));
    const tiers: Record<InterestTier, string[]> = { 0: [], 1: [], 2: [], 3: [], 4: [] };
    for (const score of scores) {
      const bucket = tiers[score.tier];
      if (bucket && bucket.length < this.#policy.tierBudgets[score.tier]) bucket.push(score.id);
    }
    const active = scores.filter((score) => score.active).slice(0, this.#policy.activeBudget).map((score) => score.id);
    this.#last = Object.freeze({ frame: this.#frame, active, tiers: Object.freeze({ 0: tiers[0], 1: tiers[1], 2: tiers[2], 3: tiers[3], 4: tiers[4] }), scores: Object.freeze(scores) });
    return this.#last;
  }

  last(): InterestFrame { return this.#last; }
  tierOf(id: string): InterestTier { return this.#last.scores.find((score) => score.id === id)?.tier ?? 4; }
  isActive(id: string): boolean { return this.#last.active.includes(id); }

  #tierFromDistance(distanceValue: number): InterestTier {
    if (!Number.isFinite(distanceValue)) return 4;
    if (distanceValue <= this.#policy.tierRadii[0]) return 0;
    if (distanceValue <= this.#policy.tierRadii[1]) return 1;
    if (distanceValue <= this.#policy.tierRadii[2]) return 2;
    if (distanceValue <= this.#policy.tierRadii[3]) return 3;
    return 4;
  }
}
