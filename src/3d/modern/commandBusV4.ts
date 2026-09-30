import {
  type CommandEnvelopeV4,
  type CommandId,
  type CommandResultV4,
  type RuntimeErrorV4,
  type RuntimeSourceV4,
  type TickId,
  type TraceId,
  commandId,
  createRuntimeErrorV4,
  failV4,
  okV4,
  type OutcomeV4,
} from './runtimeContractsV4';

export interface CommandHandlerV4<TPayload = unknown, TResult = unknown> {
  readonly type: string;
  readonly validate?: (payload: TPayload) => boolean;
  readonly handle: (command: CommandEnvelopeV4<TPayload>) => TResult | Promise<TResult>;
}

export interface CommandMiddlewareV4 {
  readonly name: string;
  readonly before?: (command: CommandEnvelopeV4) => void | Promise<void>;
  readonly after?: (command: CommandEnvelopeV4, result: CommandResultV4) => void | Promise<void>;
}

export interface CommandBusOptionsV4 {
  readonly now?: () => number;
  readonly maxQueue?: number;
  readonly maxHistory?: number;
  readonly defaultTtlMs?: number;
}

export interface CommandRecordV4 {
  readonly id: CommandId;
  readonly trace: TraceId;
  readonly type: string;
  readonly source: RuntimeSourceV4;
  readonly tick: TickId;
  readonly acceptedAt: number;
  readonly completedAt: number;
  readonly durationMs: number;
  readonly applied: boolean;
  readonly errorCode: string | null;
}

export interface CommandBusMetricsV4 {
  readonly accepted: number;
  readonly rejected: number;
  readonly applied: number;
  readonly failed: number;
  readonly expired: number;
  readonly dropped: number;
  readonly queued: number;
  readonly handlers: number;
}

interface PendingCommandV4 {
  readonly priority: number;
  readonly sequence: number;
  readonly command: CommandEnvelopeV4;
  resolve: (result: CommandResultV4) => void;
}

const safePriority = (value: number | undefined): number => Number.isFinite(value) ? Math.trunc(value) : 0;
const safeString = (value: unknown, fallback: string): string => typeof value === 'string' && value.length > 0 ? value : fallback;

export class CommandBusV4 {
  #now: () => number;
  #maxQueue: number;
  #maxHistory: number;
  #defaultTtlMs: number;
  #handlers = new Map<string, CommandHandlerV4>();
  #middleware: CommandMiddlewareV4[] = [];
  #queue: PendingCommandV4[] = [];
  #history: CommandRecordV4[] = [];
  #sequence = 0;
  #metrics = {
    accepted: 0,
    rejected: 0,
    applied: 0,
    failed: 0,
    expired: 0,
    dropped: 0,
  };
  #draining = false;

  constructor(options: CommandBusOptionsV4 = {}) {
    this.#now = options.now ?? (() => performance.now());
    this.#maxQueue = Math.max(16, Math.trunc(options.maxQueue ?? 1024));
    this.#maxHistory = Math.max(32, Math.trunc(options.maxHistory ?? 512));
    this.#defaultTtlMs = Math.max(0, Math.trunc(options.defaultTtlMs ?? 5000));
  }

  register<TPayload = unknown, TResult = unknown>(handler: CommandHandlerV4<TPayload, TResult>): void {
    const normalizedType = safeString(handler.type, 'invalid');
    if (normalizedType === 'invalid') throw new Error('Command handler type is required');
    if (this.#handlers.has(normalizedType)) throw new Error(`Command handler already registered: ${normalizedType}`);
    this.#handlers.set(normalizedType, handler as CommandHandlerV4);
  }

  replace<TPayload = unknown, TResult = unknown>(handler: CommandHandlerV4<TPayload, TResult>): void {
    const normalizedType = safeString(handler.type, 'invalid');
    if (normalizedType === 'invalid') throw new Error('Command handler type is required');
    this.#handlers.set(normalizedType, handler as CommandHandlerV4);
  }

  unregister(type: string): boolean {
    return this.#handlers.delete(type);
  }

  use(middleware: CommandMiddlewareV4): void {
    if (!middleware.name.trim()) throw new Error('Middleware name is required');
    if (this.#middleware.some((entry) => entry.name === middleware.name)) throw new Error(`Middleware already registered: ${middleware.name}`);
    this.#middleware.push(middleware);
  }

  clearMiddleware(): void {
    this.#middleware.length = 0;
  }

  has(type: string): boolean {
    return this.#handlers.has(type);
  }

  get size(): number {
    return this.#queue.length;
  }

  metrics(): CommandBusMetricsV4 {
    return Object.freeze({ ...this.#metrics, queued: this.#queue.length, handlers: this.#handlers.size });
  }

  history(): readonly CommandRecordV4[] {
    return Object.freeze(this.#history.slice());
  }

  dispatch<TPayload = unknown, TResult = unknown>(
    type: string,
    payload: TPayload,
    source: RuntimeSourceV4,
    tick: TickId,
    trace: TraceId,
    options: { readonly priority?: number; readonly ttlMs?: number; readonly now?: number } = {},
  ): Promise<CommandResultV4<TResult>> {
    const handler = this.#handlers.get(type) as CommandHandlerV4<TPayload, TResult> | undefined;
    if (!handler) {
      this.#metrics.rejected += 1;
      return Promise.resolve({ accepted: false, applied: false, error: createRuntimeErrorV4('COMMAND_UNKNOWN', `Unknown command: ${type}`, false, source, trace) });
    }
    if (handler.validate && !handler.validate(payload)) {
      this.#metrics.rejected += 1;
      return Promise.resolve({ accepted: false, applied: false, error: createRuntimeErrorV4('COMMAND_INVALID', `Invalid payload for ${type}`, false, source, trace) });
    }
    if (this.#queue.length >= this.#maxQueue) {
      this.#evictForPriority(safePriority(options.priority));
      if (this.#queue.length >= this.#maxQueue) {
        this.#metrics.dropped += 1;
        return Promise.resolve({ accepted: false, applied: false, error: createRuntimeErrorV4('COMMAND_QUEUE_FULL', 'Command queue is full', true, source, trace) });
      }
    }
    const now = options.now ?? this.#now();
    const ttl = Math.max(0, Math.trunc(options.ttlMs ?? this.#defaultTtlMs));
    const command: CommandEnvelopeV4<TPayload> = Object.freeze({
      id: commandId(`${Math.trunc(now)}-${this.#sequence + 1}`),
      trace,
      tick,
      source,
      type,
      payload,
      createdAt: now,
      expiresAt: ttl === 0 ? null : now + ttl,
    });
    this.#metrics.accepted += 1;
    return new Promise<CommandResultV4<TResult>>((resolve) => {
      this.#queue.push({ priority: safePriority(options.priority), sequence: this.#sequence++, command, resolve: resolve as (result: CommandResultV4) => void });
      this.#sortQueue();
      void this.drain();
    });
  }

  async drain(limit = Number.POSITIVE_INFINITY): Promise<number> {
    if (this.#draining) return 0;
    this.#draining = true;
    let applied = 0;
    try {
      while (this.#queue.length > 0 && applied < limit) {
        const pending = this.#queue.shift();
        if (!pending) break;
        const result = await this.#execute(pending);
        pending.resolve(result as CommandResultV4);
        if (result.applied) applied += 1;
      }
      return applied;
    } finally {
      this.#draining = false;
    }
  }

  flushRejected(reason = 'Command bus flushed'): number {
    let count = 0;
    while (this.#queue.length) {
      const pending = this.#queue.shift()!;
      pending.resolve({ accepted: false, applied: false, error: createRuntimeErrorV4('COMMAND_FLUSHED', reason, true, pending.command.source, pending.command.trace) });
      this.#metrics.dropped += 1;
      count += 1;
    }
    return count;
  }

  async dispatchSyncLike<TPayload = unknown, TResult = unknown>(
    type: string,
    payload: TPayload,
    source: RuntimeSourceV4,
    tick: TickId,
    trace: TraceId,
  ): Promise<OutcomeV4<TResult>> {
    const result = await this.dispatch<TPayload, TResult>(type, payload, source, tick, trace, { priority: 100 });
    return result.applied && result.value !== undefined ? okV4(result.value) : failV4(result.error ?? createRuntimeErrorV4('COMMAND_NOT_APPLIED', `Command ${type} was not applied`, true, source, trace));
  }

  pruneHistory(maxAgeMs: number): number {
    const cutoff = this.#now() - Math.max(0, maxAgeMs);
    const before = this.#history.length;
    this.#history = this.#history.filter((record) => record.completedAt >= cutoff);
    return before - this.#history.length;
  }

  reset(): void {
    this.flushRejected('Command bus reset');
    this.#history.length = 0;
    this.#sequence = 0;
    this.#metrics = { accepted: 0, rejected: 0, applied: 0, failed: 0, expired: 0, dropped: 0 };
  }

  #sortQueue(): void {
    this.#queue.sort((a, b) => b.priority - a.priority || a.sequence - b.sequence);
  }

  #evictForPriority(priority: number): void {
    let candidate = -1;
    let candidatePriority = Number.POSITIVE_INFINITY;
    let candidateSequence = Number.POSITIVE_INFINITY;
    for (let index = 0; index < this.#queue.length; index += 1) {
      const item = this.#queue[index]!;
      if (item.priority < candidatePriority || (item.priority === candidatePriority && item.sequence < candidateSequence)) {
        candidate = index;
        candidatePriority = item.priority;
        candidateSequence = item.sequence;
      }
    }
    if (candidate >= 0 && candidatePriority <= priority) {
      const [evicted] = this.#queue.splice(candidate, 1);
      if (evicted) {
        evicted.resolve({ accepted: false, applied: false, error: createRuntimeErrorV4('COMMAND_EVICTED', 'Lower-priority command evicted', true, evicted.command.source, evicted.command.trace) });
        this.#metrics.dropped += 1;
      }
    }
  }

  async #execute<TPayload, TResult>(pending: PendingCommandV4): Promise<CommandResultV4<TResult>> {
    const command = pending.command as CommandEnvelopeV4<TPayload>;
    const handler = this.#handlers.get(command.type) as CommandHandlerV4<TPayload, TResult> | undefined;
    const start = this.#now();
    let result: CommandResultV4<TResult>;
    if (!handler) {
      this.#metrics.failed += 1;
      result = { accepted: false, applied: false, error: createRuntimeErrorV4('COMMAND_UNREGISTERED', `Handler removed for ${command.type}`, false, command.source, command.trace) };
    } else if (command.expiresAt !== null && start > command.expiresAt) {
      this.#metrics.expired += 1;
      result = { accepted: false, applied: false, error: createRuntimeErrorV4('COMMAND_EXPIRED', `Command expired: ${command.type}`, true, command.source, command.trace) };
    } else {
      try {
        for (const middleware of this.#middleware) await middleware.before?.(command);
        const value = await handler.handle(command);
        result = { accepted: true, applied: true, value };
        this.#metrics.applied += 1;
        for (let index = this.#middleware.length - 1; index >= 0; index -= 1) await this.#middleware[index]!.after?.(command, result);
      } catch (cause) {
        this.#metrics.failed += 1;
        const error: RuntimeErrorV4 = createRuntimeErrorV4('COMMAND_HANDLER_FAILED', this.#sanitizeError(cause), true, command.source, command.trace);
        result = { accepted: true, applied: false, error };
        for (let index = this.#middleware.length - 1; index >= 0; index -= 1) await this.#middleware[index]!.after?.(command, result);
      }
    }
    const completedAt = this.#now();
    this.#history.push(Object.freeze({
      id: command.id,
      trace: command.trace,
      type: command.type,
      source: command.source,
      tick: command.tick,
      acceptedAt: command.createdAt,
      completedAt,
      durationMs: Math.max(0, completedAt - start),
      applied: result.applied,
      errorCode: result.error?.code ?? null,
    }));
    while (this.#history.length > this.#maxHistory) this.#history.shift();
    return result;
  }

  #sanitizeError(cause: unknown): string {
    if (cause instanceof Error && cause.message) return cause.message.slice(0, 300);
    if (typeof cause === 'string') return cause.slice(0, 300);
    return 'Command handler failed';
  }
}

export function commandBusErrorV4(error: unknown): RuntimeErrorV4 {
  return createRuntimeErrorV4('COMMAND_BUS_ERROR', error instanceof Error ? error.message : 'Command bus error', true);
}
