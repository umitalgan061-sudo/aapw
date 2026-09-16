import { asEntityId, clamp, digest, stableSort, type Disposable, type EntityId, type Tick, type Vec3 } from './primitives.js';
import type { SpatialWorldIndex } from './spatialWorld.js';
import type { UtilityAiDirector } from './aiDirector.js';
import type { DeterministicGameplaySimulation } from './gameplaySimulation.js';
import type { DeterministicCombatRuntime } from './combatRuntime.js';
import type { RuntimeStateStore } from './stateStore.js';
import type { DeterministicEventBus } from './eventBus.js';

export interface WorldActorBinding { readonly entity: EntityId; readonly ai: boolean; readonly gameplay: boolean; readonly combat: boolean; readonly faction: string; }
export interface WorldTickResult { readonly tick: Tick; readonly active: readonly EntityId[]; readonly sleeping: readonly EntityId[]; readonly events: readonly unknown[]; readonly digest: string; }
export interface WorldOrchestratorStats { readonly entities: number; readonly active: number; readonly sleeping: number; readonly ticks: number; readonly events: number; }

export class DeterministicWorldOrchestrator implements Disposable {
  readonly interest: SpatialWorldIndex;
  readonly ai: UtilityAiDirector;
  readonly gameplay: DeterministicGameplaySimulation;
  readonly combat: DeterministicCombatRuntime;
  readonly state: RuntimeStateStore;
  readonly events: DeterministicEventBus;
  readonly activeBudget: number;
  #bindings = new Map<EntityId, WorldActorBinding>();
  #tick: Tick = 0 as Tick;
  #ticks = 0;
  #events = 0;
  #disposed = false;
  constructor(deps: { interest: SpatialWorldIndex; ai: UtilityAiDirector; gameplay: DeterministicGameplaySimulation; combat: DeterministicCombatRuntime; state: RuntimeStateStore; events: DeterministicEventBus }, activeBudget = 512) {
    this.interest = deps.interest;
    this.ai = deps.ai;
    this.gameplay = deps.gameplay;
    this.combat = deps.combat;
    this.state = deps.state;
    this.events = deps.events;
    this.activeBudget = clamp(Math.trunc(activeBudget), 16, 8192);
  }
  bind(input: Omit<WorldActorBinding, 'entity'> & { entity: string }): boolean {
    if (this.#disposed || this.#bindings.has(input.entity)) return false;
    const binding = Object.freeze({ ...input, entity: asEntityId(input.entity) });
    this.#bindings.set(binding.entity, binding);
    return true;
  }
  unbind(entity: EntityId): boolean {
    return this.#bindings.delete(entity);
  }
  tick(tick: Tick, focus: Vec3): WorldTickResult {
    if (this.#disposed) return Object.freeze({ tick, active: [], sleeping: [], events: [], digest: 'disposed' });
    this.#tick = tick;
    this.#ticks += 1;
    const interest = this.interest.interest(focus);
    const active = stableSort(interest.filter((record) => record.tier !== 'sleeping'), (a, b) => b.score - a.score || String(a.id).localeCompare(String(b.id))).slice(0, this.activeBudget).map((record) => record.id);
    const activeSet = new Set(active);
    const sleeping = stableSort([...this.#bindings.keys()].filter((id) => !activeSet.has(id)), (a, b) => String(a).localeCompare(String(b)));
    const events: unknown[] = [];
    for (const entity of active) {
      const binding = this.#bindings.get(entity);
      if (!binding) continue;
      if (binding.ai) {
        const decision = this.ai.decide(entity);
        if (decision) events.push(decision);
      }
      if (binding.combat) {
        const actor = this.combat.actor(entity);
        if (actor?.phase === 'stunned' && actor.poise > 10) this.events.publish('combat:recover', tick, 'v7.world', { entity });
      }
    }
    if (active.length) this.events.publish('world:interest', tick, 'v7.world', { active, sleeping });
    this.#events += events.length;
    return Object.freeze({ tick, active: Object.freeze(active), sleeping: Object.freeze(sleeping), events: Object.freeze(events), digest: digest(tick, active, sleeping, events) });
  }
  bindings(): readonly WorldActorBinding[] {
    return Object.freeze(stableSort([...this.#bindings.values()], (a, b) => String(a.entity).localeCompare(String(b.entity))));
  }
  stats(): WorldOrchestratorStats {
    let active = 0;
    let sleeping = 0;
    for (const record of this.interest.interest({ x: 0, y: 0, z: 0 })) {
      if (record.tier === 'sleeping') sleeping += 1;
      else active += 1;
    }
    return Object.freeze({ entities: this.#bindings.size, active, sleeping, ticks: this.#ticks, events: this.#events });
  }
  dispose(): void {
    this.#disposed = true;
    this.#bindings.clear();
  }
}
