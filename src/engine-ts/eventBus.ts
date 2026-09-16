import type { Disposable, EventEnvelope, EventHandler, EventHandlerContext, EventName, FrameId, Sequence, TickId } from './types.js';
import { EVENT_NAME, FRAME_ID, SEQUENCE, TICK_ID } from './types.js';
import { BoundedPriorityQueue } from './collections.js';

interface Subscription<T> {
  readonly token: number;
  readonly name: EventName;
  readonly handler: EventHandler<T>;
  readonly once: boolean;
  readonly priority: number;
  active: boolean;
}

export interface EventBusOptions {
  readonly maxSubscriptions?: number;
  readonly maxQueuedEvents?: number;
  readonly maxEventsPerFlush?: number;
  readonly strictPayloadFreeze?: boolean;
}

export interface PublishOptions {
  readonly tick?: TickId;
  readonly frame?: FrameId;
  readonly priority?: number;
  readonly defer?: boolean;
}

export interface EventBusStats {
  readonly published: number;
  readonly delivered: number;
  readonly dropped: number;
  readonly errors: number;
  readonly subscriptions: number;
  readonly queueSize: number;
  readonly sequence: number;
}

export class TypedEventBus implements Disposable {
  private readonly maxSubscriptions: number;
  private readonly maxQueuedEvents: number;
  private readonly maxEventsPerFlush: number;
  private readonly strictPayloadFreeze: boolean;
  private readonly subscriptions = new Map<EventName, Subscription<unknown>[]>();
  private readonly queue: BoundedPriorityQueue<EventEnvelope>;
  private nextToken = 1;
  private nextSequence = 1;
  private _disposed = false;
  private published = 0;
  private delivered = 0;
  private dropped = 0;
  private errors = 0;
  private activeFlush = false;
  private currentTick = 0 as TickId;
  private currentFrame = 0 as FrameId;

  public constructor(options: EventBusOptions = {}) {
    this.maxSubscriptions = Math.max(1, Math.trunc(options.maxSubscriptions ?? 2048));
    this.maxQueuedEvents = Math.max(1, Math.trunc(options.maxQueuedEvents ?? 4096));
    this.maxEventsPerFlush = Math.max(1, Math.trunc(options.maxEventsPerFlush ?? 1024));
    this.strictPayloadFreeze = options.strictPayloadFreeze ?? true;
    this.queue = new BoundedPriorityQueue<EventEnvelope>(this.maxQueuedEvents);
  }

  public get disposed(): boolean { return this._disposed; }
  public get stats(): EventBusStats {
    let subscriptionCount = 0;
    for (const list of this.subscriptions.values()) subscriptionCount += list.filter(item => item.active).length;
    return Object.freeze({
      published: this.published,
      delivered: this.delivered,
      dropped: this.dropped,
      errors: this.errors,
      subscriptions: subscriptionCount,
      queueSize: this.queue.size,
      sequence: this.nextSequence - 1,
    });
  }

  public on<T>(name: string, handler: EventHandler<T>, options: { once?: boolean; priority?: number } = {}): (() => void) {
    if (this._disposed || typeof handler !== 'function') return () => undefined;
    let count = 0;
    for (const list of this.subscriptions.values()) count += list.filter(item => item.active).length;
    if (count >= this.maxSubscriptions) return () => undefined;
    const eventName = EVENT_NAME(name);
    const token = this.nextToken++;
    const subscription: Subscription<T> = {
      token,
      name: eventName,
      handler,
      once: Boolean(options.once),
      priority: Number.isFinite(options.priority) ? Number(options.priority) : 0,
      active: true,
    };
    const list = this.subscriptions.get(eventName) ?? [];
    list.push(subscription as Subscription<unknown>);
    list.sort((a, b) => b.priority - a.priority || a.token - b.token);
    this.subscriptions.set(eventName, list);
    return () => this.off(token);
  }

  public once<T>(name: string, handler: EventHandler<T>, priority = 0): () => void {
    return this.on(name, handler, { once: true, priority });
  }

  public off(token: number): boolean {
    if (this._disposed) return false;
    for (const list of this.subscriptions.values()) {
      const subscription = list.find(item => item.token === token && item.active);
      if (subscription) { subscription.active = false; return true; }
    }
    return false;
  }

  public clear(name?: string): void {
    if (this._disposed) return;
    if (name === undefined) {
      for (const list of this.subscriptions.values()) for (const subscription of list) subscription.active = false;
      return;
    }
    const list = this.subscriptions.get(EVENT_NAME(name));
    if (list) for (const subscription of list) subscription.active = false;
  }

  public publish<T>(name: string, payload: T, options: PublishOptions = {}): boolean {
    if (this._disposed) return false;
    const eventName = EVENT_NAME(name);
    const event = this.buildEnvelope(eventName, payload, options);
    this.published += 1;
    if (options.defer) return this.queue.push(event, options.priority ?? 0).ok;
    void this.deliver(event);
    return true;
  }

  public enqueue<T>(name: string, payload: T, options: Omit<PublishOptions, 'defer'> = {}): boolean {
    return this.publish(name, payload, { ...options, defer: true });
  }

  public setClock(tick: TickId, frame: FrameId): void {
    if (this._disposed) return;
    this.currentTick = tick;
    this.currentFrame = frame;
  }

  public async flush(maxEvents = this.maxEventsPerFlush): Promise<number> {
    if (this._disposed || this.activeFlush) return 0;
    this.activeFlush = true;
    try {
      const events = this.queue.drain(Math.min(this.maxEventsPerFlush, Math.max(1, Math.trunc(maxEvents))));
      for (const event of events) await this.deliver(event);
      return events.length;
    } finally {
      this.activeFlush = false;
    }
  }

  public async drainAll(): Promise<number> {
    let total = 0;
    while (!this._disposed && this.queue.size > 0) {
      const count = await this.flush(this.maxEventsPerFlush);
      total += count;
      if (count === 0) break;
    }
    return total;
  }

  private buildEnvelope<T>(name: EventName, payload: T, options: PublishOptions): EventEnvelope<T> {
    const safePayload = this.strictPayloadFreeze ? freezePayload(payload) : payload;
    return Object.freeze({
      kind: 'engine.event',
      version: 1,
      revision: this.nextSequence,
      name,
      sequence: SEQUENCE(this.nextSequence++),
      tick: options.tick ?? this.currentTick,
      frame: options.frame ?? this.currentFrame,
      payload: safePayload as Readonly<T>,
    });
  }

  private async deliver(event: EventEnvelope): Promise<void> {
    if (this._disposed) return;
    const list = this.subscriptions.get(event.name);
    if (!list || list.length === 0) return;
    const controller = new AbortController();
    const context: EventHandlerContext = Object.freeze({ name: event.name, tick: event.tick, frame: event.frame, signal: controller.signal });
    for (const subscription of [...list]) {
      if (!subscription.active) continue;
      try {
        await subscription.handler(event, context);
        this.delivered += 1;
        if (subscription.once) subscription.active = false;
      } catch {
        this.errors += 1;
      }
    }
    this.compact(event.name);
  }

  private compact(name: EventName): void {
    const list = this.subscriptions.get(name);
    if (!list) return;
    const active = list.filter(item => item.active);
    if (active.length === 0) this.subscriptions.delete(name);
    else this.subscriptions.set(name, active);
  }

  public reset(): void {
    if (this._disposed) return;
    this.queue.clear();
    this.nextSequence = 1;
    this.published = 0;
    this.delivered = 0;
    this.dropped = 0;
    this.errors = 0;
    this.currentTick = TICK_ID(0);
    this.currentFrame = FRAME_ID(0);
  }

  public dispose(): void {
    if (this._disposed) return;
    this.clear();
    this.queue.dispose();
    this.subscriptions.clear();
    this._disposed = true;
  }
}

function freezePayload<T>(value: T, depth = 0): T {
  if (value === null || typeof value !== 'object' || depth > 6) return value;
  if (Object.isFrozen(value)) return value;
  if (Array.isArray(value)) {
    for (const item of value) freezePayload(item, depth + 1);
  } else {
    for (const key of Object.keys(value)) freezePayload((value as Record<string, unknown>)[key], depth + 1);
  }
  return Object.freeze(value);
}
