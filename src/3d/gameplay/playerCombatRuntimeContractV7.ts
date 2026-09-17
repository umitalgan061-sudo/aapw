import type { TickId } from '../modern/runtimeContractsV4';
import type { PlayerStateV6 } from '../modern/typedSceneContractsV6';
import {
  PlayerCombatDecisionV6,
  PLAYER_COMBAT_ACTIONS_V6,
  type PlayerCombatActionV6,
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
const frameDigest = (frame: PlayerCombatRuntimeFrameV7): string => digest({ ...frame, checksum: undefined });
const isCombatAction = (value: unknown): value is PlayerCombatActionV6 => (
  typeof value === 'string' && (PLAYER_COMBAT_ACTIONS_V6 as readonly string[]).includes(value)
);
const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

const freeze = <T extends object>(value: T): Readonly<T> => Object.freeze(value);

/**
 * Render/input-facing projection over the existing PlayerCombatDecisionV6 authority.
 * It does not own stamina, health, locomotion or hit detection state.
 */
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
    checksum: '',
  };
  frame.checksum = frameDigest(frame);
  return freeze(frame);
}

export function validatePlayerCombatRuntimeFrameV7(frame: PlayerCombatRuntimeFrameV7): boolean {
  const phaseIsValid = frame.phase === 'ready'
    || frame.phase === 'windup'
    || frame.phase === 'active'
    || frame.phase === 'recovery';
  const actionIsValid = frame.action === null || isCombatAction(frame.action);
  const feedbackIsValid = frame.feedback === null || isRecord(frame.feedback);
  const lockOnTargetIsValid = frame.lockOnTargetId === null || typeof frame.lockOnTargetId === 'string';
  const readyShapeIsValid = frame.phase !== 'ready'
    || (frame.action === null
      && frame.animationLocked === false
      && frame.hitboxActive === false
      && frame.locomotionWeight === 1);
  const activeShapeIsValid = frame.phase !== 'active'
    || (frame.action !== null
      && frame.animationLocked === true
      && frame.hitboxActive === true
      && frame.locomotionWeight === 0.1);

  return frame.version === 7
    && Number.isInteger(frame.tick)
    && frame.tick >= 0
    && phaseIsValid
    && actionIsValid
    && typeof frame.animationLocked === 'boolean'
    && Number.isFinite(frame.locomotionWeight)
    && frame.locomotionWeight >= 0
    && frame.locomotionWeight <= 1
    && typeof frame.hitboxActive === 'boolean'
    && feedbackIsValid
    && lockOnTargetIsValid
    && Number.isFinite(frame.stamina01)
    && frame.stamina01 >= 0
    && frame.stamina01 <= 1
    && Number.isFinite(frame.health01)
    && frame.health01 >= 0
    && frame.health01 <= 1
    && readyShapeIsValid
    && activeShapeIsValid
    && typeof frame.checksum === 'string'
    && /^[0-9a-f]{8}$/.test(frame.checksum)
    && frame.checksum === frameDigest(frame);
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
