/**
 * Fail-safe recovery policy for living-world stimulus orchestration.
 *
 * The policy detects malformed frames, repeated consumer errors, stale stimulus density and budget
 * pressure, then recommends a degradation mode. It never mutates an actor or world owner.
 */

const freeze = Object.freeze;
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, finite(value, min)));

export const LIVING_WORLD_STIMULUS_RECOVERY_POLICY = freeze({
  id: 'living-world-stimulus-recovery-2026-09-v1',
  maxConsumerErrors: 3,
  maxAuditFailures: 2,
  maxBudgetUtilization: 0.9,
  criticalBudgetUtilization: 1,
  maxMemoryUtilization: 0.9,
});

export const LIVING_WORLD_STIMULUS_DEGRADATION_MODES = freeze(['normal', 'reduced', 'severe', 'safe']);

export function assessLivingWorldStimulusHealth({ frame = null, telemetry = null, policy = {} } = {}) {
  const p = { ...LIVING_WORLD_STIMULUS_RECOVERY_POLICY, ...policy };
  const stats = frame?.stats || {};
  const memory = frame?.memory || {};
  const budgetUtilization = clamp((frame?.decisions?.length || 0) / Math.max(1, p.maxPlansPerTick || 12));
  const memoryUtilization = clamp((memory.size || 0) / Math.max(1, memory.maxRecords || 192));
  const consumerErrors = finite(telemetry?.counters?.['consumer.errors'], 0);
  const auditFailures = finite(telemetry?.counters?.['audit.failures'], 0);
  const failures = [];
  if (consumerErrors >= p.maxConsumerErrors) failures.push('consumer-errors');
  if (auditFailures >= p.maxAuditFailures) failures.push('audit-failures');
  if (budgetUtilization >= p.criticalBudgetUtilization) failures.push('budget-critical');
  if (memoryUtilization >= p.maxMemoryUtilization) failures.push('memory-pressure');
  let mode = 'normal';
  if (failures.includes('budget-critical') || failures.includes('consumer-errors')) mode = 'severe';
  else if (failures.length >= 2) mode = 'reduced';
  else if (failures.length === 1) mode = 'reduced';
  if (consumerErrors >= p.maxConsumerErrors * 2 || auditFailures >= p.maxAuditFailures * 2) mode = 'safe';
  return freeze({ mode, failures: freeze(failures), budgetUtilization, memoryUtilization, consumerErrors, auditFailures });
}

export function recoveryRecommendations(health) {
  const mode = LIVING_WORLD_STIMULUS_DEGRADATION_MODES.includes(health?.mode) ? health.mode : 'safe';
  const common = ['reduce non-urgent actor evaluation', 'retain urgent threat/death signals', 'preserve deterministic ordering'];
  if (mode === 'normal') return freeze(['keep current workload budget', 'maintain full salience resolution']);
  if (mode === 'reduced') return freeze([...common, 'increase actor reevaluation interval']);
  if (mode === 'severe') return freeze([...common, 'halve non-urgent work budget', 'suppress repeated consumer delivery']);
  return freeze([...common, 'allow observation-only fallback', 'disable optional downstream presentation requests']);
}

export function validateRecoveryHealth(health) {
  return Boolean(health && LIVING_WORLD_STIMULUS_DEGRADATION_MODES.includes(health.mode) && Array.isArray(health.failures) && Number.isFinite(health.budgetUtilization));
}
