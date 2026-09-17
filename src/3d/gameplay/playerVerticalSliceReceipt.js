/**
 * Deterministic integration receipt for the existing player vertical slice.
 *
 * This is an evidence/validation adapter, not a second player or combat framework. Callers feed
 * receipts produced by the existing spawn, input, movement, animation, combat and equipment owners.
 * No Three.js, DOM, timers, scene mutation or material/editor UI ownership lives here.
 */

const STAGES = Object.freeze([
  'spawn',
  'input',
  'movement',
  'animation',
  'combat',
  'equipment',
]);

const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const text = (value, fallback = '') => String(value ?? fallback).trim();

const normalizeStage = (entry, index) => ({
  stage: text(entry?.stage, STAGES[index] ?? 'unknown'),
  accepted: entry?.accepted === true,
  sequence: Math.max(0, Math.floor(finite(entry?.sequence, index))),
  source: text(entry?.source, 'caller'),
  surface: entry?.surface == null ? null : text(entry.surface),
  error: entry?.error == null ? null : text(entry.error),
});

const freezeDeep = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freezeDeep(child);
  return Object.freeze(value);
};

const stableDigest = (stages, context) => {
  const payload = JSON.stringify({
    stages: stages.map(({ stage, accepted, sequence, source, surface, error }) => ({
      stage, accepted, sequence, source, surface, error,
    })),
    context: {
      actorId: text(context?.actorId, 'player'),
      grounded: context?.grounded === true,
      targetId: context?.targetId == null ? null : text(context.targetId),
    },
  });
  let hash = 2166136261;
  for (let index = 0; index < payload.length; index += 1) {
    hash ^= payload.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

export function createPlayerVerticalSliceReceipt({ maxHistory = 8 } = {}) {
  const history = [];
  let disposed = false;
  let serial = 0;

  const record = (entries = [], context = {}) => {
    if (disposed) return Object.freeze({ disposed: true, serial, ok: false, stages: [], digest: null });
    const byStage = new Map(entries.map((entry, index) => {
      const normalized = normalizeStage(entry, index);
      return [normalized.stage, normalized];
    }));
    const stages = STAGES.map((stage, index) => byStage.get(stage) ?? normalizeStage({ stage }, index));
    const acceptedStages = stages.filter((entry) => entry.accepted).length;
    const missingStages = stages.filter((entry) => !entry.accepted).map((entry) => entry.stage);
    const sequenceMonotonic = stages.every((entry, index) => index === 0 || entry.sequence >= stages[index - 1].sequence);
    const result = {
      serial: ++serial,
      ok: acceptedStages === STAGES.length && sequenceMonotonic,
      acceptedStages,
      expectedStages: STAGES.length,
      missingStages,
      sequenceMonotonic,
      actorId: text(context?.actorId, 'player'),
      grounded: context?.grounded === true,
      targetId: context?.targetId == null ? null : text(context.targetId),
      stages,
      digest: stableDigest(stages, context),
    };
    const frozen = freezeDeep(result);
    history.push(frozen);
    const limit = Math.max(1, Math.floor(finite(maxHistory, 8)));
    if (history.length > limit) history.splice(0, history.length - limit);
    return frozen;
  };

  const snapshot = () => Object.freeze({
    disposed,
    serial,
    history: history.map((entry) => entry),
  });

  const reset = () => {
    if (disposed) return false;
    history.length = 0;
    serial = 0;
    return true;
  };

  const dispose = () => {
    disposed = true;
    history.length = 0;
  };

  return Object.freeze({ record, snapshot, reset, dispose });
}

export function validatePlayerVerticalSliceReceipt(receipt) {
  const stages = Array.isArray(receipt?.stages) ? receipt.stages : [];
  const stageNames = stages.map((entry) => entry?.stage);
  const uniqueStageCount = new Set(stageNames).size;
  const ordered = STAGES.every((stage, index) => stageNames[index] === stage);
  const accepted = stages.filter((entry) => entry?.accepted === true).length;
  const sequenceMonotonic = stages.every((entry, index) => index === 0 || Number(entry?.sequence) >= Number(stages[index - 1]?.sequence));
  return Object.freeze({
    ok: receipt?.ok === true
      && stages.length === STAGES.length
      && uniqueStageCount === STAGES.length
      && ordered
      && accepted === STAGES.length
      && sequenceMonotonic
      && typeof receipt?.digest === 'string'
      && receipt.digest.length === 8,
    stageNames,
    accepted,
    sequenceMonotonic,
    digest: receipt?.digest ?? null,
  });
}

export { STAGES };
