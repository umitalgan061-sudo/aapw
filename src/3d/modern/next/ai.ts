import { clamp, distance3, dot3, normalize3, type Vec3 } from './math.ts';
import { DeterministicRandom, seededRandom } from './determinism.ts';

export type UtilityActionId = string;

export interface UtilityContext {
  readonly selfPosition: Vec3;
  readonly targetPosition?: Vec3;
  readonly health01: number;
  readonly stamina01: number;
  readonly threat01: number;
  readonly distanceToTarget: number;
  readonly timeSinceDamageSeconds: number;
  readonly hasLineOfSight: boolean;
  readonly isNight: boolean;
}

export interface UtilityAction {
  readonly id: UtilityActionId;
  readonly baseScore: number;
  readonly cooldownSeconds: number;
  readonly minUtility?: number;
  readonly score(context: UtilityContext): number;
}

export interface Decision {
  readonly action: UtilityActionId;
  readonly score: number;
  readonly confidence: number;
  readonly alternatives: readonly { action: UtilityActionId; score: number }[];
}

interface MemoryEntry { value: number; expiresAtTick: number; }

export class AIPerceptionMemory {
  readonly maxEntries: number;
  #memory = new Map<string, MemoryEntry>();
  constructor(maxEntries = 256) { this.maxEntries = Math.max(8, Math.floor(maxEntries)); }
  remember(key: string, value: number, currentTick: number, ttlTicks: number): void {
    const normalized = key.trim();
    if (!normalized) return;
    this.#memory.set(normalized, { value, expiresAtTick: currentTick + Math.max(1, Math.floor(ttlTicks)) });
    while (this.#memory.size > this.maxEntries) this.#memory.delete(this.#memory.keys().next().value!);
  }
  read(key: string, currentTick: number): number | undefined {
    const entry = this.#memory.get(key.trim());
    if (!entry) return undefined;
    if (currentTick > entry.expiresAtTick) { this.#memory.delete(key.trim()); return undefined; }
    return entry.value;
  }
  decay(currentTick: number): number {
    let removed = 0;
    for (const [key, entry] of this.#memory) if (currentTick > entry.expiresAtTick) { this.#memory.delete(key); removed += 1; }
    return removed;
  }
  size(): number { return this.#memory.size; }
}

export interface ThreatObservation { readonly sourceId: number; readonly position: Vec3; readonly strength: number; readonly visible: boolean; }

export class ThreatModel {
  #threats = new Map<number, { value: number; position: Vec3; lastTick: number }>();
  observe(observation: ThreatObservation, currentTick: number): void {
    const value = clamp(observation.strength, 0, 1) * (observation.visible ? 1 : 0.35);
    this.#threats.set(observation.sourceId, { value, position: { ...observation.position }, lastTick: currentTick });
  }
  score(selfPosition: Vec3, currentTick: number, halfLifeTicks = 120): number {
    let strongest = 0;
    for (const [id, threat] of this.#threats) {
      const age = Math.max(0, currentTick - threat.lastTick);
      const decay = 0.5 ** (age / Math.max(1, halfLifeTicks));
      const distanceFactor = 1 / (1 + distance3(selfPosition, threat.position) * 0.01);
      const value = threat.value * decay * (0.5 + distanceFactor * 0.5);
      if (value > strongest) strongest = value;
      if (age > halfLifeTicks * 8) this.#threats.delete(id);
    }
    return clamp(strongest, 0, 1);
  }
  strongest(selfPosition: Vec3, currentTick: number): { sourceId: number; score: number; position: Vec3 } | undefined {
    let best: { sourceId: number; score: number; position: Vec3 } | undefined;
    for (const [sourceId, threat] of this.#threats) {
      const age = Math.max(0, currentTick - threat.lastTick);
      const score = threat.value * 0.5 ** (age / 120) / (1 + distance3(selfPosition, threat.position) * 0.01);
      if (!best || score > best.score || (score === best.score && sourceId < best.sourceId)) best = { sourceId, score, position: { ...threat.position } };
    }
    return best;
  }
}

export class UtilityPlanner {
  #actions: UtilityAction[] = [];
  #cooldowns = new Map<string, number>();
  #rng: DeterministicRandom;

  constructor(seed = 1) { this.#rng = seededRandom(seed, 0x415049); }
  register(action: UtilityAction): void {
    if (!action.id.trim()) throw new TypeError('action id required');
    if (this.#actions.some((existing) => existing.id === action.id)) throw new Error(`duplicate utility action: ${action.id}`);
    this.#actions.push(action);
  }

  decide(context: UtilityContext, currentTick: number): Decision | undefined {
    const scored = this.#actions.map((action) => {
      const cooldownUntil = this.#cooldowns.get(action.id) ?? -1;
      const available = currentTick >= cooldownUntil;
      const raw = available ? action.baseScore + action.score(context) : Number.NEGATIVE_INFINITY;
      return { action: action.id, score: raw, available, cooldownSeconds: action.cooldownSeconds, minUtility: action.minUtility ?? Number.NEGATIVE_INFINITY };
    }).filter((candidate) => candidate.available && candidate.score >= candidate.minUtility).sort((a, b) => b.score - a.score || a.action.localeCompare(b.action));
    if (!scored.length) return undefined;
    const top = scored[0]!;
    const second = scored[1];
    const spread = second ? Math.max(0, top.score - second.score) : Math.max(0, Math.abs(top.score));
    const confidence = clamp(spread / Math.max(0.001, Math.abs(top.score) + Math.abs(second?.score ?? 0)), 0.05, 1);
    return { action: top.action, score: top.score, confidence, alternatives: scored.slice(0, 4).map(({ action, score }) => ({ action, score })) };
  }

  commit(decision: Decision, currentTick: number): void {
    const action = this.#actions.find((candidate) => candidate.id === decision.action);
    if (!action) return;
    this.#cooldowns.set(action.id, currentTick + Math.max(0, Math.ceil(action.cooldownSeconds * 60)));
  }

  chooseWeighted(decision: Decision): UtilityActionId {
    if (decision.alternatives.length <= 1) return decision.action;
    const total = decision.alternatives.reduce((sum, item) => sum + Math.max(0, item.score), 0);
    if (!(total > 0)) return decision.action;
    let cursor = this.#rng.range(0, total);
    for (const item of decision.alternatives) {
      cursor -= Math.max(0, item.score);
      if (cursor <= 0) return item.action;
    }
    return decision.action;
  }
}

export function makeUtilityActions(): UtilityAction[] {
  return [
    { id: 'flee', baseScore: 0.1, cooldownSeconds: 1.5, minUtility: 0.2, score: (c) => c.threat01 * 0.9 + (1 - c.health01) * 0.8 },
    { id: 'attack', baseScore: 0.15, cooldownSeconds: 0.4, minUtility: 0.2, score: (c) => (c.targetPosition && c.hasLineOfSight ? 0.7 : 0) + c.stamina01 * 0.25 - c.distanceToTarget * 0.004 },
    { id: 'retreat', baseScore: 0.05, cooldownSeconds: 0.8, minUtility: 0.15, score: (c) => c.threat01 * 0.45 + clamp(c.distanceToTarget / 25, 0, 1) * 0.15 },
    { id: 'recover', baseScore: 0.08, cooldownSeconds: 1.2, minUtility: 0.15, score: (c) => (1 - c.stamina01) * 0.6 + (1 - c.health01) * 0.4 },
    { id: 'patrol', baseScore: 0.05, cooldownSeconds: 2.5, minUtility: -1, score: (c) => (c.isNight ? 0.02 : 0.12) + (c.targetPosition ? 0 : 0.18) },
  ];
}

export function facingScore(forward: Vec3, selfPosition: Vec3, targetPosition: Vec3): number {
  return clamp((dot3(normalize3(forward), normalize3({ x: targetPosition.x - selfPosition.x, y: targetPosition.y - selfPosition.y, z: targetPosition.z - selfPosition.z })) + 1) * 0.5, 0, 1);
}
