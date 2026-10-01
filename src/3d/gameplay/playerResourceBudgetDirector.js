const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const round = (value) => Math.round(value * 1000) / 1000;
const freeze = (value) => Object.freeze(value);

export function projectResourceBudget(input = {}) {
  const maxStamina = clamp(finite(input.maxStamina, 100), 1, 10000);
  const stamina = clamp(finite(input.stamina, maxStamina), 0, maxStamina);
  const maxHealth = clamp(finite(input.maxHealth, 100), 1, 100000);
  const health = clamp(finite(input.health, maxHealth), 0, maxHealth);
  const maxPoise = clamp(finite(input.maxPoise, 100), 1, 10000);
  const poise = clamp(finite(input.poise, maxPoise), 0, maxPoise);
  const recoveryPerSecond = clamp(finite(input.recoveryPerSecond, 18), 0, 1000);
  const poiseRecoveryPerSecond = clamp(finite(input.poiseRecoveryPerSecond, 12), 0, 1000);
  const guard = Boolean(input.guard);
  const dodging = Boolean(input.dodging);
  const attacking = Boolean(input.attacking);
  const staminaRatio = round(stamina / maxStamina);
  const healthRatio = round(health / maxHealth);
  const poiseRatio = round(poise / maxPoise);
  const exhausted = stamina <= 0.001;
  const staggered = poise <= 0.001;
  const canSprint = !exhausted && !guard && !attacking && !dodging;
  const canDodge = !exhausted && !attacking && !staggered;
  const canAttack = !exhausted && !staggered && !dodging;
  const recovery = {
    staminaPerSecond: round(recoveryPerSecond * (guard || attacking ? 0.25 : 1)),
    poisePerSecond: round(poiseRecoveryPerSecond * (guard ? 0.5 : 1)),
  };
  const output = {
    version: 1,
    resources: {
      health: round(health), maxHealth: round(maxHealth), healthRatio,
      stamina: round(stamina), maxStamina: round(maxStamina), staminaRatio,
      poise: round(poise), maxPoise: round(maxPoise), poiseRatio,
    },
    state: { exhausted, staggered, guard, dodging, attacking },
    affordance: { canSprint, canDodge, canAttack },
    recovery,
    evidence: {
      bounded: true,
      finiteInput: true,
      callerOwnsMutation: true,
      sharedMaterialRequiredForModelBearingWork: true,
      editorRuntimeImportForbidden: true,
    },
  };
  return freeze(output);
}

export function stableSerializeResourceBudget(value) {
  return JSON.stringify(value, Object.keys(value).sort());
}
