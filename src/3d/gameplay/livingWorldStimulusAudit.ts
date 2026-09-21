// @ts-nocheck
/**
 * Audit and deterministic digest utilities for the stimulus orchestration pipeline.
 */

const freeze = Object.freeze;

function text(value) { return String(value ?? '').slice(0, 160); }
function number(value) { return Number.isFinite(Number(value)) ? Number(value) : 0; }

export function livingWorldStimulusDigest(frame) {
  if (!frame) return '';
  const decisions = Array.isArray(frame.decisions) ? frame.decisions : [];
  const parts = [`tick=${number(frame.tick)}`, `now=${number(frame.nowSeconds).toFixed(4)}`];
  const ordered = [...decisions].sort((a, b) => text(a.actorId).localeCompare(text(b.actorId)));
  for (const entry of ordered) {
    parts.push([
      text(entry.actorId),
      text(entry.decision?.intent),
      number(entry.decision?.confidence).toFixed(6),
      text(entry.plan?.target?.id),
      ...(entry.plan?.steps || []).map((step) => text(step.name)),
    ].join(':'));
  }
  return parts.join('|');
}

export function auditLivingWorldStimulusFrame(frame, options = {}) {
  const failures = [];
  const decisions = Array.isArray(frame?.decisions) ? frame.decisions : [];
  const maxPlans = Math.max(1, number(options.maxPlansPerTick) || 12);
  if (!Number.isFinite(number(frame?.tick)) || number(frame?.tick) < 0) failures.push('invalid-tick');
  if (decisions.length > maxPlans) failures.push('plan-budget-exceeded');
  const seenActors = new Set();
  for (const decision of decisions) {
    const actorId = text(decision?.actorId);
    if (!actorId) failures.push('missing-actor-id');
    if (seenActors.has(actorId)) failures.push(`duplicate-actor:${actorId}`);
    seenActors.add(actorId);
    if (!decision?.decision?.intent) failures.push(`missing-intent:${actorId}`);
    const confidence = number(decision?.decision?.confidence);
    if (confidence < 0 || confidence > 1) failures.push(`invalid-confidence:${actorId}`);
    const steps = decision?.plan?.steps || [];
    if (!steps.length || steps.length > 8) failures.push(`invalid-plan:${actorId}`);
    for (const step of steps) {
      if (!(number(step.durationSeconds) > 0 && number(step.durationSeconds) <= 5)) failures.push(`invalid-step:${actorId}`);
    }
  }
  return freeze({ valid: failures.length === 0, failures: freeze(failures), digest: livingWorldStimulusDigest(frame), decisionCount: decisions.length });
}

export function compareStimulusFrames(a, b) {
  const left = livingWorldStimulusDigest(a);
  const right = livingWorldStimulusDigest(b);
  return freeze({ equal: left === right, left, right });
}

export function reorderInvariantStimuliDigest(orchestratorFactory, inputs) {
  const run = (values) => {
    const runtime = orchestratorFactory();
    const result = runtime.tickOnce({ deltaSeconds: 0.2, nowSeconds: 1.2, actors: values.actors, signals: values.signals });
    const digest = livingWorldStimulusDigest(result);
    runtime.dispose?.();
    return digest;
  };
  const first = run(inputs);
  const reordered = {
    ...inputs,
    signals: [...(inputs?.signals || [])].reverse(),
    actors: [...(inputs?.actors || [])].reverse(),
  };
  const second = run(reordered);
  return freeze({ equal: first === second, first, second });
}
