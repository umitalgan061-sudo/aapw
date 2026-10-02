
import type { CommandEnvelope, CommandKind, CommandReceipt } from './types.ts';
import { stableHash, finite } from './types.ts';

export interface CommandInput {
  readonly tick: number;
  readonly sequence?: number;
  readonly entityId: string;
  readonly kind: CommandKind;
  readonly source?: string;
  readonly payload?: Readonly<Record<string, unknown>>;
}

export interface CommandPipelineOptions {
  readonly maxPerTick?: number;
  readonly maxHistory?: number;
  readonly futureTickWindow?: number;
  readonly pastTickWindow?: number;
  readonly burst?: number;
  readonly maxPayloadBytes?: number;
}

interface RateBucket {
  tick: number;
  count: number;
}

export class CommandRateLimiterR41 {
  readonly burst: number;
  #buckets = new Map<string, RateBucket>();

  constructor(burst = 24) {
    this.burst = Math.max(1, Math.trunc(burst));
  }

  allow(source: string, tick: number): boolean {
    const key = source || 'anonymous';
    const current = this.#buckets.get(key);
    if (!current || current.tick !== tick) {
      this.#buckets.set(key, { tick, count: 1 });
      return true;
    }
    if (current.count >= this.burst) return false;
    current.count += 1;
    return true;
  }

  clear(): void { this.#buckets.clear(); }
}

export class CommandPipelineR41 {
  readonly maxPerTick: number;
  readonly maxHistory: number;
  readonly futureTickWindow: number;
  readonly pastTickWindow: number;
  readonly maxPayloadBytes: number;
  readonly limiter: CommandRateLimiterR41;

  #commands: CommandEnvelope[] = [];
  #receipts: CommandReceipt[] = [];
  #byTick = new Map<number, CommandEnvelope[]>();
  #seen = new Set<string>();

  constructor(options: CommandPipelineOptions = {}) {
    this.maxPerTick = Math.max(1, Math.trunc(options.maxPerTick ?? 128));
    this.maxHistory = Math.max(this.maxPerTick * 2, Math.trunc(options.maxHistory ?? 2048));
    this.futureTickWindow = Math.max(0, Math.trunc(options.futureTickWindow ?? 8));
    this.pastTickWindow = Math.max(0, Math.trunc(options.pastTickWindow ?? 2));
    this.maxPayloadBytes = Math.max(512, Math.trunc(options.maxPayloadBytes ?? 16384));
    this.limiter = new CommandRateLimiterR41(options.burst ?? 24);
  }

  dispatch(input: CommandInput, currentTick: number): CommandReceipt {
    const tick = Math.trunc(finite(input.tick));
    const source = sanitizeText(input.source ?? 'anonymous', 64) || 'anonymous';
    const entityId = sanitizeText(input.entityId, 128);
    const id = createCommandId(input, source, entityId);
    const base: CommandReceipt = Object.freeze({ id, sequence: 0, accepted: false, reason: 'accepted' });

    if (!entityId) return this.recordReceipt(Object.freeze({ ...base, reason: 'invalid-payload' }));
    if (tick < currentTick - this.pastTickWindow || tick > currentTick + this.futureTickWindow) {
      return this.recordReceipt(Object.freeze({ ...base, reason: 'invalid-tick' }));
    }
    if (!this.limiter.allow(source, currentTick)) {
      return this.recordReceipt(Object.freeze({ ...base, reason: 'rate-limited' }));
    }
    if (this.#seen.has(id)) {
      return this.recordReceipt(Object.freeze({ ...base, reason: 'duplicate' }));
    }

    const payloadResult = sanitizePayload(input.payload ?? {}, this.maxPayloadBytes);
    if (!payloadResult.accepted) return this.recordReceipt(Object.freeze({ ...base, reason: 'invalid-payload' }));

    const bucket = this.#byTick.get(tick) ?? [];
    if (bucket.length >= this.maxPerTick) {
      return this.recordReceipt(Object.freeze({ ...base, reason: 'capacity' }));
    }

    const last = this.#commands[this.#commands.length - 1];
    const sequence = (last?.sequence ?? 0) + 1;
    const command: CommandEnvelope = Object.freeze({
      id,
      tick,
      sequence,
      entityId,
      kind: input.kind,
      source,
      payload: payloadResult.value,
    });
    this.#commands.push(command);
    bucket.push(command);
    this.#byTick.set(tick, bucket);
    this.#seen.add(id);

    while (this.#commands.length > this.maxHistory) {
      const removed = this.#commands.shift();
      if (removed) this.#seen.delete(removed.id);
    }

    return this.recordReceipt(Object.freeze({ id, sequence, accepted: true, reason: 'accepted' }));
  }

  commandsForTick(tick: number): readonly CommandEnvelope[] {
    return Object.freeze([...(this.#byTick.get(Math.trunc(tick)) ?? [])]);
  }

  commandsThroughTick(tick: number): readonly CommandEnvelope[] {
    const target = Math.trunc(tick);
    return Object.freeze(this.#commands.filter(command => command.tick <= target));
  }

  history(): readonly CommandEnvelope[] {
    return Object.freeze([...this.#commands]);
  }

  receipts(): readonly CommandReceipt[] {
    return Object.freeze([...this.#receipts]);
  }

  rejectStale(currentTick: number): number {
    const threshold = currentTick - this.pastTickWindow;
    const stale = this.#commands.filter(command => command.tick < threshold);
    if (!stale.length) return 0;
    const staleIds = new Set(stale.map(command => command.id));
    this.#commands = this.#commands.filter(command => !staleIds.has(command.id));
    for (const [tick, values] of this.#byTick.entries()) {
      const next = values.filter(command => !staleIds.has(command.id));
      if (next.length) this.#byTick.set(tick, next);
      else this.#byTick.delete(tick);
    }
    for (const id of staleIds) this.#seen.delete(id);
    return stale.length;
  }

  clearBeforeTick(tick: number): number {
    const target = Math.trunc(tick);
    let removed = 0;
    for (const [bucketTick, values] of this.#byTick.entries()) {
      if (bucketTick >= target) continue;
      removed += values.length;
      this.#byTick.delete(bucketTick);
      for (const command of values) this.#seen.delete(command.id);
    }
    this.#commands = this.#commands.filter(command => command.tick >= target);
    return removed;
  }

  clear(): void {
    this.#commands = [];
    this.#receipts = [];
    this.#byTick.clear();
    this.#seen.clear();
    this.limiter.clear();
  }

  digest(): number {
    return stableHash(this.#commands.map(command => [
      command.sequence, command.tick, command.id, command.kind, command.entityId, command.payload,
    ]));
  }

  beginTransaction(id: string, createdTick: number): CommandTransactionR41 {
    return new CommandTransactionR41(this, sanitizeText(id, 96), Math.trunc(createdTick));
  }

  snapshot(): {
    readonly commands: readonly CommandEnvelope[];
    readonly receipts: readonly CommandReceipt[];
    readonly digest: number;
  } {
    return Object.freeze({
      commands: this.history(),
      receipts: this.receipts(),
      digest: this.digest(),
    });
  }

  private recordReceipt(receipt: CommandReceipt): CommandReceipt {
    this.#receipts.push(receipt);
    if (this.#receipts.length > this.maxHistory) this.#receipts.shift();
    return receipt;
  }
}

export class CommandTransactionR41 {
  readonly id: string;
  readonly createdTick: number;
  #pipeline: CommandPipelineR41;
  #commands: CommandInput[] = [];
  #committed = false;

  constructor(pipeline: CommandPipelineR41, id: string, createdTick: number) {
    this.#pipeline = pipeline;
    this.id = id;
    this.createdTick = createdTick;
  }

  add(command: CommandInput): this {
    if (this.#committed) throw new Error('R41 transaction already committed');
    this.#commands.push(Object.freeze({ ...command }));
    return this;
  }

  size(): number { return this.#commands.length; }

  commit(currentTick: number): readonly CommandReceipt[] {
    if (this.#committed) throw new Error('R41 transaction already committed');
    this.#committed = true;
    return Object.freeze(this.#commands.map(command => this.#pipeline.dispatch(command, currentTick)));
  }
}

function createCommandId(input: CommandInput, source: string, entityId: string): string {
  return 'r41:' + stableHash([
    Math.trunc(input.tick),
    Math.trunc(input.sequence ?? 0),
    entityId,
    input.kind,
    source,
    input.payload ?? {},
  ]).toString(16);
}

function sanitizeText(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/[\\u0000-\\u001F\\u007F]/g, '').slice(0, maxLength);
}

function sanitizePayload(
  payload: Readonly<Record<string, unknown>>,
  maxBytes: number,
): { readonly accepted: true; readonly value: Readonly<Record<string, unknown>> } | { readonly accepted: false } {
  try {
    const json = JSON.stringify(payload);
    if (json.length > maxBytes) return { accepted: false };
    const clone = JSON.parse(json) as Record<string, unknown>;
    return { accepted: true, value: Object.freeze(clone) };
  } catch {
    return { accepted: false };
  }
}
