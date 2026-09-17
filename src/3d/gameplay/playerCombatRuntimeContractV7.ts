import type { TickId } from '../modern/runtimeContractsV4';
import type { PlayerStateV6 } from '../modern/typedSceneContractsV6';
import {
  PlayerCombatDecisionV6,
  type PlayerCombatContextV6,
  type PlayerCombatDecisionReceiptV6,
  type PlayerCombatPhaseV6,
} from './playerCombatDecisionV6';

export interface PlayerCombatRuntimeFrameV7 {
  readonly version: 7;
  readonly tick: TickId;
  readonly phase: PlayerCombatPhaseV6;
  readonly action: PlayerCombatDecisionReceiptV6['action'] | null;
  readonly animationLocked: boolean;
  readonly locomotionWeight: number;
  readonly hitboxActive: boolean;
  readonly feedback: PlayerCombatDecisionReceiptV6['feedback'];
  readonly lockOnTargetId: string | null;
  readonly stamina01: number;
  readonly health01: number;
  readonly poise01: number;
  readonly checksum: string;
}

const clamp01 = (value: number): number => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
const digest = (value: unknown): string => {
  const text = JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

const freeze = <T extends object>(value: T): Readonly<T> => Object.freeze(value);

export function projectPlayerCombatRuntimeFrameV7(
  player: PlayerStateV6,
  tick: TickId,
  receipt: PlayerCombatDecisionReceiptV6 | null,
): PlayerCombatRuntimeFrameV7 {
  const phase = receipt?.phase ?? 'ready';
  const animationLocked = phase !== 'ready';
  const locomotionWeight = animationLocked ? (phase === 'active' ? 0.1 : 0.35) : 1;
  const frame = {
    version: 7 as const,
    tick,
    phase,
    action: receipt?.action ?? null,
    animationLocked,
    locomotionWeight,
    hitboxActive: receipt?.hitbox.active ?? false,
    feedback: receipt?.feedback ?? null,
    lockOnTargetId: receipt?.lockOn?.targetId ?? receipt?.targetId ?? null,
    stamina01: clamp01(player.maxStamina > 0 ? player.stamina / player.maxStamina : 0),
    health01: clamp01(player.maxHealth > 0 ? player.health / player.maxHealth : 0),
    poise01: clamp01(player.maxPoise > 0 ? player.poise / player.maxPoise : 0),
    checksum: '',
  };
  frame.checksum = digest({ ...frame, checksum: undefined });
  return freeze(frame);
}

export function advancePlayerCombatRuntimeFrameV7(
  decision: PlayerCombatDecisionV6,
  player: PlayerStateV6,
  deltaSeconds: number,
  tick: TickId,
  context: PlayerCombatContextV6 = {},
): PlayerCombatRuntimeFrameV7 {
  const receipt = decision.tick(player, deltaSeconds, tick, context);
  return projectPlayerCombatRuntimeFrameV7(player, tick, receipt);
}

export function submitPlayerCombatRuntimeFrameV7(
  decision: PlayerCombatDecisionV6,
  player: PlayerStateV6,
  action: string,
  tick: TickId,
  context: PlayerCombatContextV6 = {},
): PlayerCombatRuntimeFrameV7 {
  const receipt = decision.submit(action, player, tick, context);
  return projectPlayerCombatRuntimeFrameV7(player, tick, receipt);
}
