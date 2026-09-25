import { resolvePlayerEquipmentTransition } from './playerEquipmentCombatRules.ts';

const finite = (value: unknown, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export function buildPlayerEquipmentAnimationHandoff(previousEquipment: unknown = {}, nextEquipment: unknown = {}, state: Record<string, unknown> = {}) {
  const transition = resolvePlayerEquipmentTransition(previousEquipment, nextEquipment, {
    movementState: typeof state.movementState === 'string' ? state.movementState : 'idle',
    attackKind: state.attackKind === 'heavy' ? 'heavy' : state.attackKind === 'light' ? 'light' : 'none',
    comboStep: Math.max(0, Math.floor(finite(state.comboStep, 0))),
    speedMps: Math.max(0, finite(state.speedMps, 0)),
    grounded: state.grounded !== false,
  });
  const hardReset = Boolean(transition.animation?.hardReset);
  const crossfadeSeconds = clamp(finite(transition.animation?.crossfadeSeconds, 0.18), 0.08, 0.45);
  const socketsToRefresh = Object.freeze(Array.isArray(transition.socketsToRefresh) ? [...transition.socketsToRefresh].sort() : []);
  const signature = [transition.weaponChanged, transition.handednessChanged, transition.rangedChanged, hardReset, socketsToRefresh.join(','), crossfadeSeconds.toFixed(3)].join('|');
  return Object.freeze({
    version: 1,
    changed: Boolean(transition.changed),
    changedSlots: Object.freeze([...(transition.changedSlots ?? [])]),
    socketsToRefresh,
    animation: Object.freeze({
      fromFamily: transition.animation?.fromFamily ?? 'unknown',
      toFamily: transition.animation?.toFamily ?? 'unknown',
      hardReset,
      preserveLocomotion: Boolean(transition.animation?.preserveLocomotion) && !hardReset,
      crossfadeSeconds,
      action: transition.animation?.action ?? 'idle',
    }),
    signature,
  });
}

export function isPlayerEquipmentAnimationHandoff(value: unknown): boolean {
  return Boolean(value && typeof value === 'object' && (value as any).version === 1
    && typeof (value as any).signature === 'string'
    && Array.isArray((value as any).changedSlots)
    && Array.isArray((value as any).socketsToRefresh)
    && typeof (value as any).animation?.crossfadeSeconds === 'number');
}
