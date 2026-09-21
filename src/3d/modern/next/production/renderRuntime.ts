import { budgetForTier, makeLODLevels, type QualityTier, type RenderCapabilities } from '../render.ts';
import { classifyDistance, normalizeRuntimeCapabilities, type EntityRuntimeState, type RenderEntityCommand, type RenderFramePlan, type RuntimeCapabilities } from './contracts.ts';
import type { Tick, Vec3 } from '../types.ts';

export interface RenderPlannerConfig {
  readonly baseDistanceMeters: number;
  readonly maxVisibleEntities: number;
  readonly targetFrameMs: number;
  readonly reducedMotion: boolean;
  readonly shadows: boolean;
  readonly lodLevels: number;
}

export interface RenderPlannerInput {
  readonly tick: Tick;
  readonly alpha: number;
  readonly camera: Vec3;
  readonly entities: readonly EntityRuntimeState[];
  readonly tier: QualityTier;
  readonly capabilities: RenderCapabilities;
}

export interface RenderPlannerStats {
  readonly totalEntities: number;
  readonly visibleEntities: number;
  readonly hiddenEntities: number;
  readonly shadowCasters: number;
  readonly lodHistogram: readonly number[];
  readonly estimatedDrawCalls: number;
}

const DEFAULT_PLANNER: RenderPlannerConfig = {
  baseDistanceMeters: 650,
  maxVisibleEntities: 5000,
  targetFrameMs: 16.6,
  reducedMotion: false,
  shadows: true,
  lodLevels: 5,
};

export class ProductionRenderPlanner {
  readonly config: RenderPlannerConfig;
  #lastPlan: RenderFramePlan | undefined;
  #stats: RenderPlannerStats = {
    totalEntities: 0,
    visibleEntities: 0,
    hiddenEntities: 0,
    shadowCasters: 0,
    lodHistogram: [0,0,0,0,0],
    estimatedDrawCalls: 0,
  };
  #forcedTier: QualityTier | undefined;
  #frame = 0;

  constructor(config: Partial<RenderPlannerConfig> = {}) {
    this.config = {
      baseDistanceMeters: Math.max(10, config.baseDistanceMeters ?? DEFAULT_PLANNER.baseDistanceMeters),
      maxVisibleEntities: Math.max(1, Math.floor(config.maxVisibleEntities ?? DEFAULT_PLANNER.maxVisibleEntities)),
      targetFrameMs: Math.max(8, config.targetFrameMs ?? DEFAULT_PLANNER.targetFrameMs),
      reducedMotion: Boolean(config.reducedMotion ?? DEFAULT_PLANNER.reducedMotion),
      shadows: Boolean(config.shadows ?? DEFAULT_PLANNER.shadows),
      lodLevels: Math.max(1, Math.min(8, Math.floor(config.lodLevels ?? DEFAULT_PLANNER.lodLevels))),
    };
  }

  setForcedTier(tier?: QualityTier): void {
    this.#forcedTier = tier;
  }

  plan(input: RenderPlannerInput): RenderFramePlan {
    this.#frame += 1;
    const tier = this.#forcedTier ?? input.tier;
    const budget = budgetForTier(tier);
    const capabilities = normalizeRuntimeCapabilities({ render: input.capabilities });
    const levels = makeLODLevels(this.config.baseDistanceMeters * budget.visibleDistance, this.config.lodLevels);
    const candidates = input.entities
      .map((entity) => this.#candidate(entity, input.camera, levels, budget.visibleDistance, capabilities))
      .filter((candidate): candidate is Candidate => candidate !== undefined)
      .sort(compareCandidates);

    const selected = candidates.slice(0, this.config.maxVisibleEntities);
    const commands = selected.map((candidate) => candidate.command);
    const plan: RenderFramePlan = {
      tick: input.tick,
      alpha: Math.max(0, Math.min(1, input.alpha)),
      tier,
      pixelRatio: Math.min(budget.pixelRatio, input.capabilities.maxTextureSize > 0 ? 3 : 1),
      visibleDistance: budget.visibleDistance,
      commands,
    };
    this.#lastPlan = plan;
    this.#updateStats(input.entities.length, selected, capabilities);
    return plan;
  }

  lastPlan(): RenderFramePlan | undefined {
    return this.#lastPlan ? {
      ...this.#lastPlan,
      commands: this.#lastPlan.commands.map((command) => ({ ...command, position: { ...command.position } })),
    } : undefined;
  }

  stats(): RenderPlannerStats {
    return {
      ...this.#stats,
      lodHistogram: [...this.#stats.lodHistogram],
    };
  }

  reset(): void {
    this.#lastPlan = undefined;
    this.#frame = 0;
    this.#stats = {
      totalEntities: 0,
      visibleEntities: 0,
      hiddenEntities: 0,
      shadowCasters: 0,
      lodHistogram: Array.from({ length: this.config.lodLevels }, () => 0),
      estimatedDrawCalls: 0,
    };
  }

  #candidate(
    entity: EntityRuntimeState,
    camera: Vec3,
    levels: ReturnType<typeof makeLODLevels>,
    visibleDistanceScale: number,
    capabilities: RuntimeCapabilities,
  ): Candidate | undefined {
    const position = entity.transform.position;
    const dx = position.x - camera.x;
    const dy = position.y - camera.y;
    const dz = position.z - camera.z;
    const distance = Math.hypot(dx, dy, dz);
    const maxDistance = this.config.baseDistanceMeters * visibleDistanceScale + entity.transform.radiusMeters;
    if (distance > maxDistance) return undefined;

    let lod = levels.length - 1;
    for (let index = 0; index < levels.length; index += 1) {
      if (distance <= levels[index]!.maxDistance) {
        lod = index;
        break;
      }
    }

    const visibility = classifyDistance(distance);
    const forcedHidden = visibility === 'hidden';
    if (forcedHidden) return undefined;

    const shadowAllowed = this.config.shadows
      && !capabilities.prefersReducedMotion
      && capabilities.render.supportsWebGL2
      && lod <= 2
      && visibility !== 'far';

    const animationRate = this.config.reducedMotion
      ? 0
      : levels[lod]!.animationRate;

    const command: RenderEntityCommand = {
      id: entity.transform.id,
      position: { ...position },
      yawRadians: entity.transform.yawRadians,
      lod,
      visible: true,
      castShadow: shadowAllowed && entity.health > 0,
      receiveShadow: shadowAllowed,
      animationRate,
    };

    return {
      command,
      distance,
      visibility,
      radius: entity.transform.radiusMeters,
    };
  }

  #updateStats(total: number, selected: readonly Candidate[], capabilities: RuntimeCapabilities): void {
    const histogram = Array.from({ length: this.config.lodLevels }, () => 0);
    let shadowCasters = 0;
    let estimatedDrawCalls = 0;
    for (const candidate of selected) {
      histogram[candidate.command.lod] = (histogram[candidate.command.lod] ?? 0) + 1;
      if (candidate.command.castShadow) shadowCasters += 1;
      estimatedDrawCalls += candidate.command.lod === 0 ? 2 : candidate.command.lod <= 2 ? 1 : 0;
    }
    const shadowPenalty = capabilities.render.supportsInstancing ? 1 : 2;
    this.#stats = {
      totalEntities: total,
      visibleEntities: selected.length,
      hiddenEntities: Math.max(0, total - selected.length),
      shadowCasters,
      lodHistogram: histogram,
      estimatedDrawCalls: estimatedDrawCalls + Math.ceil(shadowCasters / shadowPenalty),
    };
  }
}

interface Candidate {
  readonly command: RenderEntityCommand;
  readonly distance: number;
  readonly visibility: ReturnType<typeof classifyDistance>;
  readonly radius: number;
}

function compareCandidates(a: Candidate, b: Candidate): number {
  const visibilityRank = (value: ReturnType<typeof classifyDistance>): number => {
    switch (value) {
      case 'critical': return 5;
      case 'near': return 4;
      case 'mid': return 3;
      case 'far': return 2;
      case 'hidden': return 0;
    }
  };
  return visibilityRank(b.visibility) - visibilityRank(a.visibility)
    || a.distance - b.distance
    || b.radius - a.radius
    || a.command.id - b.command.id;
}

export function resolveBrowserRenderCapabilities(
  source: Partial<RuntimeCapabilities['render']> = {},
): RenderCapabilities {
  const fallback = {
    maxTextureSize: 4096,
    supportsInstancing: true,
    supportsWebGL2: true,
  };
  const normalized = {
    ...fallback,
    ...source,
  };
  return {
    maxTextureSize: Math.max(256, Math.floor(normalized.maxTextureSize)),
    supportsInstancing: Boolean(normalized.supportsInstancing),
    supportsWebGL2: Boolean(normalized.supportsWebGL2),
    ...(normalized.deviceMemoryGb === undefined ? {} : { deviceMemoryGb: normalized.deviceMemoryGb }),
    ...(normalized.hardwareConcurrency === undefined ? {} : { hardwareConcurrency: normalized.hardwareConcurrency }),
  };
}

export function deriveRenderBudget(
  tier: QualityTier,
  frameMs: number,
): { tier: QualityTier; targetFrameMs: number; oversubscribed: boolean; budget: ReturnType<typeof budgetForTier> } {
  const budget = budgetForTier(tier);
  return {
    tier,
    targetFrameMs: frameMs > 25 ? 25 : frameMs > 20 ? 20 : 16.6,
    oversubscribed: frameMs > (tier === 'safe' ? 25 : 16.6),
    budget,
  };
}

export function estimatePlanWork(plan: RenderFramePlan): number {
  let work = 0;
  for (const command of plan.commands) {
    work += command.lod === 0 ? 1 : command.lod === 1 ? 0.65 : command.lod === 2 ? 0.4 : command.lod === 3 ? 0.2 : 0.1;
    if (command.castShadow) work += 0.3;
    if (command.animationRate > 0) work += 0.08 * command.animationRate;
  }
  return Number(work.toFixed(4));
}

export function canUseAdvancedShadows(capabilities: RenderCapabilities, tier: QualityTier): boolean {
  return capabilities.supportsWebGL2
    && capabilities.supportsInstancing
    && capabilities.maxTextureSize >= 2048
    && tier !== 'low'
    && tier !== 'safe';
}
