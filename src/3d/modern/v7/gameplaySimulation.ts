import { add, clamp, clamp01, distanceSq, normalize, scale, stableSort, vec3, type Disposable, type EntityId, type Vec3 } from './primitives.js';

export type LocomotionState = 'idle' | 'walk' | 'run' | 'sprint' | 'airborne' | 'stunned' | 'defeated';
export type CombatAction = 'light' | 'heavy' | 'ranged' | 'guard' | 'parry' | 'dodge';
export interface ActorInput { readonly move: Vec3; readonly look: Vec3; readonly sprint: boolean; readonly jump: boolean; readonly action: CombatAction | null; }
export interface ActorState { readonly id: EntityId; readonly position: Vec3; readonly velocity: Vec3; readonly facing: Vec3; readonly health: number; readonly stamina: number; readonly poise: number; readonly grounded: boolean; readonly locomotion: LocomotionState; readonly action: CombatAction | null; readonly actionProgress: number; readonly revision: number; }
export interface ActionTuning { readonly stamina: number; readonly poise: number; readonly durationTicks: number; readonly reach: number; }
export interface SimulationEvent { readonly type: 'move' | 'jump' | 'attack' | 'guard' | 'parry' | 'dodge' | 'stagger' | 'defeat'; readonly actor: EntityId; readonly target: EntityId | null; readonly tick: number; readonly revision: number; }
export interface SimulationOptions { readonly tickRate?: number; readonly gravity?: number; readonly maxActors?: number; readonly maxSpeed?: number; }
export interface SimulationStats { readonly actors: number; readonly ticks: number; readonly events: number; readonly defeated: number; }

const tuning: Readonly<Record<CombatAction, ActionTuning>> = Object.freeze({
  light: Object.freeze({ stamina: 8, poise: 12, durationTicks: 18, reach: 2.2 }),
  heavy: Object.freeze({ stamina: 18, poise: 28, durationTicks: 34, reach: 2.8 }),
  ranged: Object.freeze({ stamina: 5, poise: 6, durationTicks: 22, reach: 30 }),
  guard: Object.freeze({ stamina: 1, poise: 0, durationTicks: 12, reach: 1.4 }),
  parry: Object.freeze({ stamina: 3, poise: 0, durationTicks: 10, reach: 1.8 }),
  dodge: Object.freeze({ stamina: 10, poise: 0, durationTicks: 14, reach: 0 }),
});

const cloneInput = (input: ActorInput): ActorInput => Object.freeze({ move: normalize(input.move ?? vec3()), look: normalize(input.look ?? vec3(0, 0, 1)), sprint: Boolean(input.sprint), jump: Boolean(input.jump), action: input.action ?? null });

export class DeterministicGameplaySimulation implements Disposable {
  readonly tickRate: number; readonly dt: number; readonly gravity: number; readonly maxActors: number; readonly maxSpeed: number;
  #actors = new Map<EntityId, ActorState>(); #inputs = new Map<EntityId, ActorInput>(); #events: SimulationEvent[] = []; #tick = 0; #revision = 0; #disposed = false;
  constructor(options: SimulationOptions = {}) { this.tickRate = clamp(options.tickRate ?? 60, 20, 120); this.dt = 1 / this.tickRate; this.gravity = clamp(options.gravity ?? -24, -60, -1); this.maxActors = clamp(Math.trunc(options.maxActors ?? 512), 1, 8192); this.maxSpeed = clamp(options.maxSpeed ?? 12, 1, 100); }
  registerActor(input: Omit<ActorState, 'id' | 'revision'> & { id: string }): boolean {
    if (this.#disposed || this.#actors.size >= this.maxActors || this.#actors.has(input.id)) return false;
    const actor: ActorState = Object.freeze({ ...input, id: input.id as EntityId, position: Object.freeze({ ...input.position }), velocity: Object.freeze({ ...input.velocity }), facing: normalize(input.facing), health: clamp(input.health, 0, 100), stamina: clamp(input.stamina, 0, 100), poise: clamp(input.poise, 0, 100), revision: 0 });
    this.#actors.set(actor.id, actor); return true;
  }
  removeActor(id: EntityId): boolean { this.#inputs.delete(id); return this.#actors.delete(id); }
  setInput(id: EntityId, input: ActorInput): boolean { if (!this.#actors.has(id) || this.#disposed) return false; this.#inputs.set(id, cloneInput(input)); return true; }
  tick(steps = 1): readonly SimulationEvent[] {
    if (this.#disposed) return []; const count = clamp(Math.trunc(steps), 1, 8); this.#events.length = 0;
    for (let step = 0; step < count; step += 1) this.#step(); return Object.freeze([...this.#events]);
  }
  actor(id: EntityId): ActorState | undefined { return this.#actors.get(id); }
  actors(): readonly ActorState[] { return Object.freeze(stableSort([...this.#actors.values()], (a, b) => String(a.id).localeCompare(String(b.id)))); }
  events(): readonly SimulationEvent[] { return Object.freeze([...this.#events]); }
  stats(): SimulationStats { return Object.freeze({ actors: this.#actors.size, ticks: this.#tick, events: this.#revision, defeated: [...this.#actors.values()].filter((actor) => actor.health <= 0).length }); }
  snapshot(): readonly ActorState[] { return this.actors(); }
  dispose(): void { this.#disposed = true; this.#actors.clear(); this.#inputs.clear(); this.#events.length = 0; }

  #step(): void {
    this.#tick += 1;
    for (const actor of this.actors()) {
      if (actor.health <= 0) { if (actor.locomotion !== 'defeated') this.#replace(actor.id, { locomotion: 'defeated', velocity: vec3(), action: null }); continue; }
      const input = this.#inputs.get(actor.id) ?? cloneInput({ move: vec3(), look: actor.facing, sprint: false, jump: false, action: null }); let next = this.#integrate(actor, input); next = this.#resolveAction(next, input.action);
      this.#replace(actor.id, next);
      if (lengthXZ(input.move) > .05) this.#emit({ type: 'move', actor: actor.id, target: null });
      if (input.jump && actor.grounded) this.#emit({ type: 'jump', actor: actor.id, target: null });
      if (input.action) this.#emit({ type: input.action === 'guard' ? 'guard' : input.action === 'parry' ? 'parry' : input.action === 'dodge' ? 'dodge' : 'attack', actor: actor.id, target: null });
    }
  }
  #integrate(actor: ActorState, input: ActorInput): Partial<ActorState> {
    const move = normalize(vec3(input.move.x, 0, input.move.z)); const speed = input.sprint ? this.maxSpeed : this.maxSpeed * .58; const desired = scale(move, speed); const acceleration = actor.grounded ? 14 : 7; const velocity = vec3(approach(actor.velocity.x, desired.x, acceleration * this.dt), approach(actor.velocity.y, desired.y, acceleration * this.dt) + (actor.grounded && input.jump ? 8.5 : 0) + (actor.grounded ? 0 : this.gravity * this.dt), approach(actor.velocity.z, desired.z, acceleration * this.dt)); let position = add(actor.position, scale(velocity, this.dt)); let grounded = actor.grounded;
    if (position.y <= 0) { position = vec3(position.x, 0, position.z); grounded = true; velocity.y = 0; } else grounded = false;
    const locomotion: LocomotionState = !grounded ? 'airborne' : lengthXZ(velocity) < .1 ? 'idle' : input.sprint ? 'sprint' : 'run'; const facing = lengthXZ(input.look) > .05 ? normalize(vec3(input.look.x, 0, input.look.z)) : actor.facing;
    return { position, velocity, grounded, facing, locomotion, stamina: clamp(actor.stamina + (input.action ? -tuning[input.action].stamina : 4 * this.dt), 0, 100), action: actor.action, actionProgress: actor.actionProgress };
  }
  #resolveAction(actor: Partial<ActorState> & ActorState, action: CombatAction | null): Partial<ActorState> {
    if (!action || actor.action || actor.stamina <= 0) return actor; const cost = tuning[action].stamina; if (actor.stamina < cost) return actor; return { ...actor, stamina: clamp(actor.stamina - cost, 0, 100), action, actionProgress: 0 };
  }
  #replace(id: EntityId, patch: Partial<ActorState>): void { const actor = this.#actors.get(id); if (!actor) return; const progress = actor.action ? clamp(actor.actionProgress + 1 / Math.max(1, tuning[actor.action].durationTicks), 0, 1) : 0; const action = progress >= 1 ? null : actor.action; const next = Object.freeze({ ...actor, ...patch, action, actionProgress: action ? progress : 0, revision: ++this.#revision }); this.#actors.set(id, next); }
  #emit(event: Omit<SimulationEvent, 'tick' | 'revision'>): void { this.#events.push(Object.freeze({ ...event, tick: this.#tick, revision: this.#revision })); }
}

function approach(current: number, target: number, amount: number): number { return current < target ? Math.min(target, current + amount) : Math.max(target, current - amount); }
function lengthXZ(value: Vec3): number { return Math.hypot(value.x, value.z); }
export function nearestActor(origin: Vec3, actors: readonly ActorState[], maxDistance = 10): ActorState | null { const maxSq = maxDistance * maxDistance; let best: ActorState | null = null; let bestDistance = maxSq; for (const actor of actors) { const distance = distanceSq(origin, actor.position); if (distance <= bestDistance) { if (!best || distance < bestDistance || String(actor.id).localeCompare(String(best.id)) < 0) { best = actor; bestDistance = distance; } } } return best; }
