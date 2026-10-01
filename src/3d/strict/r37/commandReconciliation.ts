import type { RuntimeCommand, WorldStateSnapshot } from './types.ts';
import { RollbackBufferR37 } from './rollbackBuffer.ts';
import { stableJson } from './math.ts';

export interface ReconciliationResult {
  readonly accepted: boolean;
  readonly authoritativeTick: number;
  readonly localTick: number;
  readonly replayedCommands: number;
  readonly checksum: string;
  readonly reason: string;
}

export interface CommandReconcilerConfig {
  readonly maxPredictionTicks: number;
  readonly maxCommandsPerTick: number;
}

export class CommandReconcilerR37 {
  readonly config: CommandReconcilerConfig;
  readonly rollback: RollbackBufferR37;

  constructor(config: Partial<CommandReconcilerConfig> = {}) {
    this.config = Object.freeze({
      maxPredictionTicks: Math.max(1, Math.trunc(Number(config.maxPredictionTicks ?? 120))),
      maxCommandsPerTick: Math.max(1, Math.trunc(Number(config.maxCommandsPerTick ?? 96))),
    });
    this.rollback = new RollbackBufferR37({ maxReplayTicks: this.config.maxPredictionTicks });
  }

  recordState(snapshot: WorldStateSnapshot, commands: readonly RuntimeCommand[]): void {
    this.rollback.push({ tick: snapshot.tick, world: snapshot, commands });
    for (const command of commands.slice(0, this.config.maxCommandsPerTick)) this.rollback.recordCommand(command);
  }

  reconcile(authoritative: WorldStateSnapshot, local: WorldStateSnapshot, localCommands: readonly RuntimeCommand[]): ReconciliationResult {
    const checksumEqual = stableJson(authoritative) === stableJson(local);
    if (checksumEqual) {
      return Object.freeze({
        accepted: true,
        authoritativeTick: authoritative.tick,
        localTick: local.tick,
        replayedCommands: 0,
        checksum: stableJson(authoritative),
        reason: 'state-already-converged',
      });
    }
    if (authoritative.tick > local.tick) {
      return Object.freeze({
        accepted: false,
        authoritativeTick: authoritative.tick,
        localTick: local.tick,
        replayedCommands: 0,
        checksum: stableJson(authoritative),
        reason: 'authoritative-state-is-in-the-future',
      });
    }
    const plan = this.rollback.plan(local.tick, authoritative.tick);
    if (!plan.accepted) {
      return Object.freeze({
        accepted: false,
        authoritativeTick: authoritative.tick,
        localTick: local.tick,
        replayedCommands: 0,
        checksum: stableJson(authoritative),
        reason: plan.reason,
      });
    }
    const replayed = localCommands.filter((command) => command.tick > authoritative.tick && command.tick <= local.tick);
    return Object.freeze({
      accepted: true,
      authoritativeTick: authoritative.tick,
      localTick: local.tick,
      replayedCommands: replayed.length,
      checksum: stableJson(authoritative),
      reason: 'authoritative-state-applied',
    });
  }

  prune(beforeTick: number): void {
    this.rollback.trimBefore(beforeTick);
  }

  reset(): void {
    this.rollback.clear();
  }
}
