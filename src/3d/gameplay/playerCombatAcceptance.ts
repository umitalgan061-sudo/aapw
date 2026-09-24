/** Production TypeScript owner for a deterministic player combat acceptance receipt. */
// @ts-nocheck

const clamp = (value, min, max) => Math.max(min, Math.min(max, Number.isFinite(Number(value)) ? Number(value) : min));
const text = (value, fallback = '') => typeof value === 'string' ? value : fallback;
const freeze = (value) => Object.freeze(value);
const freezeArray = (values) => freeze([...values]);

const STAGES = freeze(['spawn', 'input', 'animation', 'combat', 'equipment']);
const REQUIRED_PHASES = freeze(['idle', 'windup', 'active', 'recovery', 'defense', 'dodge', 'hit-stagger']);

function stageChecks(frame) {
  const equipment = frame?.equipment || {};
  const animation = frame?.animation || {};
  const movement = frame?.movement || {};
  const attack = frame?.attack || {};
  const sockets = frame?.sockets;
  return freeze({
    spawn: Boolean(frame?.version === 1 && frame?.revision >= 0),
    input: Boolean(movement && typeof movement.state === 'string'),
    animation: Boolean(animation && typeof animation.action === 'string' && typeof animation.family === 'string'),
    combat: Boolean(frame?.phase && REQUIRED_PHASES.includes(String(frame.phase)) && attack && typeof attack.kind === 'string'),
    equipment: Boolean(equipment && typeof equipment.mainHandId === 'string' && sockets && typeof sockets === 'object'),
  });
}

function failedStages(checks) {
  return STAGES.filter((stage) => checks[stage] !== true);
}

function buildKey({ checks, phase, attackKind, revision, failed }) {
  return ['v1', revision, phase, attackKind, STAGES.map((stage) => checks[stage] ? '1' : '0').join(''), failed.join(',')].join('|');
}

export function createPlayerCombatAcceptanceReceipt(frame = {}, { expectedPhase = null, requireGrounded = true } = {}) {
  const checks = stageChecks(frame);
  const failed = failedStages(checks);
  const phase = text(frame?.phase, 'idle');
  const attackKind = text(frame?.attack?.kind, 'none');
  const grounded = frame?.movement?.grounded !== false;
  if (requireGrounded && !grounded && !failed.includes('combat')) failed.push('combat');
  if (expectedPhase && phase !== expectedPhase && !failed.includes('combat')) failed.push('combat');
  const normalizedFailed = [...new Set(failed)];
  const passed = normalizedFailed.length === 0;
  const receipt = {
    version: 1,
    revision: Math.max(0, Math.floor(Number(frame?.revision) || 0)),
    phase,
    attackKind,
    grounded,
    stageOrder: STAGES,
    checks,
    failedStages: freezeArray(normalizedFailed),
    passed,
    diagnostics: freeze({
      requiresGrounded: Boolean(requireGrounded),
      expectedPhase: expectedPhase == null ? null : text(expectedPhase),
      staminaRatio: clamp(frame?.movement?.staminaRatio, 0, 1),
      poiseRatio: clamp(frame?.movement?.poiseRatio, 0, 1),
      equipmentSlotsObserved: Object.keys(frame?.equipment || {}).length,
    }),
  };
  receipt.acceptanceKey = buildKey({ checks, phase, attackKind, revision: receipt.revision, failed: normalizedFailed });
  return freeze(receipt);
}

export function isPlayerCombatAcceptanceReceipt(value) {
  if (!value || value.version !== 1 || !Array.isArray(value.stageOrder) || value.stageOrder.join('|') !== STAGES.join('|')) return false;
  if (!value.checks || !value.diagnostics || !Array.isArray(value.failedStages)) return false;
  if (value.failedStages.some((stage) => !STAGES.includes(stage))) return false;
  const recomputed = buildKey({ checks: value.checks, phase: value.phase, attackKind: value.attackKind, revision: value.revision, failed: value.failedStages });
  return value.acceptanceKey === recomputed && Object.isFrozen(value) && Object.isFrozen(value.checks) && Object.isFrozen(value.failedStages);
}
