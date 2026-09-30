import { CommandEnvelope, EventEnvelope, Revision, Tick, hashString, revisionValue, stableStringify, tickValue } from './types.ts';

export interface CommandHandler<T = unknown> {
  readonly kind: string;
  readonly validate?: (payload: unknown) => payload is T;
  readonly execute: (payload: T, command: CommandEnvelope<T>) => void;
}

export interface EventHandler<T = unknown> {
  readonly kind: string;
  readonly handle: (payload: T, event: EventEnvelope<T>) => void;
}

export interface CommandBusConfig {
  maxCommandsPerTick: number;
  maxEventsPerTick: number;
  sourceId: string;
}

const DEFAULT_CONFIG: CommandBusConfig = {
  maxCommandsPerTick: 512,
  maxEventsPerTick: 1024,
  sourceId: 'local',
};

export class TypedCommandBus {
  readonly #config: CommandBusConfig;
  readonly #commandHandlers = new Map<string, CommandHandler>();
  readonly #eventHandlers = new Map<string, Set<EventHandler>>();
  readonly #commands: CommandEnvelope[] = [];
  readonly #events: EventEnvelope[] = [];
  #sequence = 0;
  #revision: Revision = revisionValue(0);

  constructor(config: Partial<CommandBusConfig> = {}) {
    this.#config = { ...DEFAULT_CONFIG, ...config };
    if (!this.#config.sourceId.trim()) throw new Error('sourceId must not be empty');
  }

  get revision(): Revision { return this.#revision; }
  get commandDepth(): number { return this.#commands.length; }
  get eventDepth(): number { return this.#events.length; }

  registerCommand<T>(handler: CommandHandler<T>): void {
    if (this.#commandHandlers.has(handler.kind)) throw new Error(`Command handler exists: ${handler.kind}`);
    this.#commandHandlers.set(handler.kind, handler as CommandHandler);
  }

  unregisterCommand(kind: string): boolean {
    return this.#commandHandlers.delete(kind);
  }

  onEvent<T>(kind: string, handler: EventHandler<T>): () => void {
    const handlers = this.#eventHandlers.get(kind) ?? new Set<EventHandler>();
    handlers.add(handler as EventHandler);
    this.#eventHandlers.set(kind, handlers);
    return () => handlers.delete(handler as EventHandler);
  }

  enqueue<T>(kind: string, payload: T, tick: Tick, source = this.#config.sourceId): CommandEnvelope<T> {
    if (this.#commands.length >= this.#config.maxCommandsPerTick) throw new Error('Command queue capacity exceeded');
    const sequence = ++this.#sequence;
    const command: CommandEnvelope<T> = {
      id: `${source}:${tick}:${sequence}`,
      tick,
      sequence,
      kind,
      payload,
      source,
      checksum: hashString(stableStringify({ tick, sequence, kind, payload, source })),
    };
    this.#commands.push(command as CommandEnvelope);
    return command;
  }

  /** Compatibility alias used by the kernel scheduler boundary. */
  dispatch<T>(kind: string, payload: T, tick?: Tick, source = this.#config.sourceId): CommandEnvelope<T> {
    return this.enqueue(kind, payload, tick ?? tickValue(0), source);
  }

  publish<T>(kind: string, payload: T, tick: Tick, source = this.#config.sourceId): EventEnvelope<T> {
    if (this.#events.length >= this.#config.maxEventsPerTick) throw new Error('Event queue capacity exceeded');
    const event: EventEnvelope<T> = {
      id: `${source}:event:${tick}:${++this.#sequence}`,
      tick,
      revision: revisionValue(this.#revision + 1),
      kind,
      payload,
      source,
    };
    this.#revision = event.revision;
    this.#events.push(event as EventEnvelope);
    this.#dispatchEvent(event);
    return event;
  }

  processCommands(limit = this.#config.maxCommandsPerTick): number {
    let processed = 0;
    while (this.#commands.length && processed < limit) {
      const command = this.#commands.shift()!;
      const handler = this.#commandHandlers.get(command.kind);
      if (!handler) {
        this.publish('command.rejected', { kind: command.kind, reason: 'handler_not_found' }, command.tick, 'command-bus');
        processed += 1;
        continue;
      }
      if (handler.validate && !handler.validate(command.payload)) {
        this.publish('command.rejected', { kind: command.kind, reason: 'validation_failed' }, command.tick, 'command-bus');
        processed += 1;
        continue;
      }
      handler.execute(command.payload, command);
      processed += 1;
    }
    return processed;
  }

  drainEvents(limit = this.#config.maxEventsPerTick): EventEnvelope[] {
    const count = Math.min(this.#events.length, Math.max(0, Math.floor(limit)));
    return this.#events.splice(0, count);
  }

  replay(commands: readonly CommandEnvelope[], executeRejected = false): number {
    let count = 0;
    for (const command of commands) {
      const handler = this.#commandHandlers.get(command.kind);
      if (!handler) {
        if (executeRejected) this.publish('command.rejected', { kind: command.kind, reason: 'replay_missing_handler' }, command.tick, 'replay');
        continue;
      }
      if (handler.validate && !handler.validate(command.payload)) continue;
      handler.execute(command.payload, command);
      count += 1;
    }
    return count;
  }

  validate(command: CommandEnvelope): boolean {
    const expected = hashString(stableStringify({ tick: command.tick, sequence: command.sequence, kind: command.kind, payload: command.payload, source: command.source }));
    return expected === command.checksum && command.tick >= tickValue(0) && command.sequence > 0;
  }

  clear(): void {
    this.#commands.length = 0;
    this.#events.length = 0;
  }

  snapshot(): { revision: Revision; sequence: number; commands: readonly CommandEnvelope[]; events: readonly EventEnvelope[] } {
    return {
      revision: this.#revision,
      sequence: this.#sequence,
      commands: structuredClone(this.#commands),
      events: structuredClone(this.#events),
    };
  }

  restore(snapshot: { revision: Revision; sequence: number; commands: readonly CommandEnvelope[]; events: readonly EventEnvelope[] }): void {
    this.#revision = snapshot.revision;
    this.#sequence = snapshot.sequence;
    this.#commands.splice(0, this.#commands.length, ...structuredClone(snapshot.commands));
    this.#events.splice(0, this.#events.length, ...structuredClone(snapshot.events));
  }

  #dispatchEvent<T>(event: EventEnvelope<T>): void {
    const handlers = this.#eventHandlers.get(event.kind);
    if (!handlers) return;
    for (const handler of handlers) handler.handle(event.payload, event);
  }
}

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
