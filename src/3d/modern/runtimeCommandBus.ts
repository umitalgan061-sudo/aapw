import type { FrameId, Result, UnixMillis } from './types';
import { checksum } from './deterministic';

export type CommandPhase = 'validate' | 'execute' | 'commit' | 'rollback';

export interface CommandContext {
  readonly id: string;
  readonly frame: FrameId;
  readonly timestamp: UnixMillis;
  readonly source: string;
  readonly metadata: Readonly<Record<string, string | number | boolean>>;
}

export interface RuntimeCommand<TPayload = unknown, TResult = unknown> {
  readonly type: string;
  readonly payload: TPayload;
  readonly context?: Partial<CommandContext>;
}

export interface CommandDefinition<TPayload, TResult> {
  readonly type: string;
  readonly validate?: (payload: TPayload, context: CommandContext) => Result<void> | void;
  readonly execute: (payload: TPayload, context: CommandContext) => TResult | Promise<TResult>;
  readonly rollback?: (payload: TPayload, result: TResult, context: CommandContext) => void | Promise<void>;
}

export interface CommandReceipt<TResult> {
  readonly id: string;
  readonly type: string;
  readonly frame: FrameId;
  readonly timestamp: UnixMillis;
  readonly success: boolean;
  readonly result?: TResult;
  readonly errorCode?: string;
  readonly digest: string;
}

export interface CommandMiddleware {
  readonly name: string;
  readonly before?: (command: RuntimeCommand, context: CommandContext) => void | Promise<void>;
  readonly after?: (receipt: CommandReceipt, context: CommandContext) => void | Promise<void>;
  readonly onError?: (error: unknown, command: RuntimeCommand, context: CommandContext) => void | Promise<void>;
}

export interface CommandBusOptions {
  readonly now?: () => UnixMillis;
  readonly maxHistory?: number;
  readonly maxMiddleware?: number;
}

function safeNow(): UnixMillis { return Date.now() as UnixMillis; }

/**
 * Typed command bus for gameplay-side mutations. Commands carry source/frame metadata, pass through
 * deterministic middleware and can be replayed from receipts without exposing mutable engine state.
 */
export class RuntimeCommandBus {
  #now: () => UnixMillis;
  #definitions = new Map<string, CommandDefinition<unknown, unknown>>();
  #middleware: CommandMiddleware[] = [];
  #history: CommandReceipt[] = [];
  #maxHistory: number;
  #sequence = 0;
  #transaction: CommandTransaction | null = null;

  constructor(options: CommandBusOptions = {}) {
    this.#now = options.now ?? safeNow;
    this.#maxHistory = Math.max(32, Math.min(20_000, Math.trunc(options.maxHistory ?? 2048)));
  }

  register<TPayload, TResult>(definition: CommandDefinition<TPayload, TResult>): void {
    if (!definition.type.trim()) throw new Error('Command type must not be empty');
    if (this.#definitions.has(definition.type)) throw new Error(`Command ${definition.type} already registered`);
    this.#definitions.set(definition.type, definition as CommandDefinition<unknown, unknown>);
  }

  unregister(type: string): boolean { return this.#definitions.delete(type); }

  use(middleware: CommandMiddleware): () => void {
    if (this.#middleware.length >= 64) throw new Error('Command middleware limit reached');
    this.#middleware.push(middleware);
    return () => { const index = this.#middleware.indexOf(middleware); if (index >= 0) this.#middleware.splice(index, 1); };
  }

  async dispatch<TPayload, TResult>(command: RuntimeCommand<TPayload, TResult>, defaults: Partial<CommandContext> = {}): Promise<CommandReceipt<TResult>> {
    const definition = this.#definitions.get(command.type) as CommandDefinition<TPayload, TResult> | undefined;
    const timestamp = command.context?.timestamp ?? defaults.timestamp ?? this.#now();
    const context: CommandContext = Object.freeze({
      id: command.context?.id ?? defaults.id ?? `cmd-${timestamp}-${this.#sequence++}`,
      frame: command.context?.frame ?? defaults.frame ?? (0 as FrameId),
      timestamp,
      source: command.context?.source ?? defaults.source ?? 'gameplay',
      metadata: Object.freeze({ ...(defaults.metadata ?? {}), ...(command.context?.metadata ?? {}) }),
    });
    if (!definition) {
      return this.#receipt(command.type, context, false, undefined, 'COMMAND_NOT_REGISTERED');
    }
    try {
      for (const middleware of this.#middleware) await middleware.before?.(command, context);
      const validation = await definition.validate?.(command.payload, context);
      if (validation && !validation.ok) return this.#receipt(command.type, context, false, undefined, validation.error.code);
      const result = await definition.execute(command.payload, context);
      const receipt = this.#receipt(command.type, context, true, result, undefined);
      this.#record(receipt);
      this.#transaction?.record(definition, command.payload, result, context);
      for (const middleware of this.#middleware) await middleware.after?.(receipt, context);
      return receipt as CommandReceipt<TResult>;
    } catch (error) {
      for (const middleware of this.#middleware) await middleware.onError?.(error, command, context);
      const receipt = this.#receipt(command.type, context, false, undefined, 'COMMAND_EXECUTION_FAILED');
      this.#record(receipt);
      return receipt;
    }
  }

  beginTransaction(name = 'transaction'): CommandTransaction {
    if (this.#transaction) throw new Error('Nested command transactions are not supported');
    const transaction = new CommandTransaction(name, this.#now, () => {
      if (this.#transaction === transaction) this.#transaction = null;
    });
    this.#transaction = transaction;
    return transaction;
  }

  history(): readonly CommandReceipt[] { return Object.freeze([...this.#history]); }

  clearHistory(): void { this.#history = []; }

  digest(): string { return checksum(this.#history); }

  registeredCommands(): readonly string[] { return Object.freeze([...this.#definitions.keys()].sort()); }

  #receipt<TResult>(type: string, context: CommandContext, success: boolean, result?: TResult, errorCode?: string): CommandReceipt<TResult> {
    return Object.freeze({
      id: context.id,
      type,
      frame: context.frame,
      timestamp: context.timestamp,
      success,
      ...(success ? { result } : {}),
      ...(errorCode ? { errorCode } : {}),
      digest: checksum({ id: context.id, type, frame: context.frame, success, result: success ? result : undefined, errorCode }),
    });
  }

  #record(receipt: CommandReceipt): void {
    this.#history.push(receipt);
    while (this.#history.length > this.#maxHistory) this.#history.shift();
  }
}

interface ExecutedCommand {
  readonly definition: CommandDefinition<unknown, unknown>;
  readonly payload: unknown;
  readonly result: unknown;
  readonly context: CommandContext;
}

export class CommandTransaction {
  readonly name: string;
  #now: () => UnixMillis;
  #close: () => void;
  #commands: ExecutedCommand[] = [];
  #state: 'open' | 'committed' | 'rolled-back' = 'open';

  constructor(name: string, now: () => UnixMillis, close: () => void) {
    this.name = name;
    this.#now = now;
    this.#close = close;
  }

  record(definition: CommandDefinition<unknown, unknown>, payload: unknown, result: unknown, context: CommandContext): void {
    if (this.#state !== 'open') throw new Error('Transaction is closed');
    this.#commands.push({ definition, payload, result, context });
  }

  async commit(): Promise<Result<{ readonly count: number; readonly timestamp: UnixMillis }>> {
    if (this.#state !== 'open') return { ok: false, error: { code: 'TRANSACTION_CLOSED', message: 'Transaction is already closed', retryable: false } };
    this.#state = 'committed';
    this.#close();
    return { ok: true, value: Object.freeze({ count: this.#commands.length, timestamp: this.#now() }) };
  }

  async rollback(): Promise<Result<{ readonly rolledBack: number }>> {
    if (this.#state !== 'open') return { ok: false, error: { code: 'TRANSACTION_CLOSED', message: 'Transaction is already closed', retryable: false } };
    try {
      for (let index = this.#commands.length - 1; index >= 0; index -= 1) {
        const command = this.#commands[index];
        if (!command?.definition.rollback) continue;
        await command.definition.rollback(command.payload, command.result, command.context);
      }
      this.#state = 'rolled-back';
      this.#close();
      return { ok: true, value: Object.freeze({ rolledBack: this.#commands.length }) };
    } catch (cause) {
      this.#state = 'rolled-back';
      this.#close();
      return { ok: false, error: { code: 'TRANSACTION_ROLLBACK_FAILED', message: String(cause), retryable: false, cause } };
    }
  }

  get size(): number { return this.#commands.length; }
  get state(): CommandTransaction['#state'] { return this.#state; }
}

export interface CommandRateLimiterOptions {
  readonly maxPerSecond?: number;
  readonly burst?: number;
  readonly now?: () => UnixMillis;
}

/** Prevents runaway input, network and automation commands from overwhelming a frame. */
export class CommandRateLimiter {
  readonly maxPerSecond: number;
  readonly burst: number;
  #now: () => UnixMillis;
  #events: number[] = [];

  constructor(options: CommandRateLimiterOptions = {}) {
    this.maxPerSecond = Math.max(1, Math.trunc(options.maxPerSecond ?? 120));
    this.burst = Math.max(1, Math.trunc(options.burst ?? 30));
    this.#now = options.now ?? safeNow;
  }

  allow(count = 1): boolean {
    const now = Number(this.#now());
    const windowStart = now - 1000;
    while (this.#events.length && (this.#events[0] ?? now) < windowStart) this.#events.shift();
    if (this.#events.length + count > this.maxPerSecond + this.burst) return false;
    for (let index = 0; index < count; index += 1) this.#events.push(now);
    return true;
  }

  reset(): void { this.#events = []; }
  usage(): number { return this.#events.length; }
}
