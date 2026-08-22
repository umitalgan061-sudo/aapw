const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

/**
 * Returns the bounded forward distance an attack may commit during this frame.
 * Only windup/active time contributes; recovery is stationary. The remaining
 * budget prevents long frames or repeated updates from exceeding authored reach.
 */
export function computeAttackCommitStep({
  previousElapsedSeconds,
  nextElapsedSeconds,
  activeEndSeconds,
  totalCommitMeters,
  remainingCommitMeters,
}) {
  const previous = Math.max(0, Number(previousElapsedSeconds) || 0);
  const next = Math.max(previous, Number(nextElapsedSeconds) || 0);
  const activeEnd = Math.max(0, Number(activeEndSeconds) || 0);
  const total = Math.max(0, Number(totalCommitMeters) || 0);
  const remaining = clamp(Number(remainingCommitMeters) || 0, 0, total);
  if (!(activeEnd > 0) || !(total > 0) || !(remaining > 0) || next <= previous) return 0;

  const committedTime = Math.max(0, Math.min(next, activeEnd) - Math.min(previous, activeEnd));
  if (!(committedTime > 0)) return 0;
  const authoredStep = total * (committedTime / activeEnd);
  return Math.min(remaining, authoredStep);
}

export function attackCommitBudget(baseMeters, comboStep, comboBonusPerStep = 0.08) {
  const base = Math.max(0, Number(baseMeters) || 0);
  const step = Math.max(1, Math.floor(Number(comboStep) || 1));
  const bonus = Math.max(0, Number(comboBonusPerStep) || 0);
  return base * (1 + (step - 1) * bonus);
}
