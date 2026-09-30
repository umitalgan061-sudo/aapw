export type AiMode = 'idle' | 'patrol' | 'wander' | 'follow' | 'flee' | 'combat' | 'search' | 'work' | 'sleep' | 'dead';
export type AiPriority = 'critical' | 'high' | 'normal' | 'low' | 'background';

export interface AiTransform {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface AiMemory {
  readonly targetId: string | null;
  readonly targetLastSeenAt: number;
  readonly targetLastSeen: AiTransform | null;
  readonly threat: number;
  readonly confidence: number;
}

export interface AiAgentState {
  readonly id: string;
  readonly faction: string;
  readonly mode: AiMode;
  readonly priority: AiPriority;
  readonly transform: AiTransform;
  readonly velocity: AiTransform;
  readonly memory: AiMemory;
  readonly health: number;
  readonly maxHealth: number;
  readonly morale: number;
  readonly hunger: number;
  readonly fatigue: number;
  readonly alertness: number;
  readonly desiredTarget: AiTransform | null;
  readonly revision: number;
}

export interface AiStimulus {
  readonly id: string;
  readonly type: 'visual' | 'audio' | 'damage' | 'event';
  readonly position: AiTransform;
  readonly strength: number;
  readonly faction?: string;
  readonly timestamp: number;
}

export interface AiActionScore {
  readonly action: AiMode;
  readonly score: number;
  readonly reason: string;
}

export interface AiDecision {
  readonly mode: AiMode;
  readonly target: AiTransform | null;
  readonly scores: readonly AiActionScore[];
  readonly utility: number;
}

export interface AiAuthorityOptions {
  readonly perceptionRadius?: number;
  readonly reactionMs?: number;
  readonly maxThinkersPerFrame?: number;
  readonly now?: () => number;
}

const clamp = (v: number, min = 0, max = 1): number => Math.min(max, Math.max(min, Number.isFinite(v) ? v : min));
const distance = (a: AiTransform, b: AiTransform): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const normalize = (x: number, y: number, z: number): AiTransform => { const magnitude = Math.hypot(x, y, z); if (magnitude < 1e-6) return { x: 0, y: 0, z: 0 }; return { x: x / magnitude, y: y / magnitude, z: z / magnitude }; };

export class AiAuthority {
  readonly #perceptionRadius: number;
  readonly #reactionMs: number;
  readonly #maxThinkersPerFrame: number;
  readonly #now: () => number;
  readonly #agents = new Map<string, AiAgentState>();
  readonly #stimuli: AiStimulus[] = [];
  #frame = 0;
  #thinking = 0;
  #decisions = 0;
  #skipped = 0;

  constructor(options: AiAuthorityOptions = {}) {
    this.#perceptionRadius = Math.max(1, options.perceptionRadius ?? 30);
    this.#reactionMs = Math.max(25, options.reactionMs ?? 150);
    this.#maxThinkersPerFrame = Math.max(1, Math.floor(options.maxThinkersPerFrame ?? 128));
    this.#now = options.now ?? (() => performance.now());
  }

  register(agent: AiAgentState): void { this.#agents.set(agent.id, Object.freeze({ ...agent })); }
  remove(id: string): void { this.#agents.delete(id); }
  get(id: string): AiAgentState | undefined { return this.#agents.get(id); }
  values(): readonly AiAgentState[] { return [...this.#agents.values()].sort((a, b) => a.id.localeCompare(b.id)); }

  pushStimulus(stimulus: AiStimulus): void {
    this.#stimuli.push(Object.freeze({ ...stimulus, strength: clamp(stimulus.strength) }));
    if (this.#stimuli.length > 1024) this.#stimuli.splice(0, this.#stimuli.length - 1024);
  }

  decide(id: string, deltaMs = 16): AiDecision | null {
    const agent = this.#agents.get(id);
    if (!agent) return null;
    const nearby = this.#stimuli.filter((stimulus) => distance(agent.transform, stimulus.position) <= this.#perceptionRadius);
    const threat = nearby.filter((stimulus) => stimulus.type === 'damage' || stimulus.type === 'visual').reduce((sum, stimulus) => sum + stimulus.strength, 0);
    const hostile = nearby.filter((stimulus) => stimulus.faction && stimulus.faction !== agent.faction).sort((a, b) => distance(agent.transform, a.position) - distance(agent.transform, b.position) || a.id.localeCompare(b.id))[0];
    const healthRatio = clamp(agent.health / Math.max(1, agent.maxHealth));
    const staminaPressure = clamp(agent.fatigue / 100);
    const danger = clamp(threat * 0.5 + (1 - healthRatio) * 0.35 + (1 - agent.morale / 100) * 0.15);
    const target = hostile?.position ?? agent.memory.targetLastSeen;
    const scores: AiActionScore[] = [
      { action: 'flee', score: danger * (1 - healthRatio * 0.4), reason: 'threat and survival pressure' },
      { action: 'combat', score: hostile ? (healthRatio * 0.75 + agent.alertness / 250) : 0, reason: hostile ? 'hostile stimulus' : 'no hostile target' },
      { action: 'follow', score: target ? clamp(agent.alertness / 100) * 0.6 : 0, reason: target ? 'remembered or visible target' : 'no target' },
      { action: 'work', score: clamp((100 - agent.hunger) / 100) * 0.65 * (1 - danger), reason: 'routine utility' },
      { action: 'sleep', score: clamp(agent.fatigue / 100) * 0.8 * (1 - danger * 0.7), reason: 'fatigue utility' },
      { action: 'wander', score: 0.25 * (1 - danger) * (1 - staminaPressure * 0.5), reason: 'low-pressure fallback' },
      { action: 'idle', score: 0.1, reason: 'safe fallback' },
    ];
    scores.sort((a, b) => b.score - a.score || a.action.localeCompare(b.action));
    const best = scores[0] ?? { action: 'idle' as const, score: 0, reason: 'fallback' };
    this.#decisions += 1;
    const mode: AiMode = best.action;
    const next = Object.freeze({
      ...agent,
      mode,
      desiredTarget: target ? Object.freeze({ ...target }) : null,
      memory: Object.freeze({ ...agent.memory, targetId: hostile?.id ?? agent.memory.targetId, targetLastSeenAt: hostile ? this.#now() : agent.memory.targetLastSeenAt, targetLastSeen: target ? Object.freeze({ ...target }) : agent.memory.targetLastSeen, threat, confidence: hostile ? 1 : clamp(agent.memory.confidence * 0.98) }),
      revision: agent.revision + 1,
    });
    this.#agents.set(id, next);
    void deltaMs;
    return Object.freeze({ mode, target: next.desiredTarget, scores, utility: best.score });
  }

  tick(deltaMs: number, nowMs = this.#now()): readonly AiDecision[] {
    this.#frame += 1;
    this.#thinking = 0;
    this.#skipped = 0;
    const ordered = this.values().sort((a, b) => priorityWeight(b.priority) - priorityWeight(a.priority) || a.id.localeCompare(b.id));
    const decisions: AiDecision[] = [];
    for (const agent of ordered) {
      if (agent.mode === 'dead') continue;
      const cadence = cadenceMs(agent.priority, this.#reactionMs);
      if (nowMs - agent.memory.targetLastSeenAt < cadence && agent.memory.targetLastSeenAt > 0) { this.#skipped += 1; continue; }
      if (this.#thinking >= this.#maxThinkersPerFrame) { this.#skipped += 1; continue; }
      this.#thinking += 1;
      const decision = this.decide(agent.id, deltaMs);
      if (decision) decisions.push(decision);
    }
    return Object.freeze(decisions);
  }

  metrics(): Readonly<{ frame: number; agents: number; thinkers: number; decisions: number; skipped: number }> {
    return Object.freeze({ frame: this.#frame, agents: this.#agents.size, thinkers: this.#thinking, decisions: this.#decisions, skipped: this.#skipped });
  }
}

const priorityWeight = (priority: AiPriority): number => ({ critical: 5, high: 4, normal: 3, low: 2, background: 1 })[priority];
const cadenceMs = (priority: AiPriority, reactionMs: number): number => Math.max(16, reactionMs * ({ critical: 0.4, high: 0.7, normal: 1, low: 2.5, background: 5 }[priority] ?? 1));

export const steerToward = (from: AiTransform, target: AiTransform, speed: number, dtSeconds: number): AiTransform => {
  const direction = normalize(target.x - from.x, target.y - from.y, target.z - from.z);
  return { x: from.x + direction.x * Math.max(0, speed) * Math.max(0, dtSeconds), y: from.y + direction.y * Math.max(0, speed) * Math.max(0, dtSeconds), z: from.z + direction.z * Math.max(0, speed) * Math.max(0, dtSeconds) };
};
