/**
 * TypeScript-first shared event bus for the shipped 3D runtime.
 *
 * Legacy JavaScript importers continue to resolve through eventBus.js, but the implementation and
 * singleton now live here. Known gameplay events receive payload typing while custom/scoped buses
 * remain supported through the generic fallback overloads.
 */
import { EVENTS } from './config.js';

export type EventPayload = unknown;
export type EventHandler<T = EventPayload> = (payload: T) => void;

export interface EventSubscription {
  readonly event: string;
  readonly unsubscribe: () => void;
}

export interface EventBusDiagnostics {
  readonly eventCount: number;
  readonly listenerCount: number;
  readonly events: readonly { name: string; listeners: number }[];
}

export interface AssetProgressEvent {
  readonly url: string;
  readonly loaded: number;
  readonly total: number;
  readonly ratio: number;
}

export interface AssetLoadedEvent {
  readonly url: string;
  readonly type: string;
}

export interface AssetErrorEvent {
  readonly url: string;
  readonly type?: string;
  readonly error?: unknown;
}

export interface GameReadyEvent {
  readonly phase: string;
}

export interface GameErrorEvent {
  readonly error: unknown;
}

export interface WorldEventTriggeredEvent {
  readonly id?: string;
  readonly icon?: string;
  readonly title?: string;
  readonly desc?: string;
  readonly color?: string;
  readonly [key: string]: unknown;
}

export interface PlayerDamagedEvent {
  readonly amount: number;
  readonly sourceId?: string;
  readonly rawAmount?: number;
  readonly blockedAmount?: number;
  readonly mitigation?: string;
  readonly [key: string]: unknown;
}

export interface PlayerHealthChangedEvent {
  readonly health?: number;
  readonly maxHealth?: number;
  readonly currentHealth?: number;
  readonly amount?: number;
  readonly [key: string]: unknown;
}

export interface PlayerDiedEvent {
  readonly [key: string]: unknown;
}

export interface GameEventMap {
  readonly [EVENTS.ASSET_PROGRESS]: AssetProgressEvent;
  readonly [EVENTS.ASSET_LOADED]: AssetLoadedEvent;
  readonly [EVENTS.ASSET_ERROR]: AssetErrorEvent;
  readonly [EVENTS.ASSETS_READY]: void;
  readonly [EVENTS.GAME_READY]: GameReadyEvent;
  readonly [EVENTS.GAME_ERROR]: GameErrorEvent;
  readonly [EVENTS.WORLD_EVENT_TRIGGERED]: WorldEventTriggeredEvent;
  readonly [EVENTS.PLAYER_DAMAGED]: PlayerDamagedEvent;
  readonly [EVENTS.PLAYER_HEALTH_CHANGED]: PlayerHealthChangedEvent;
  readonly [EVENTS.PLAYER_DIED]: PlayerDiedEvent;
}

export class EventBus<TEvents = Record<string, unknown>> {
  private readonly listeners = new Map<string, Set<EventHandler>>();
  private dispatching = false;
  private disposed = false;

  on<K extends keyof TEvents & string>(eventName: K, handler: EventHandler<TEvents[K]>): EventSubscription;
  on(eventName: string, handler: EventHandler): EventSubscription;
  on<T = EventPayload>(eventName: string, handler: EventHandler<T>): EventSubscription {
    if (this.disposed) throw new Error('EventBus has been disposed');
    if (!eventName.trim()) throw new Error('eventName must not be empty');

    const bucket = this.listeners.get(eventName) ?? new Set<EventHandler>();
    bucket.add(handler as EventHandler);
    this.listeners.set(eventName, bucket);

    return Object.freeze({
      event: eventName,
      unsubscribe: () => this.off(eventName, handler),
    });
  }

  once<K extends keyof TEvents & string>(eventName: K, handler: EventHandler<TEvents[K]>): EventSubscription;
  once(eventName: string, handler: EventHandler): EventSubscription;
  once<T = EventPayload>(eventName: string, handler: EventHandler<T>): EventSubscription {
    let subscription: EventSubscription | undefined;
    const wrapped: EventHandler<T> = payload => {
      subscription?.unsubscribe();
      handler(payload);
    };
    subscription = this.on(eventName, wrapped);
    return subscription;
  }

  off<K extends keyof TEvents & string>(eventName: K, handler: EventHandler<TEvents[K]>): boolean;
  off(eventName: string, handler: EventHandler): boolean;
  off<T = EventPayload>(eventName: string, handler: EventHandler<T>): boolean {
    const bucket = this.listeners.get(eventName);
    if (!bucket) return false;

    const removed = bucket.delete(handler as EventHandler);
    if (bucket.size === 0) this.listeners.delete(eventName);
    return removed;
  }

  emit<K extends keyof TEvents & string>(
    eventName: K,
    ...payload: TEvents[K] extends void ? [] : [TEvents[K]]
  ): void;
  emit(eventName: string, payload?: EventPayload): void;
  emit<T = EventPayload>(eventName: string, payload?: T): void {
    if (this.disposed) return;

    const bucket = this.listeners.get(eventName);
    if (!bucket) return;

    this.dispatching = true;
    try {
      for (const handler of [...bucket]) {
        try {
          handler(payload);
        } catch (error) {
          console.error(`[EventBus] listener for "${eventName}" threw`, error);
        }
      }
    } finally {
      this.dispatching = false;
    }
  }

  clear(eventName?: string): void {
    if (eventName === undefined) this.listeners.clear();
    else this.listeners.delete(eventName);
  }

  has(eventName: string): boolean {
    return (this.listeners.get(eventName)?.size ?? 0) > 0;
  }

  listenerCount(eventName?: string): number {
    if (eventName !== undefined) return this.listeners.get(eventName)?.size ?? 0;
    let count = 0;
    for (const bucket of this.listeners.values()) count += bucket.size;
    return count;
  }

  diagnostics(): EventBusDiagnostics {
    return Object.freeze({
      eventCount: this.listeners.size,
      listenerCount: this.listenerCount(),
      events: [...this.listeners.entries()]
        .map(([name, listeners]) => Object.freeze({ name, listeners: listeners.size }))
        .sort((left, right) => left.name.localeCompare(right.name)),
    });
  }

  get isDispatching(): boolean {
    return this.dispatching;
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.listeners.clear();
  }
}

export const gameEvents = new EventBus<GameEventMap>();
