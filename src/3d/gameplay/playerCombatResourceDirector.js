const clamp01 = (value) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
const finite = (value, fallback = 0) => (Number.isFinite(value) ? value : fallback);

/**
 * Pure combat-resource projection for the existing player/combat owner.
 * It owns no scene objects and does not replace health.js or action routing.
 */
export function createPlayerCombatResourceDirector(options = {}) {
  const maxHealth = Math.max(1, finite(options.maxHealth, 100));
  const maxStamina = Math.max(1, finite(options.maxStamina, 100));
  const maxPoise = Math.max(1, finite(options.maxPoise, 100));
  const staminaRegenPerSecond = Math.max(0, finite(options.staminaRegenPerSecond, 22));
  const poiseRecoveryPerSecond = Math.max(0, finite(options.poiseRecoveryPerSecond, 18));
  const state = {
    health: maxHealth,
    stamina: maxStamina,
    poise: maxPoise,
    guard: false,
    invulnerable: false,
    exhausted: false,
    lastAction: 'idle',
  };

  function snapshot() {
    return Object.freeze({
      health: state.health,
      healthRatio: clamp01(state.health / maxHealth),
      stamina: state.stamina,
      staminaRatio: clamp01(state.stamina / maxStamina),
      poise: state.poise,
      poiseRatio: clamp01(state.poise / maxPoise),
      guard: state.guard,
      invulnerable: state.invulnerable,
      exhausted: state.exhausted,
      lastAction: state.lastAction,
    });
  }

  function spendStamina(cost, action = 'action') {
    const safeCost = Math.max(0, finite(cost));
    if (state.stamina + 1e-9 < safeCost || state.exhausted) return false;
    state.stamina = Math.max(0, state.stamina - safeCost);
    state.exhausted = state.stamina <= 0;
    state.lastAction = action;
    return true;
  }

  function setGuard(active) {
    state.guard = Boolean(active) && !state.exhausted;
    state.lastAction = state.guard ? 'block' : 'idle';
    return snapshot();
  }

  function applyDamage(amount, poiseDamage = 0) {
    if (state.invulnerable) return { applied: false, staggered: false, state: snapshot() };
    const damage = Math.max(0, finite(amount));
    const guardMitigation = state.guard ? 0.35 : 1;
    state.health = Math.max(0, state.health - damage * guardMitigation);
    state.poise = Math.max(0, state.poise - Math.max(0, finite(poiseDamage)));
    const staggered = state.poise <= 0;
    if (staggered) state.guard = false;
    state.lastAction = staggered ? 'stagger' : 'hit';
    return { applied: damage > 0, staggered, state: snapshot() };
  }

  function update(deltaSeconds, { moving = false, sprinting = false } = {}) {
    const delta = Math.max(0, finite(deltaSeconds));
    const regenMultiplier = state.guard || sprinting ? 0.35 : moving ? 0.65 : 1;
    state.stamina = Math.min(maxStamina, state.stamina + staminaRegenPerSecond * delta * regenMultiplier);
    state.poise = Math.min(maxPoise, state.poise + poiseRecoveryPerSecond * delta);
    if (state.exhausted && state.stamina >= maxStamina * 0.2) state.exhausted = false;
    return snapshot();
  }

  function setInvulnerable(active) {
    state.invulnerable = Boolean(active);
    return snapshot();
  }

  return Object.freeze({ snapshot, spendStamina, setGuard, applyDamage, update, setInvulnerable });
}
