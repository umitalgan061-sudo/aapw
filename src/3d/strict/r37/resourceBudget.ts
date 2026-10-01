import type { QualityTier, RuntimeBudget } from './types.ts';
import { clamp, finite } from './math.ts';

export type BudgetClass = 'critical' | 'interactive' | 'background' | 'deferred';

export interface BudgetRequest {
  readonly id: string;
  readonly class: BudgetClass;
  readonly cost: number;
  readonly priority: number;
  readonly deadlineTick?: number;
}

export interface BudgetGrant {
  readonly id: string;
  readonly class: BudgetClass;
  readonly granted: boolean;
  readonly cost: number;
  readonly reason: string;
}

export interface ResourceBudgetConfig {
  readonly maxUnits: number;
  readonly reserveCritical: number;
  readonly historyCapacity: number;
}

const DEFAULT_CONFIG: ResourceBudgetConfig = Object.freeze({
  maxUnits: 100,
  reserveCritical: 25,
  historyCapacity: 256,
});

const CLASS_WEIGHT: Record<BudgetClass, number> = {
  critical: 4,
  interactive: 3,
  background: 2,
  deferred: 1,
};

export class ResourceBudgetR37 {
  readonly config: ResourceBudgetConfig;
  #used = 0;
  #grants: BudgetGrant[] = [];
  #tick = 0;

  constructor(config: Partial<ResourceBudgetConfig> = {}) {
    this.config = Object.freeze({
      ...DEFAULT_CONFIG,
      ...config,
      maxUnits: Math.max(1, finite(config.maxUnits, DEFAULT_CONFIG.maxUnits)),
      reserveCritical: clamp(finite(config.reserveCritical, DEFAULT_CONFIG.reserveCritical), 0, 100),
      historyCapacity: Math.max(16, Math.trunc(finite(config.historyCapacity, DEFAULT_CONFIG.historyCapacity))),
    });
  }

  beginTick(tick: number): void {
    this.#tick = Math.max(0, Math.trunc(finite(tick)));
    this.#used = 0;
    this.#grants = [];
  }

  request(request: BudgetRequest): BudgetGrant {
    const cost = clamp(finite(request.cost), 0, this.config.maxUnits);
    const priority = clamp(finite(request.priority), -100, 100);
    const remaining = this.config.maxUnits - this.#used;
    const reserve = request.class === 'critical' ? 0 : this.config.reserveCritical;
    const emergency = remaining - reserve;
    const granted = request.class === 'critical' ? remaining >= cost : emergency >= cost;
    const reason = granted
      ? 'budget-granted'
      : request.class === 'critical'
        ? 'insufficient-capacity'
        : priority >= 50
          ? 'reserve-protection'
          : 'lower-priority-deferred';
    if (granted) this.#used += cost;
    const result = Object.freeze({
      id: String(request.id).slice(0, 96),
      class: request.class,
      granted,
      cost: granted ? cost : 0,
      reason,
    });
    this.#grants.push(result);
    if (this.#grants.length > this.config.historyCapacity) this.#grants.shift();
    return result;
  }

  batch(requests: readonly BudgetRequest[]): readonly BudgetGrant[] {
    return Object.freeze(
      [...requests]
        .sort((a, b) => CLASS_WEIGHT[b.class] - CLASS_WEIGHT[a.class] || b.priority - a.priority || a.id.localeCompare(b.id))
        .map((request) => this.request(request)),
    );
  }

  used(): number { return this.#used; }
  remaining(): number { return Math.max(0, this.config.maxUnits - this.#used); }
  tick(): number { return this.#tick; }
  grants(): readonly BudgetGrant[] { return Object.freeze([...this.#grants]); }

  snapshot(): Readonly<{ tick: number; used: number; remaining: number; grants: readonly BudgetGrant[] }> {
    return Object.freeze({
      tick: this.#tick,
      used: this.#used,
      remaining: this.remaining(),
      grants: this.grants(),
    });
  }
}

export function budgetForQuality(quality: QualityTier): RuntimeBudget {
  const scale = quality === 'ultra' ? 1.25 : quality === 'high' ? 1.1 : quality === 'balanced' ? 1 : quality === 'low' ? 0.88 : 0.7;
  return Object.freeze({
    frameMs: 16.67,
    simulationMs: 5 * scale,
    renderMs: 8 * scale,
    networkMs: 2.5 * scale,
    assetMs: 3 * scale,
    maxEntities: Math.max(256, Math.round(2000 * scale)),
    maxCommandsPerTick: Math.max(16, Math.round(72 * scale)),
  });
}
