import type { PlayerCombatRuntimeFrameV7 } from './playerCombatRuntimeContractV7';

const deepFreeze = <T>(value: T): T => {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Reflect.ownKeys(value as object).forEach((key) => {
    const child = (value as Record<PropertyKey, unknown>)[key];
    deepFreeze(child);
  });
  return Object.freeze(value);
};

/**
 * Freezes the runtime handoff transitively so feedback payloads and lock-on
 * metadata cannot be mutated after projection. The existing combat decision
 * remains authoritative; this is a consumer-safety adapter only.
 */
export function freezePlayerCombatRuntimeFrameV7(
  frame: PlayerCombatRuntimeFrameV7,
): Readonly<PlayerCombatRuntimeFrameV7> {
  return deepFreeze(frame);
}

export function isPlayerCombatRuntimeFrameDeeplyFrozenV7(
  frame: PlayerCombatRuntimeFrameV7,
): boolean {
  const visit = (value: unknown): boolean => {
    if (value === null || typeof value !== 'object') return true;
    if (!Object.isFrozen(value)) return false;
    return Reflect.ownKeys(value).every((key) => visit((value as Record<PropertyKey, unknown>)[key]));
  };
  return visit(frame);
}
