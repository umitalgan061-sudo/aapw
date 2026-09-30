import { EntityId, Vec3, clamp, distanceSquared, hashString, stableChecksum } from './types.ts';

export type InteractionKind = 'use' | 'talk' | 'inspect' | 'pickup' | 'trade' | 'enter' | 'exit' | 'attack' | 'custom';
export type InteractionState = 'available' | 'blocked' | 'cooldown' | 'completed' | 'hidden';

export interface InteractionContext {
  actor: EntityId;
  target: EntityId;
  tick: number;
  distance: number;
  tags: ReadonlySet<string>;
  flags: Readonly<Record<string, boolean>>;
  values: Readonly<Record<string, number>>;
}

export interface InteractionDefinition {
  id: string;
  kind: InteractionKind;
  range: number;
  cooldownTicks: number;
  priority: number;
  enabled: boolean;
  oneShot: boolean;
  requiredTags: readonly string[];
  predicate?: (context: InteractionContext) => boolean;
  onExecute?: (context: InteractionContext) => void;
}

export interface InteractionTarget {
  entity: EntityId;
  position: Vec3;
  tags: readonly string[];
  definitions: readonly InteractionDefinition[];
}

export interface InteractionResult {
  ok: boolean;
  id: string;
  state: InteractionState;
  reason?: string;
}

export interface InteractionEvent {
  id: string;
  actor: EntityId;
  target: EntityId;
  kind: InteractionKind;
  tick: number;
  sequence: number;
  checksum: number;
}

interface RuntimeState {
  lastUseTick: number;
  useCount: number;
  completed: boolean;
}

const EMPTY_FLAGS: Readonly<Record<string, boolean>> = Object.freeze({});
const EMPTY_VALUES: Readonly<Record<string, number>> = Object.freeze({});

function normalizeId(id: string): string {
  const value = id.trim();
  if (!value || value.length > 128) throw new RangeError('Interaction ids must contain 1-128 characters');
  return value;
}

export class InteractionRuntimeV2 {
  readonly #states = new Map<string, RuntimeState>();
  readonly #events: InteractionEvent[] = [];
  #sequence = 0;

  register(definition: InteractionDefinition): void {
    const id = normalizeId(definition.id);
    if (this.#states.has(id)) throw new Error(`Interaction ${id} already registered`);
    if (!Number.isFinite(definition.range) || definition.range < 0) throw new RangeError('Interaction range must be finite and non-negative');
    if (!Number.isInteger(definition.cooldownTicks) || definition.cooldownTicks < 0) throw new RangeError('cooldownTicks must be non-negative integer');
    this.#states.set(id, { lastUseTick: -Infinity, useCount: 0, completed: false });
  }

  registerMany(definitions: readonly InteractionDefinition[]): void {
    for (const definition of definitions) this.register(definition);
  }

  unregister(id: string): boolean { return this.#states.delete(id); }

  state(id: string): RuntimeState | undefined {
    const state = this.#states.get(id);
    return state ? { ...state } : undefined;
  }

  available(target: InteractionTarget, context: Omit<InteractionContext, 'target' | 'distance'>): InteractionDefinition[] {
    const now = context.tick;
    const tags = new Set(target.tags);
    const matches: InteractionDefinition[] = [];
    for (const definition of target.definitions) {
      const state = this.#states.get(definition.id);
      if (!state || !definition.enabled || state.completed && definition.oneShot) continue;
      const distance = Math.sqrt(distanceSquared(contextPosition(context), target.position));
      if (distance > definition.range) continue;
      if (state.lastUseTick + definition.cooldownTicks > now) continue;
      if (definition.requiredTags.some((tag) => !tags.has(tag))) continue;
      const evaluated: InteractionContext = {
        ...context,
        target: target.entity,
        distance,
        tags,
        flags: context.flags ?? EMPTY_FLAGS,
        values: context.values ?? EMPTY_VALUES,
      };
      if (definition.predicate && !definition.predicate(evaluated)) continue;
      matches.push(definition);
    }
    return matches.sort((a, b) => (b.priority - a.priority) || a.id.localeCompare(b.id));
  }

  execute(
    definition: InteractionDefinition,
    context: Omit<InteractionContext, 'target' | 'distance'>,
    target: InteractionTarget,
  ): InteractionResult {
    const id = normalizeId(definition.id);
    const state = this.#states.get(id);
    if (!state) return { ok: false, id, state: 'hidden', reason: 'not_registered' };
    if (!definition.enabled) return { ok: false, id, state: 'hidden', reason: 'disabled' };
    if (state.completed && definition.oneShot) return { ok: false, id, state: 'completed', reason: 'already_completed' };
    const distance = Math.sqrt(distanceSquared(contextPosition(context), target.position));
    if (distance > definition.range) return { ok: false, id, state: 'blocked', reason: 'out_of_range' };
    if (state.lastUseTick + definition.cooldownTicks > context.tick) return { ok: false, id, state: 'cooldown', reason: 'cooldown' };
    const contextWithTarget: InteractionContext = {
      ...context,
      target: target.entity,
      distance,
      tags: new Set(target.tags),
      flags: context.flags ?? EMPTY_FLAGS,
      values: context.values ?? EMPTY_VALUES,
    };
    if (definition.requiredTags.some((tag) => !contextWithTarget.tags.has(tag))) {
      return { ok: false, id, state: 'blocked', reason: 'missing_tag' };
    }
    if (definition.predicate && !definition.predicate(contextWithTarget)) return { ok: false, id, state: 'blocked', reason: 'predicate_failed' };
    state.lastUseTick = context.tick;
    state.useCount += 1;
    state.completed = state.completed || definition.oneShot;
    definition.onExecute?.(contextWithTarget);
    const event: InteractionEvent = {
      id,
      actor: context.actor,
      target: target.entity,
      kind: definition.kind,
      tick: context.tick,
      sequence: ++this.#sequence,
      checksum: stableChecksum({ id, actor: context.actor, target: target.entity, tick: context.tick, sequence: this.#sequence }),
    };
    this.#events.push(event);
    return { ok: true, id, state: definition.oneShot ? 'completed' : 'available' };
  }

  events(): InteractionEvent[] { return this.#events.map((event) => ({ ...event })); }
  drainEvents(): InteractionEvent[] { const result = this.events(); this.#events.length = 0; return result; }

  reset(): void {
    for (const state of this.#states.values()) {
      state.lastUseTick = -Infinity;
      state.useCount = 0;
      state.completed = false;
    }
    this.#events.length = 0;
    this.#sequence = 0;
  }

  snapshot(): Record<string, RuntimeState> {
    return Object.fromEntries([...this.#states.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([id, state]) => [id, { ...state }]));
  }

  restore(snapshot: Readonly<Record<string, RuntimeState>>): void {
    for (const id of this.#states.keys()) {
      const value = snapshot[id];
      if (!value) continue;
      this.#states.set(id, {
        lastUseTick: Number.isFinite(value.lastUseTick) ? value.lastUseTick : -Infinity,
        useCount: Math.max(0, Math.floor(value.useCount)),
        completed: Boolean(value.completed),
      });
    }
  }

  digest(): number {
    return hashString(JSON.stringify({ states: this.snapshot(), events: this.#events }));
  }
}

function contextPosition(context: Omit<InteractionContext, 'target' | 'distance'>): Vec3 {
  const values = context.values ?? EMPTY_VALUES;
  return {
    x: Number.isFinite(values.x) ? values.x : 0,
    y: Number.isFinite(values.y) ? values.y : 0,
    z: Number.isFinite(values.z) ? values.z : 0,
  };
}

export function createInteraction(
  id: string,
  kind: InteractionKind,
  range: number,
  options: Partial<Omit<InteractionDefinition, 'id' | 'kind' | 'range'>> = {},
): InteractionDefinition {
  return {
    id,
    kind,
    range: clamp(range, 0, 10000),
    cooldownTicks: options.cooldownTicks ?? 0,
    priority: options.priority ?? 0,
    enabled: options.enabled ?? true,
    oneShot: options.oneShot ?? false,
    requiredTags: options.requiredTags ?? [],
    predicate: options.predicate,
    onExecute: options.onExecute,
  };
}

export interface TriggerRule {
  id: string;
  once: boolean;
  condition: (context: InteractionContext) => boolean;
  action: (context: InteractionContext) => void;
}

export class TriggerRuntimeV2 {
  readonly #rules: TriggerRule[] = [];
  readonly #fired = new Set<string>();

  register(rule: TriggerRule): void {
    normalizeId(rule.id);
    if (this.#rules.some((candidate) => candidate.id === rule.id)) throw new Error(`Trigger ${rule.id} already exists`);
    this.#rules.push(rule);
    this.#rules.sort((a, b) => a.id.localeCompare(b.id));
  }

  evaluate(context: InteractionContext): string[] {
    const fired: string[] = [];
    for (const rule of this.#rules) {
      if (rule.once && this.#fired.has(rule.id)) continue;
      if (!rule.condition(context)) continue;
      rule.action(context);
      this.#fired.add(rule.id);
      fired.push(rule.id);
    }
    return fired;
  }

  reset(): void { this.#fired.clear(); }
  snapshot(): string[] { return [...this.#fired].sort(); }
  restore(ids: readonly string[]): void { this.#fired.clear(); for (const id of ids) this.#fired.add(id); }
}
