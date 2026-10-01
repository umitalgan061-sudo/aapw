import type { CommandKind, RuntimeCommand, RuntimeEvent } from './types.ts';
import { clamp, finite, hashString, stableJson } from './math.ts';

export interface CommandBusConfig {
  readonly historyCapacity: number;
  readonly maxCommandsPerTick: number;
  readonly maxPayloadKeys: number;
  readonly maxStringLength: number;
}

const DEFAULT_CONFIG: CommandBusConfig = Object.freeze({
  historyCapacity: 512,
  maxCommandsPerTick: 96,
  maxPayloadKeys: 32,
  maxStringLength: 256,
});

export interface CommandReceipt {
  readonly accepted: boolean;
  readonly command: RuntimeCommand;
  readonly reason?: string;
}

export class CommandBusR37 {
  readonly config: CommandBusConfig;
  #sequence = 0;
  #commands: RuntimeCommand[] = [];
  #events: RuntimeEvent[] = [];
  #listeners = new Set<(event: RuntimeEvent) => void>();

  constructor(config: Partial<CommandBusConfig> = {}) {
    this.config = Object.freeze({
      ...DEFAULT_CONFIG,
      ...config,
      historyCapacity: Math.max(32, Math.trunc(finite(config.historyCapacity, DEFAULT_CONFIG.historyCapacity))),
      maxCommandsPerTick: Math.max(1, Math.trunc(finite(config.maxCommandsPerTick, DEFAULT_CONFIG.maxCommandsPerTick))),
      maxPayloadKeys: Math.max(1, Math.trunc(finite(config.maxPayloadKeys, DEFAULT_CONFIG.maxPayloadKeys))),
      maxStringLength: Math.max(16, Math.trunc(finite(config.maxStringLength, DEFAULT_CONFIG.maxStringLength))),
    });
  }

  onEvent(listener: (event: RuntimeEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  dispatch(input: Omit<RuntimeCommand, 'id' | 'sequence'>): CommandReceipt {
    const tick = Math.max(0, Math.trunc(finite(input.tick)));
    const commandsThisTick = this.#commands.filter((command) => command.tick === tick).length;
    const command: RuntimeCommand = Object.freeze({
      ...input,
      id: `r37-${tick}-${this.#sequence + 1}-${hashString(input.kind)}`,
      tick,
      source: sanitizeString(input.source, this.config.maxStringLength),
      payload: sanitizePayload(input.payload, this.config),
      sequence: ++this.#sequence,
    });
    if (commandsThisTick >= this.config.maxCommandsPerTick) {
      return Object.freeze({ accepted: false, command, reason: 'per-tick-command-budget-exceeded' });
    }
    this.#commands.push(command);
    this.#trim(this.#commands);
    return Object.freeze({ accepted: true, command });
  }

  emit(tick: number, type: string, source: string, payload: Readonly<Record<string, unknown>> = {}): RuntimeEvent {
    const event: RuntimeEvent = Object.freeze({
      id: `event-${Math.max(0, Math.trunc(tick))}-${this.#events.length + 1}-${hashString(type)}`,
      tick: Math.max(0, Math.trunc(tick)),
      type: sanitizeString(type, this.config.maxStringLength),
      source: sanitizeString(source, this.config.maxStringLength),
      payload: sanitizePayload(payload, this.config),
    });
    this.#events.push(event);
    this.#trim(this.#events);
    for (const listener of this.#listeners) listener(event);
    return event;
  }

  commandsForTick(tick: number): readonly RuntimeCommand[] {
    const normalized = Math.max(0, Math.trunc(finite(tick)));
    return Object.freeze(this.#commands.filter((command) => command.tick === normalized));
  }

  commandsBetween(startTick: number, endTick: number): readonly RuntimeCommand[] {
    const lo = Math.min(startTick, endTick);
    const hi = Math.max(startTick, endTick);
    return Object.freeze(this.#commands.filter((command) => command.tick >= lo && command.tick <= hi));
  }

  recentCommands(limit = 64): readonly RuntimeCommand[] {
    const count = clamp(Math.trunc(finite(limit, 64)), 0, this.#commands.length);
    return Object.freeze(this.#commands.slice(-count));
  }

  recentEvents(limit = 64): readonly RuntimeEvent[] {
    const count = clamp(Math.trunc(finite(limit, 64)), 0, this.#events.length);
    return Object.freeze(this.#events.slice(-count));
  }

  checksum(tick?: number): string {
    const source = tick === undefined ? this.#commands : this.commandsForTick(tick);
    return stableJson(source.map((command) => ({
      id: command.id,
      tick: command.tick,
      kind: command.kind,
      source: command.source,
      payload: command.payload,
      sequence: command.sequence,
    })));
  }

  clearBefore(tick: number): void {
    this.#commands = this.#commands.filter((command) => command.tick >= tick);
    this.#events = this.#events.filter((event) => event.tick >= tick);
  }

  #trim<T>(values: T[]): void {
    if (values.length > this.config.historyCapacity) {
      values.splice(0, values.length - this.config.historyCapacity);
    }
  }
}

function sanitizeString(value: unknown, maxLength: number): string {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, maxLength);
}

function sanitizePayload(payload: Readonly<Record<string, unknown>>, config: CommandBusConfig): Readonly<Record<string, unknown>> {
  const entries = Object.entries(payload).slice(0, config.maxPayloadKeys);
  const normalized: Record<string, unknown> = {};
  for (const [key, value] of entries) {
    const safeKey = sanitizeString(key, 80);
    normalized[safeKey] = normalizeValue(value, config.maxStringLength, 0);
  }
  return Object.freeze(normalized);
}

function normalizeValue(value: unknown, maxStringLength: number, depth: number): unknown {
  if (depth > 4) return null;
  if (typeof value === 'string') return value.slice(0, maxStringLength);
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean' || value === null) return value;
  if (Array.isArray(value)) return value.slice(0, 64).map((item) => normalizeValue(item, maxStringLength, depth + 1));
  if (value && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    return Object.fromEntries(Object.entries(source).slice(0, 32).map(([k, v]) => [
      sanitizeString(k, 80),
      normalizeValue(v, maxStringLength, depth + 1),
    ]));
  }
  return null;
}

export function isCommandKind(value: unknown): value is CommandKind {
  return typeof value === 'string' && ['move', 'look', 'jump', 'attack', 'guard', 'dodge', 'interact', 'equip', 'unequip', 'use', 'pause', 'resume', 'teleport', 'custom'].includes(value);
}
