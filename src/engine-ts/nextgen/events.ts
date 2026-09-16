import type { EntityId, TaskLane, Tick } from './contracts.ts';
import { stableJson, hashString } from './contracts.ts';

export interface GameEvent<TPayload = unknown> {
  readonly id: string;
  readonly type: string;
  readonly tick: Tick;
  readonly lane: TaskLane;
  readonly source?: EntityId;
  readonly payload: TPayload;
}

export interface EventSubscription {
  readonly type: string;
  readonly once: boolean;
  readonly unsubscribe: () => void;
}

export type EventHandler<T> = (event: GameEvent<T>) => void;

export class EventBus {
  readonly #handlers = new Map<string, Set<EventHandler<unknown>>>();
  readonly #history: GameEvent[] = [];
  readonly #historyLimit: number;
  #sequence = 0;

  constructor(historyLimit = 1024) { this.#historyLimit = Math.max(16, Math.floor(historyLimit)); }

  on<T>(type: string, handler: EventHandler<T>): EventSubscription {
    const set = this.#handlers.get(type) ?? new Set<EventHandler<unknown>>();
    set.add(handler as EventHandler<unknown>);
    this.#handlers.set(type, set);
    return Object.freeze({ type, once: false, unsubscribe: () => { set.delete(handler as EventHandler<unknown>); if (set.size === 0) this.#handlers.delete(type); } });
  }

  once<T>(type: string, handler: EventHandler<T>): EventSubscription {
    let subscription: EventSubscription;
    const wrapped: EventHandler<T> = (event) => { subscription.unsubscribe(); handler(event); };
    subscription = this.on(type, wrapped);
    return Object.freeze({ ...subscription, once: true });
  }

  emit<T>(type: string, payload: T, tick: Tick, lane: TaskLane, source?: EntityId): GameEvent<T> {
    const event: GameEvent<T> = Object.freeze({ id: hashString(`${Number(tick)}:${lane}:${type}:${this.#sequence++}`), type, tick, lane, source, payload });
    this.#history.push(event as GameEvent);
    if (this.#history.length > this.#historyLimit) this.#history.splice(0, this.#history.length - this.#historyLimit);
    for (const handler of [...(this.#handlers.get(type) ?? [])]) (handler as EventHandler<T>)(event);
    for (const handler of [...(this.#handlers.get('*') ?? [])]) (handler as EventHandler<T>)(event);
    return event;
  }

  collect(type?: string, fromTick?: Tick): readonly GameEvent[] {
    const result = this.#history.filter((event) => (type === undefined || type === '*' || event.type === type) && (fromTick === undefined || event.tick >= fromTick));
    return Object.freeze([...result]);
  }

  digest(fromTick?: Tick): string { return hashString(stableJson(this.collect(undefined, fromTick).map((event) => ({ id: event.id, type: event.type, tick: event.tick, lane: event.lane, source: event.source ?? null, payload: event.payload })))); }
  clearHistory(): void { this.#history.length = 0; }
  clear(): void { this.#handlers.clear(); this.#history.length = 0; this.#sequence = 0; }
}

export interface Command<TPayload = unknown> {
  readonly id: string;
  readonly type: string;
  readonly tick: Tick;
  readonly payload: TPayload;
}

export class CommandBus {
  readonly #commands = new Map<number, Command[]>();
  readonly #handlers = new Map<string, (command: Command) => void>();
  readonly #capacity: number;
  constructor(capacity = 256) { this.#capacity = Math.max(16, Math.floor(capacity)); }
  register(type: string, handler: (command: Command) => void): void { if (this.#handlers.has(type)) throw new Error(`command handler exists: ${type}`); this.#handlers.set(type, handler); }
  enqueue<T>(type: string, tick: Tick, payload: T, id = hashString(`${Number(tick)}:${type}:${JSON.stringify(payload)}`)): Command<T> { const bucket = this.#commands.get(Number(tick)) ?? []; if (bucket.length >= this.#capacity) throw new Error('command capacity exceeded'); const command: Command<T> = Object.freeze({ id, type, tick, payload }); bucket.push(command as Command); this.#commands.set(Number(tick), bucket); return command; }
  dispatch(tick: Tick): number { const bucket = this.#commands.get(Number(tick)) ?? []; let dispatched = 0; for (const command of bucket) { const handler = this.#handlers.get(command.type); if (!handler) continue; handler(command); dispatched += 1; } this.#commands.delete(Number(tick)); return dispatched; }
  pending(tick?: Tick): number { return tick === undefined ? [...this.#commands.values()].reduce((total, bucket) => total + bucket.length, 0) : (this.#commands.get(Number(tick))?.length ?? 0); }
  clear(): void { this.#commands.clear(); this.#handlers.clear(); }
}
