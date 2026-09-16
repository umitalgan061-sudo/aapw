import type { Disposable, EntityId, Result, RuntimeErrorInfo, SystemId } from './coreTypes.js';
import { err, ok, stableSort } from './coreTypes.js';

export type CommandSource = 'input' | 'gameplay' | 'network' | 'editor' | 'system' | 'replay';
export interface CommandEnvelope<T = unknown> { readonly id: string; readonly tick: number; readonly source: CommandSource; readonly type: string; readonly actor: EntityId | null; readonly payload: T; readonly priority: number; readonly createdAt: number; readonly expiresAt: number | null; }
export interface CommandHandler<T = unknown> { readonly type: string; readonly priority: number; readonly handle: (command: CommandEnvelope<T>) => Result<unknown>; }
export interface CommandStats { readonly queued: number; readonly executed: number; readonly rejected: number; readonly expired: number; readonly handlers: number; readonly highWaterMark: number; }
export interface CommandBusOptions { readonly maxQueue?: number; readonly maxPerTick?: number; readonly now?: () => number; }
function error(code: string, message: string): RuntimeErrorInfo { return { code, message, recoverable: true }; }

export class CommandRuntime implements Disposable {
  #queue: CommandEnvelope[] = [];
  #handlers = new Map<string, CommandHandler[]>();
  #maxQueue: number;
  #maxPerTick: number;
  #now: () => number;
  #executed = 0;
  #rejected = 0;
  #expired = 0;
  #highWater = 0;
  #disposed = false;

  constructor(options: CommandBusOptions = {}) { this.#maxQueue = Math.max(32, Math.min(8192, Math.trunc(options.maxQueue ?? 1024))); this.#maxPerTick = Math.max(1, Math.min(1024, Math.trunc(options.maxPerTick ?? 256))); this.#now = options.now ?? (() => typeof performance !== 'undefined' ? performance.now() : Date.now()); }

  register<T>(handler: CommandHandler<T>): boolean {
    if (this.#disposed || !handler.type || !handler.handle) return false;
    const handlers = this.#handlers.get(handler.type) ?? [];
    if (handlers.some(item => item.priority === handler.priority)) return false;
    handlers.push(handler as CommandHandler); handlers.sort((a, b) => b.priority - a.priority); this.#handlers.set(handler.type, handlers); return true;
  }

  enqueue<T>(command: CommandEnvelope<T>): Result<void> {
    if (this.#disposed) return err(error('COMMAND_DISPOSED', 'Command runtime is disposed.'));
    if (this.#queue.length >= this.#maxQueue) { this.#rejected += 1; return err(error('COMMAND_BACKPRESSURE', 'Command queue is full.')); }
    if (!command.id || !command.type || !Number.isFinite(command.tick)) { this.#rejected += 1; return err(error('COMMAND_INVALID', 'Command envelope is invalid.')); }
    this.#queue.push(Object.freeze({ ...command, priority: Number.isFinite(command.priority) ? command.priority : 0 }));
    this.#highWater = Math.max(this.#highWater, this.#queue.length);
    return ok(undefined);
  }

  execute(tick: number): readonly Result<unknown>[] {
    if (this.#disposed) return [];
    const now = this.#now();
    const due = this.#queue.filter(command => command.tick <= tick);
    this.#queue = this.#queue.filter(command => command.tick > tick);
    const ordered = stableSort(due, (a, b) => a.tick - b.tick || b.priority - a.priority || String(a.id).localeCompare(String(b.id))).slice(0, this.#maxPerTick);
    const overflow = due.slice(ordered.length);
    this.#queue.unshift(...overflow);
    const results: Result<unknown>[] = [];
    for (const command of ordered) {
      if (command.expiresAt !== null && command.expiresAt < now) { this.#expired += 1; results.push(err(error('COMMAND_EXPIRED', 'Command has expired.'))); continue; }
      const handlers = this.#handlers.get(command.type) ?? [];
      if (!handlers.length) { this.#rejected += 1; results.push(err(error('HANDLER_MISSING', `No handler for ${command.type}.`))); continue; }
      let handled = false;
      let final: Result<unknown> = err(error('COMMAND_REJECTED', 'No handler accepted the command.'));
      for (const handler of handlers) {
        try {
          final = handler.handle(command);
          if (final.ok) { handled = true; break; }
        } catch (cause) { final = err({ ...error('HANDLER_THROW', 'Command handler threw.',), cause }); }
      }
      if (handled) this.#executed += 1; else this.#rejected += 1;
      results.push(final);
    }
    return Object.freeze(results);
  }

  cancel(id: string): boolean { const before = this.#queue.length; this.#queue = this.#queue.filter(command => command.id !== id); return before !== this.#queue.length; }
  clear(): void { this.#queue.length = 0; }
  queue(): readonly CommandEnvelope[] { return Object.freeze(this.#queue.slice()); }
  stats(): CommandStats { return Object.freeze({ queued: this.#queue.length, executed: this.#executed, rejected: this.#rejected, expired: this.#expired, handlers: [...this.#handlers.values()].reduce((sum, values) => sum + values.length, 0), highWaterMark: this.#highWater }); }
  dispose(): void { this.#disposed = true; this.clear(); this.#handlers.clear(); }
}
