import type { RuntimeCommand, WorldStateSnapshot } from './types.ts';
import { clamp, finite, stableJson } from './math.ts';

export interface RollbackBufferConfig {
  readonly snapshotCapacity: number;
  readonly commandCapacity: number;
  readonly maxReplayTicks: number;
}

export interface RollbackFrame {
  readonly tick: number;
  readonly world: WorldStateSnapshot;
  readonly commands: readonly RuntimeCommand[];
  readonly checksum: string;
}

const DEFAULT_CONFIG: RollbackBufferConfig = Object.freeze({
  snapshotCapacity: 120,
  commandCapacity: 4096,
  maxReplayTicks: 240,
});

export interface RollbackPlan {
  readonly fromTick: number;
  readonly toTick: number;
  readonly replayCommands: readonly RuntimeCommand[];
  readonly snapshot: WorldStateSnapshot | null;
  readonly accepted: boolean;
  readonly reason: string;
}

export class RollbackBufferR37 {
  readonly config: RollbackBufferConfig;
  #frames: RollbackFrame[] = [];
  #commands: RuntimeCommand[] = [];

  constructor(config: Partial<RollbackBufferConfig> = {}) {
    this.config = Object.freeze({
      ...DEFAULT_CONFIG,
      ...config,
      snapshotCapacity: Math.max(2, Math.trunc(finite(config.snapshotCapacity, DEFAULT_CONFIG.snapshotCapacity))),
      commandCapacity: Math.max(32, Math.trunc(finite(config.commandCapacity, DEFAULT_CONFIG.commandCapacity))),
      maxReplayTicks: Math.max(1, Math.trunc(finite(config.maxReplayTicks, DEFAULT_CONFIG.maxReplayTicks))),
    });
  }

  push(frame: Omit<RollbackFrame, 'checksum'>): void {
    const normalized = Object.freeze({
      ...frame,
      tick: Math.max(0, Math.trunc(frame.tick)),
      commands: Object.freeze([...frame.commands]),
      checksum: stableJson(frame.world),
    });
    const previous = this.#frames.at(-1);
    if (previous && normalized.tick < previous.tick) throw new RangeError('rollback frames must be monotonic');
    const existing = this.#frames.findIndex((item) => item.tick === normalized.tick);
    if (existing >= 0) this.#frames[existing] = normalized;
    else this.#frames.push(normalized);
    while (this.#frames.length > this.config.snapshotCapacity) this.#frames.shift();
  }

  recordCommand(command: RuntimeCommand): void {
    this.#commands.push(Object.freeze(command));
    while (this.#commands.length > this.config.commandCapacity) this.#commands.shift();
  }

  plan(fromTick: number, toTick: number): RollbackPlan {
    const from = Math.max(0, Math.trunc(finite(fromTick)));
    const to = Math.max(0, Math.trunc(finite(toTick)));
    if (to > from) {
      return Object.freeze({
        fromTick: from,
        toTick: to,
        replayCommands: Object.freeze([]),
        snapshot: null,
        accepted: false,
        reason: 'forward-rollback-is-invalid',
      });
    }
    const distance = from - to;
    if (distance > this.config.maxReplayTicks) {
      return Object.freeze({
        fromTick: from,
        toTick: to,
        replayCommands: Object.freeze([]),
        snapshot: null,
        accepted: false,
        reason: 'replay-window-exceeded',
      });
    }
    const snapshot = this.#frames.findLast((frame) => frame.tick <= to)?.world ?? null;
    if (!snapshot) {
      return Object.freeze({
        fromTick: from,
        toTick: to,
        replayCommands: Object.freeze([]),
        snapshot: null,
        accepted: false,
        reason: 'no-authoritative-snapshot',
      });
    }
    const replayCommands = this.#commands.filter((command) => command.tick > snapshot.tick && command.tick <= from);
    return Object.freeze({
      fromTick: from,
      toTick: to,
      replayCommands: Object.freeze(replayCommands),
      snapshot,
      accepted: true,
      reason: 'rollback-plan-ready',
    });
  }

  frameAtOrBefore(tick: number): RollbackFrame | undefined {
    const normalized = Math.max(0, Math.trunc(finite(tick)));
    return this.#frames.findLast((frame) => frame.tick <= normalized);
  }

  frames(): readonly RollbackFrame[] { return Object.freeze([...this.#frames]); }
  commands(): readonly RuntimeCommand[] { return Object.freeze([...this.#commands]); }

  trimBefore(tick: number): void {
    const normalized = Math.max(0, Math.trunc(finite(tick)));
    this.#frames = this.#frames.filter((frame) => frame.tick >= normalized);
    this.#commands = this.#commands.filter((command) => command.tick >= normalized);
  }

  clear(): void {
    this.#frames = [];
    this.#commands = [];
  }

  coverage(): number {
    const first = this.#frames.at(0)?.tick ?? 0;
    const last = this.#frames.at(-1)?.tick ?? 0;
    return clamp(last - first, 0, this.config.maxReplayTicks);
  }
}
