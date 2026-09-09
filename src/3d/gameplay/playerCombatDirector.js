/**
 * Additive player/combat state seam.
 *
 * This is intentionally a pure state adapter, not a second player framework: the existing
 * player, input, animation, physics, equipment, and EventBus owners remain authoritative.
 * A caller can use this to make stamina/poise/combo decisions deterministic before applying
 * movement, hitbox, animation, VFX, or equipment side effects in its owning module.
 */

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export const PLAYER_COMBAT_PHASES = Object.freeze({
  neutral: 'neutral',
  attack: 'attack',
  block: 'block',
  dodge: 'dodge',
  stagger: 'stagger',
});

export function createPlayerCombatDirector({ maxStamina = 100, maxPoise = 100 } = {}) {
  const state = {
    phase: PLAYER_COMBAT_PHASES.neutral,
    comboIndex: 0,
    stamina: maxStamina,
    poise: maxPoise,
    queuedAction: null,
    maxStamina,
    maxPoise,
  };

  return {
    getState: () => ({ ...state }),
    queueAction(action) {
      state.queuedAction = action || null;
      return state.queuedAction;
    },
    begin(action, { staminaCost = 0, phase = PLAYER_COMBAT_PHASES.attack } = {}) {
      if (staminaCost > state.stamina) return false;
      state.stamina = clamp(state.stamina - staminaCost, 0, maxStamina);
      state.phase = phase;
      state.comboIndex = action === 'light' ? (state.comboIndex % 3) + 1 : 0;
      state.queuedAction = null;
      return true;
    },
    receivePoiseDamage(amount = 0) {
      state.poise = clamp(state.poise - Math.max(0, amount), 0, maxPoise);
      if (state.poise === 0) state.phase = PLAYER_COMBAT_PHASES.stagger;
      return state.poise;
    },
    recover(deltaSeconds = 0, { staminaPerSecond = 18, poisePerSecond = 24 } = {}) {
      if (state.phase === PLAYER_COMBAT_PHASES.neutral) {
        state.stamina = clamp(state.stamina + Math.max(0, deltaSeconds) * staminaPerSecond, 0, maxStamina);
        state.poise = clamp(state.poise + Math.max(0, deltaSeconds) * poisePerSecond, 0, maxPoise);
      }
      return state.stamina;
    },
    endPhase() {
      state.phase = PLAYER_COMBAT_PHASES.neutral;
      return state.phase;
    },
    reset() {
      state.phase = PLAYER_COMBAT_PHASES.neutral;
      state.comboIndex = 0;
      state.stamina = maxStamina;
      state.poise = maxPoise;
      state.queuedAction = null;
    },
  };
}
