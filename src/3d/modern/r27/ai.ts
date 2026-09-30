import {
  type EntityId,
  type RuntimeTick,
  type Vec3,
  entityId,
} from './contracts.ts';
import { distanceSquared, normalize, sub } from './physics.ts';

export interface PerceptionTarget {
  readonly entity: EntityId;
  readonly position: Vec3;
  readonly kind: 'player' | 'npc' | 'animal' | 'hazard' | 'item';
  readonly threat: number;
  readonly visibility: number;
  readonly lastSeenTick: number;
}

export interface PerceptionMemory {
  readonly entity: EntityId;
  readonly kind: PerceptionTarget['kind'];
  readonly lastPosition: Vec3;
  readonly strength: number;
  readonly expiresAtTick: number;
  readonly threat: number;
}

export interface AiAction {
  readonly id: string;
  readonly utility: number;
  readonly cooldownTicks: number;
  readonly cost: number;
  readonly execute: (entity: EntityId, tick: RuntimeTick, target?: EntityId) => void;
}

export interface AiDecision {
  readonly entity: EntityId;
  readonly action: string;
  readonly utility: number;
  readonly target?: EntityId;
}

interface AgentState {
  readonly entity: EntityId;
  readonly position: Vec3;
  readonly memory: Map<EntityId, PerceptionMemory>;
  readonly cooldowns: Map<string, number>;
  readonly actions: readonly AiAction[];
  readonly personality: Readonly<Record<string, number>>;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export interface AiConfig {
  readonly maxAgentsPerTick: number;
  readonly memoryTicks: number;
  readonly perceptionRadius: number;
  readonly maxDecisions: number;
}

export class DeterministicAiDirector {
  readonly config: AiConfig;
  #agents = new Map<EntityId, AgentState>();

  constructor(config: Partial<AiConfig> = {}) {
    this.config = Object.freeze({
      maxAgentsPerTick: Math.max(1, Math.floor(config.maxAgentsPerTick ?? 128)),
      memoryTicks: Math.max(1, Math.floor(config.memoryTicks ?? 180)),
      perceptionRadius: Math.max(1, config.perceptionRadius ?? 80),
      maxDecisions: Math.max(1, Math.floor(config.maxDecisions ?? 128)),
    });
  }

  registerAgent(
    entity: EntityId,
    position: Vec3,
    actions: readonly AiAction[],
    personality: Readonly<Record<string, number>> = {},
  ): void {
    if (actions.length === 0) throw new RangeError('AI agent needs at least one action');
    this.#agents.set(entity, {
      entity,
      position,
      memory: new Map(),
      cooldowns: new Map(),
      actions: [...actions],
      personality: { ...personality },
    });
  }

  removeAgent(entity: EntityId): boolean {
    return this.#agents.delete(entity);
  }

  updatePosition(entity: EntityId, position: Vec3): void {
    const agent = this.#agents.get(entity);
    if (agent) this.#agents.set(entity, { ...agent, position });
  }

  perceive(
    observer: EntityId,
    tick: RuntimeTick,
    targets: readonly PerceptionTarget[],
  ): readonly PerceptionMemory[] {
    const agent = this.#agents.get(observer);
    if (!agent) return [];

    const local = targets
      .filter((target) => target.entity !== observer)
      .map((target) => {
        const distance = Math.sqrt(distanceSquared(agent.position, target.position));
        if (distance > this.config.perceptionRadius) return null;
        const proximity = 1 - distance / this.config.perceptionRadius;
        const strength = clamp(proximity * 0.6 + target.visibility * 0.4, 0, 1);
        if (strength <= 0.02) return null;
        return {
          entity: target.entity,
          kind: target.kind,
          lastPosition: target.position,
          strength,
          expiresAtTick: tick.index + this.config.memoryTicks,
          threat: clamp(target.threat * strength, 0, 1),
        } satisfies PerceptionMemory;
      })
      .filter((value): value is PerceptionMemory => Boolean(value))
      .sort((a, b) => b.strength - a.strength || Number(a.entity) - Number(b.entity));

    for (const memory of local) agent.memory.set(memory.entity, memory);
    for (const [entity, memory] of agent.memory.entries()) {
      if (memory.expiresAtTick < tick.index) agent.memory.delete(entity);
    }
    return [...agent.memory.values()].sort((a, b) => Number(a.entity) - Number(b.entity));
  }

  decide(tick: RuntimeTick): readonly AiDecision[] {
    const decisions: AiDecision[] = [];
    const agents = [...this.#agents.values()]
      .sort((a, b) => Number(a.entity) - Number(b.entity))
      .slice(0, this.config.maxAgentsPerTick);

    for (const agent of agents) {
      const memories = [...agent.memory.values()]
        .sort((a, b) => b.strength - a.strength || Number(a.entity) - Number(b.entity));
      let best: { action: AiAction; utility: number; target?: EntityId } | null = null;

      for (const action of agent.actions) {
        const remaining = agent.cooldowns.get(action.id) ?? 0;
        if (remaining > 0) continue;

        const target = memories[0];
        const threat = target?.threat ?? 0;
        const distanceFactor = target
          ? clamp(1 - Math.sqrt(distanceSquared(agent.position, target.lastPosition)) / this.config.perceptionRadius, 0, 1)
          : 0;
        const bias = agent.personality[action.id] ?? 0;
        const utility = action.utility + bias + threat * action.cost + distanceFactor * 0.5;

        if (
          !best ||
          utility > best.utility ||
          (utility === best.utility && action.id.localeCompare(best.action.id) < 0)
        ) {
          best = { action, utility, ...(target ? { target: target.entity } : {}) };
        }
      }

      if (!best) continue;
      best.action.execute(agent.entity, tick, best.target);
      agent.cooldowns.set(best.action.id, best.action.cooldownTicks);
      for (const [id, value] of agent.cooldowns.entries()) {
        agent.cooldowns.set(id, Math.max(0, value - 1));
      }

      decisions.push({
        entity: agent.entity,
        action: best.action.id,
        utility: best.utility,
        ...(best.target ? { target: best.target } : {}),
      });

      if (decisions.length >= this.config.maxDecisions) break;
    }

    return decisions;
  }

  memories(entity: EntityId): readonly PerceptionMemory[] {
    return [...(this.#agents.get(entity)?.memory.values() ?? [])]
      .sort((a, b) => Number(a.entity) - Number(b.entity));
  }
}

export function createWanderAction(
  id: string,
  speed: number,
  destination: (entity: EntityId, direction: Vec3) => void,
): AiAction {
  const safeSpeed = clamp(speed, 0, 100);
  return {
    id,
    utility: 0.2,
    cooldownTicks: 15,
    cost: safeSpeed / 100,
    execute: (entity) => {
      const seed = Number(entity) * 17 + 11;
      const angle = ((seed % 360) * Math.PI) / 180;
      destination(entity, normalize({ x: Math.cos(angle), y: 0, z: Math.sin(angle) }));
    },
  };
}

export function createFleeAction(
  id: string,
  destination: (entity: EntityId, direction: Vec3) => void,
): AiAction {
  return {
    id,
    utility: 0.4,
    cooldownTicks: 10,
    cost: 1,
    execute: (entity, _tick, target) => {
      const basis = target ? normalize(sub({ x: Number(entity), y: 0, z: 0 }, { x: Number(target), y: 0, z: 0 }), { x: 1, y: 0, z: 0 }) : { x: 1, y: 0, z: 0 };
      destination(entity, basis);
    },
  };
}

export function stableAiSeed(entity: EntityId, tick: RuntimeTick): number {
  return (Number(entity) * 1_103_515_245 + tick.index * 12_345 + 1_013_904_223) >>> 0;
}
