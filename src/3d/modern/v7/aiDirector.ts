import { asEntityId, clamp01, digest, distanceSq, stableSort, type Disposable, type EntityId, type Vec3 } from './primitives.js';

export type AiState = 'idle' | 'patrol' | 'investigate' | 'chase' | 'combat' | 'flee' | 'search';
export type GoalKind = 'survive' | 'guard' | 'reach' | 'patrol' | 'follow' | 'investigate' | 'attack';
export interface AiActor { readonly id: EntityId; readonly position: Vec3; readonly health01: number; readonly energy01: number; readonly awareness01: number; readonly state: AiState; readonly faction: string; readonly target: EntityId | null; }
export interface AiStimulus { readonly id: string; readonly position: Vec3; readonly kind: 'sight' | 'sound' | 'damage' | 'interest' | 'hazard'; readonly intensity01: number; readonly source: EntityId | null; readonly tick: number; }
export interface AiGoal { readonly kind: GoalKind; readonly weight: number; readonly target: EntityId | null; readonly position: Vec3 | null; readonly expiresAt: number | null; }
export interface AiDecision { readonly actor: EntityId; readonly state: AiState; readonly target: EntityId | null; readonly destination: Vec3 | null; readonly score: number; readonly stimulus: string | null; readonly digest: string; }
export interface AiSnapshot { readonly tick: number; readonly actors: readonly AiActor[]; readonly memory: readonly MemoryRecord[]; readonly digest: string; }
export interface MemoryRecord { readonly stimulus: AiStimulus; readonly confidence: number; readonly lastSeen: number; }
export interface AiDirectorOptions { readonly memoryLimit?: number; readonly actorsPerTick?: number; readonly stimuliPerActor?: number; readonly memoryHalfLife?: number; }

export class UtilityAiDirector implements Disposable {
  readonly memoryLimit: number; readonly actorsPerTick: number; readonly stimuliPerActor: number; readonly memoryHalfLife: number;
  #actors = new Map<EntityId, AiActor>(); #goals = new Map<EntityId, AiGoal[]>(); #memory = new Map<EntityId, Map<string, MemoryRecord>>(); #tick = 0; #disposed = false; #decisions = 0;
  constructor(options: AiDirectorOptions = {}) { this.memoryLimit = clampLimit(options.memoryLimit ?? 4096, 32, 65536); this.actorsPerTick = clampLimit(options.actorsPerTick ?? 128, 1, 2048); this.stimuliPerActor = clampLimit(options.stimuliPerActor ?? 32, 1, 128); this.memoryHalfLife = Math.max(1, Number(options.memoryHalfLife ?? 240)); }
  registerActor(actor: Omit<AiActor, 'id'> & { id: string }): boolean {
    if (this.#disposed || this.#actors.has(actor.id)) return false;
    const normalized = Object.freeze({ ...actor, id: asEntityId(actor.id), health01: clamp01(actor.health01), energy01: clamp01(actor.energy01), awareness01: clamp01(actor.awareness01), target: actor.target ?? null });
    this.#actors.set(normalized.id, normalized); this.#memory.set(normalized.id, new Map()); return true;
  }
  setGoals(actor: EntityId, goals: readonly AiGoal[]): boolean { if (!this.#actors.has(actor)) return false; const sorted = stableSort(goals, (a, b) => b.weight - a.weight || a.kind.localeCompare(b.kind)).slice(0, 32).map(normalizeGoal); this.#goals.set(actor, sorted as AiGoal[]); return true; }
  observe(actor: EntityId, stimuli: readonly AiStimulus[]): number {
    const memory = this.#memory.get(actor); if (!memory) return 0; let written = 0;
    for (const stimulus of stableSort(stimuli, (a, b) => b.tick - a.tick || b.intensity01 - a.intensity01 || a.id.localeCompare(b.id)).slice(0, this.stimuliPerActor)) {
      if (!stimulus.id) continue; const record: MemoryRecord = Object.freeze({ stimulus: Object.freeze({ ...stimulus, intensity01: clamp01(stimulus.intensity01) }), confidence: clamp01(stimulus.intensity01), lastSeen: stimulus.tick }); memory.set(stimulus.id, record); written += 1;
    }
    if (memory.size > this.memoryLimit) { const trim = stableSort([...memory.values()], (a, b) => a.lastSeen - b.lastSeen || a.stimulus.id.localeCompare(b.stimulus.id)); for (const record of trim.slice(0, memory.size - this.memoryLimit)) memory.delete(record.stimulus.id); }
    return written;
  }
  decide(actorId: EntityId): AiDecision | null {
    const actor = this.#actors.get(actorId); if (!actor || this.#disposed) return null; const memory = this.#memory.get(actorId) ?? new Map(); const candidates = [...memory.values()].map((record) => ({ record, score: record.confidence * actor.awareness01 * (1 / (1 + Math.sqrt(distanceSq(actor.position, record.stimulus.position)))) }));
    const best = stableSort(candidates, (a, b) => b.score - a.score || String(a.record.stimulus.id).localeCompare(String(b.record.stimulus.id)))[0]; const healthPressure = 1 - actor.health01;
    let state: AiState = 'idle'; let target: EntityId | null = null; let destination: Vec3 | null = null; let score = 0; let stimulus: string | null = null;
    if (healthPressure > 0.75) { state = 'flee'; score = healthPressure; }
    else if (best && best.score > 0.035) { score = best.score; stimulus = best.record.stimulus.id; target = best.record.stimulus.source; destination = best.record.stimulus.position; state = best.record.stimulus.kind === 'damage' ? 'combat' : best.record.stimulus.kind === 'sound' ? 'investigate' : 'chase'; }
    else { const goal = this.#goals.get(actorId)?.find((candidate) => candidate.expiresAt === null || candidate.expiresAt >= this.#tick); if (goal) { score = clamp01(goal.weight); destination = goal.position; target = goal.target; state = goal.kind === 'patrol' ? 'patrol' : goal.kind === 'investigate' ? 'investigate' : goal.kind === 'attack' ? 'combat' : 'search'; } }
    const next = Object.freeze({ ...actor, state, target }); this.#actors.set(actorId, next); this.#decisions += 1; const result: AiDecision = Object.freeze({ actor: actorId, state, target, destination: destination ? Object.freeze({ ...destination }) : null, score: clamp01(score), stimulus, digest: digest(actorId, state, target, destination, stimulus, this.#tick) }); return result;
  }
  update(tick: number, observations: ReadonlyMap<EntityId, readonly AiStimulus[]>): readonly AiDecision[] {
    if (this.#disposed) return []; this.#tick = Math.max(this.#tick, Math.trunc(tick)); const actors = stableSort([...this.#actors.keys()], (a, b) => String(a).localeCompare(String(b))).slice(0, this.actorsPerTick); const decisions: AiDecision[] = [];
    for (const actor of actors) { this.observe(actor, observations.get(actor) ?? []); this.#decay(actor); const decision = this.decide(actor); if (decision) decisions.push(decision); } return Object.freeze(decisions);
  }
  snapshot(): AiSnapshot { const actors = stableSort([...this.#actors.values()], (a, b) => String(a.id).localeCompare(String(b.id))); const memory = stableSort([...this.#memory.values()].flatMap((items) => [...items.values()]), (a, b) => String(a.stimulus.id).localeCompare(String(b.stimulus.id))); return Object.freeze({ tick: this.#tick, actors: Object.freeze(actors), memory: Object.freeze(memory), digest: digest(this.#tick, actors, memory) }); }
  stats(): Readonly<{ actors: number; decisions: number; memories: number }> { const memories = [...this.#memory.values()].reduce((sum, item) => sum + item.size, 0); return Object.freeze({ actors: this.#actors.size, decisions: this.#decisions, memories }); }
  dispose(): void { this.#disposed = true; this.#actors.clear(); this.#goals.clear(); this.#memory.clear(); }
  #decay(actor: EntityId): void { const memory = this.#memory.get(actor); if (!memory) return; for (const [id, record] of memory) { const age = Math.max(0, this.#tick - record.lastSeen); const confidence = record.confidence * Math.pow(0.5, age / this.memoryHalfLife); if (confidence < 0.01) memory.delete(id); else memory.set(id, Object.freeze({ ...record, confidence })); } }
}
function clampLimit(value: number, min: number, max: number): number { return Math.max(min, Math.min(max, Math.trunc(Number.isFinite(value) ? value : min))); }
function normalizeGoal(goal: AiGoal): AiGoal { return Object.freeze({ ...goal, weight: clamp01(goal.weight), target: goal.target ?? null, position: goal.position ? Object.freeze({ ...goal.position }) : null, expiresAt: goal.expiresAt === null ? null : Math.trunc(goal.expiresAt) }); }
