import { CommandEnvelope, CommandId, EntityId, Tick, asCommandId, asTick, checksumObject } from './domain.ts';

export interface CommandContext {
  readonly tick: Tick;
  readonly source: EntityId | null;
  readonly signal?: AbortSignal;
}

export interface CommandHandler<T = unknown> {
  readonly type: string;
  readonly validate?: (payload: unknown) => payload is T;
  readonly handle: (command: CommandEnvelope<T>, context: CommandContext) => void | Promise<void>;
}

export interface CommandReceipt {
  readonly id: CommandId;
  readonly tick: Tick;
  readonly type: string;
  readonly accepted: boolean;
  readonly reason?: string;
}

export interface CommandJournalEntry extends CommandReceipt {
  readonly checksum: string;
}

export class CommandBusV5 {
  readonly #handlers = new Map<string, CommandHandler>();
  readonly #journal: CommandJournalEntry[] = [];
  readonly #seen = new Set<CommandId>();
  readonly #queues = new Map<number, CommandEnvelope[]>();
  readonly maxQueueDepth: number;

  constructor(maxQueueDepth = 2048) {
    if (!Number.isInteger(maxQueueDepth) || maxQueueDepth < 1) throw new RangeError('maxQueueDepth must be positive');
    this.maxQueueDepth = maxQueueDepth;
  }

  register<T>(handler: CommandHandler<T>): () => void {
    if (!handler.type.trim()) throw new Error('Command handler type is required');
    if (this.#handlers.has(handler.type)) throw new Error(`Command handler already registered: ${handler.type}`);
    this.#handlers.set(handler.type, handler as CommandHandler);
    return () => this.#handlers.delete(handler.type);
  }

  enqueue<T>(command: CommandEnvelope<T>): CommandReceipt {
    const id = asCommandId(String(command.id));
    if (!id) return this.#reject(command, 'missing-command-id');
    if (this.#seen.has(id)) return this.#reject(command, 'duplicate-command');
    const queue = this.#queues.get(Number(command.tick)) ?? [];
    if (queue.length >= this.maxQueueDepth) return this.#reject(command, 'tick-queue-capacity');
    this.#seen.add(id);
    queue.push({ ...command, id });
    this.#queues.set(Number(command.tick), queue);
    return this.#record({ id, tick: command.tick, type: command.type, accepted: true });
  }

  async drain(tick: Tick, signal?: AbortSignal): Promise<readonly CommandReceipt[]> {
    if (signal?.aborted) return [];
    const queue = this.#queues.get(Number(tick)) ?? [];
    this.#queues.delete(Number(tick));
    const receipts: CommandReceipt[] = [];
    for (const command of queue) {
      if (signal?.aborted) break;
      const handler = this.#handlers.get(command.type);
      if (!handler) {
        receipts.push(this.#record({ id: command.id, tick, type: command.type, accepted: false, reason: 'unknown-command' }));
        continue;
      }
      if (handler.validate && !handler.validate(command.payload)) {
        receipts.push(this.#record({ id: command.id, tick, type: command.type, accepted: false, reason: 'invalid-payload' }));
        continue;
      }
      try {
        await handler.handle(command as never, { tick, source: command.issuer, signal });
        receipts.push(this.#record({ id: command.id, tick, type: command.type, accepted: true }));
      } catch (error) {
        receipts.push(this.#record({
          id: command.id,
          tick,
          type: command.type,
          accepted: false,
          reason: error instanceof Error ? error.message.slice(0, 160) : 'handler-error',
        }));
      }
    }
    return receipts;
  }

  pendingTicks(): readonly Tick[] {
    return [...this.#queues.keys()].sort((a, b) => a - b).map(asTick);
  }

  pendingCount(): number {
    let count = 0;
    for (const queue of this.#queues.values()) count += queue.length;
    return count;
  }

  journal(limit = 256): readonly CommandJournalEntry[] {
    return this.#journal.slice(Math.max(0, this.#journal.length - limit));
  }

  replay(entries: readonly CommandEnvelope[], now: Tick): readonly CommandReceipt[] {
    const receipts: CommandReceipt[] = [];
    for (const command of entries) {
      if (command.tick < now) receipts.push(this.#reject(command, 'historical-command'));
      else receipts.push(this.enqueue(command));
    }
    return receipts;
  }

  clear(): void {
    this.#queues.clear();
    this.#journal.length = 0;
    this.#seen.clear();
  }

  digest(): string {
    return checksumObject(this.#journal.map(({ checksum, ...entry }) => entry));
  }

  private #reject(command: CommandEnvelope, reason: string): CommandReceipt {
    return this.#record({ id: asCommandId(String(command.id)), tick: asTick(Number(command.tick)), type: command.type, accepted: false, reason });
  }

  private #record(receipt: CommandReceipt): CommandJournalEntry {
    const entry: CommandJournalEntry = { ...receipt, checksum: checksumObject(receipt) };
    this.#journal.push(entry);
    if (this.#journal.length > this.maxQueueDepth * 2) this.#journal.splice(0, this.#journal.length - this.maxQueueDepth * 2);
    return entry;
  }
}

export const command = <T>(type: string, payload: T, tick: number, issuer: EntityId | null = null, id?: string): CommandEnvelope<T> => ({
  id: asCommandId(id ?? `${type}:${tick}:${checksumObject(payload)}`),
  tick: asTick(tick),
  issuer,
  type,
  payload,
});

export const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
