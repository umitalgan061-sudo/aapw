import { CommandEnvelope, Tick, WorldSnapshot, hashString, stableStringify, tickValue } from './types.ts';

export interface ReplayLog {
  version: 1;
  seed: number;
  startTick: Tick;
  endTick: Tick;
  commands: readonly CommandEnvelope[];
  checkpoints: readonly WorldSnapshot[];
  digest: number;
}

export class DeterministicReplayRecorder {
  readonly #seed: number;
  readonly #startTick: Tick;
  readonly #commands: CommandEnvelope[] = [];
  readonly #checkpoints: WorldSnapshot[] = [];

  constructor(seed: number, startTick = tickValue(0)) {
    this.#seed = seed | 0;
    this.#startTick = startTick;
  }

  recordCommand(command: CommandEnvelope): void {
    if (command.tick < this.#startTick) throw new Error('Replay command precedes replay start');
    this.#commands.push(structuredClone(command));
  }

  recordCheckpoint(snapshot: WorldSnapshot): void {
    this.#checkpoints.push(structuredClone(snapshot));
  }

  build(endTick: Tick): ReplayLog {
    if (endTick < this.#startTick) throw new Error('Replay end tick precedes start');
    const commands = [...this.#commands].sort(commandOrder);
    const checkpoints = [...this.#checkpoints].sort((a, b) => Number(a.tick) - Number(b.tick));
    const body = { version: 1, seed: this.#seed, startTick: this.#startTick, endTick, commands, checkpoints };
    return { ...body, digest: hashString(stableStringify(body)) };
  }

  clear(): void {
    this.#commands.length = 0;
    this.#checkpoints.length = 0;
  }
}

export interface ReplayVerification {
  valid: boolean;
  reason?: string;
  commandCount: number;
  checkpointCount: number;
  digest: number;
}

export function verifyReplay(log: ReplayLog): ReplayVerification {
  if (log.version !== 1) return { valid: false, reason: 'unsupported_version', commandCount: 0, checkpointCount: 0, digest: 0 };
  if (log.endTick < log.startTick) return { valid: false, reason: 'invalid_range', commandCount: log.commands.length, checkpointCount: log.checkpoints.length, digest: 0 };
  const body = {
    version: log.version,
    seed: log.seed,
    startTick: log.startTick,
    endTick: log.endTick,
    commands: log.commands,
    checkpoints: log.checkpoints,
  };
  const digest = hashString(stableStringify(body));
  if (digest !== log.digest) return { valid: false, reason: 'digest_mismatch', commandCount: log.commands.length, checkpointCount: log.checkpoints.length, digest };
  for (let i = 1; i < log.commands.length; i += 1) {
    if (commandOrder(log.commands[i - 1], log.commands[i]) > 0) return { valid: false, reason: 'command_order', commandCount: log.commands.length, checkpointCount: log.checkpoints.length, digest };
  }
  return { valid: true, commandCount: log.commands.length, checkpointCount: log.checkpoints.length, digest };
}

export function commandOrder(a: CommandEnvelope, b: CommandEnvelope): number {
  return Number(a.tick) - Number(b.tick) || a.sequence - b.sequence || a.id.localeCompare(b.id);
}

export function nearestCheckpoint(log: ReplayLog, tick: Tick): WorldSnapshot | undefined {
  return log.checkpoints.reduce<WorldSnapshot | undefined>((best, candidate) => {
    if (candidate.tick > tick) return best;
    if (!best || candidate.tick > best.tick) return candidate;
    return best;
  }, undefined);
}

export function commandsBetween(log: ReplayLog, fromTick: Tick, toTick: Tick): CommandEnvelope[] {
  return log.commands.filter((command) => command.tick >= fromTick && command.tick <= toTick).sort(commandOrder).map((command) => structuredClone(command));
}
