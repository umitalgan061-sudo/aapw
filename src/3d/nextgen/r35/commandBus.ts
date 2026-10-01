import type { PriorityBand, R35Command } from './contracts';
import { clamp } from './contracts';

export interface CommandContext {
  readonly tick: number;
  readonly receivedAtMs: number;
  readonly replay: boolean;
  readonly signal?: AbortSignal;
}

export interface CommandHandler<T = unknown> {
  readonly type: string;
  readonly validate?: (payload: unknown) => payload is T;
  readonly handle: (command: R35Command & { readonly payload: T }, context: CommandContext) => void | Promise<void>;
}

export interface CommandMiddleware {
  readonly id: string;
  readonly handle: (
    command: R35Command,
    context: CommandContext,
    next: () => Promise<void>,
  ) => void | Promise<void>;
}

export interface QueuedCommand {
  readonly command: R35Command;
  readonly priority: PriorityBand;
  readonly enqueuedAtTick: number;
}

export interface CommandBusStats {
  readonly queued: number;
  readonly processed: number;
  readonly rejected: number;
  readonly duplicates: number;
  readonly failures: number;
  readonly peakQueue: number;
}

const PRIORITY_SCORE: Record<PriorityBand, number> = {
  critical: 100,
  high: 75,
  normal: 50,
  low: 25,
  background: 5,
};

function commandKey(command: R35Command): string {
  return command.entityId + ':' + command.sequence + ':' + command.type;
}

export class R35CommandBus {
  #handlers = new Map<string, CommandHandler<unknown>>();
  #middleware: CommandMiddleware[] = [];
  #queue: QueuedCommand[] = [];
  #seen = new Set<string>();
  #processed = 0;
  #rejected = 0;
  #duplicates = 0;
  #failures = 0;
  #peakQueue = 0;

  register<T>(handler: CommandHandler<T>): () => void {
    if (!handler.type) throw new Error('command handler type is required');
    if (this.#handlers.has(handler.type)) throw new Error('command handler already registered: ' + handler.type);
    this.#handlers.set(handler.type, handler as CommandHandler<unknown>);
    return () => this.#handlers.delete(handler.type);
  }

  use(middleware: CommandMiddleware): () => void {
    if (!middleware.id) throw new Error('middleware id is required');
    if (this.#middleware.some((entry) => entry.id === middleware.id)) throw new Error('middleware already registered');
    this.#middleware.push(middleware);
    return () => {
      this.#middleware = this.#middleware.filter((entry) => entry.id !== middleware.id);
    };
  }

  enqueue(command: R35Command, priority: PriorityBand = 'normal'): boolean {
    const key = commandKey(command);
    if (this.#seen.has(key)) {
      this.#duplicates += 1;
      return false;
    }
    this.#seen.add(key);
    this.#queue.push({
      command: structuredClone(command),
      priority,
      enqueuedAtTick: command.tick,
    });
    this.#peakQueue = Math.max(this.#peakQueue, this.#queue.length);
    return true;
  }

  async dispatchOne(context: CommandContext): Promise<boolean> {
    if (this.#queue.length === 0) return false;
    this.#queue.sort((a, b) => {
      const score = PRIORITY_SCORE[b.priority] - PRIORITY_SCORE[a.priority];
      if (score !== 0) return score;
      if (a.command.tick !== b.command.tick) return a.command.tick - b.command.tick;
      return a.command.sequence - b.command.sequence;
    });
    const entry = this.#queue.shift();
    if (!entry) return false;
    const handler = this.#handlers.get(entry.command.type);
    if (!handler) {
      this.#rejected += 1;
      return true;
    }
    if (handler.validate && !handler.validate(entry.command.payload)) {
      this.#rejected += 1;
      return true;
    }

    const execute = async (index: number): Promise<void> => {
      const middleware = this.#middleware[index];
      if (!middleware) {
        try {
          await (handler.handle as CommandHandler<unknown>['handle'])(
            entry.command as R35Command & { readonly payload: never },
            context,
          );
          this.#processed += 1;
        } catch {
          this.#failures += 1;
        }
        return;
      }
      await middleware.handle(entry.command, context, () => execute(index + 1));
    };

    await execute(0);
    return true;
  }

  async dispatchAvailable(context: CommandContext, maxCommands = Number.POSITIVE_INFINITY): Promise<number> {
    let processed = 0;
    const limit = Number.isFinite(maxCommands) ? Math.max(0, Math.floor(maxCommands)) : Number.POSITIVE_INFINITY;
    while (processed < limit && this.#queue.length > 0) {
      const didDispatch = await this.dispatchOne(context);
      if (!didDispatch) break;
      processed += 1;
    }
    return processed;
  }

  clear(): void {
    this.#queue.length = 0;
    this.#seen.clear();
  }

  forget(entityId: number): void {
    const prefix = entityId + ':';
    for (const key of [...this.#seen]) if (key.startsWith(prefix)) this.#seen.delete(key);
  }

  pending(): readonly QueuedCommand[] {
    return this.#queue
      .slice()
      .sort((a, b) => PRIORITY_SCORE[b.priority] - PRIORITY_SCORE[a.priority])
      .map((entry) => structuredClone(entry));
  }

  stats(): CommandBusStats {
    return {
      queued: this.#queue.length,
      processed: this.#processed,
      rejected: this.#rejected,
      duplicates: this.#duplicates,
      failures: this.#failures,
      peakQueue: this.#peakQueue,
    };
  }
}

export function createCommandContext(tick: number, replay = false, signal?: AbortSignal): CommandContext {
  const base: CommandContext = { tick: Math.max(0, Math.floor(tick)), receivedAtMs: performance.now(), replay };
  return signal === undefined ? Object.freeze(base) : Object.freeze({ ...base, signal });
}

export function validateCommandSequence(command: R35Command, lastSequence: number): boolean {
  return Number.isInteger(command.sequence) && command.sequence > lastSequence && Number.isInteger(command.entityId) && command.entityId > 0;
}

export function commandPriorityFromTick(command: R35Command, currentTick: number): PriorityBand {
  const age = clamp(currentTick - command.tick, 0, 180);
  if (age > 120) return 'critical';
  if (age > 60) return 'high';
  if (age > 20) return 'normal';
  if (age > 5) return 'low';
  return 'background';
}
