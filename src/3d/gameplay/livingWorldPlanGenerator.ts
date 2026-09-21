// @ts-nocheck
/**
 * Bounded semantic action-plan generator for living-world actors.
 *
 * Converts an intent receipt into a consumer-facing plan. No action is executed here: movement,
 * combat, navigation, dialogue, effects and persistence stay with existing owners.
 */

const freeze = Object.freeze;
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, finite(value, min)));

export const LIVING_WORLD_PLAN_STEPS = freeze([
  'observe', 'orient', 'approach', 'hold', 'engage', 'defend', 'retreat', 'regroup',
  'search', 'shelter', 'assist', 'gather', 'socialize', 'recover', 'idle',
]);

export const LIVING_WORLD_PLAN_GENERATOR_POLICY = freeze({
  id: 'living-world-plan-generator-2026-09-v1',
  maxSteps: 8,
  maxTargetCandidates: 4,
  defaultStepSeconds: 0.4,
  minStepSeconds: 0.08,
  maxStepSeconds: 5,
  defaultPlanTtlSeconds: 8,
  confidenceThreshold: 0.16,
});

const intentPlans = freeze({
  idle: ['observe', 'idle'],
  investigate: ['orient', 'approach', 'observe'],
  alert: ['orient', 'hold', 'observe'],
  regroup: ['orient', 'regroup', 'hold'],
  flee: ['orient', 'retreat', 'retreat'],
  pursue: ['orient', 'approach', 'engage'],
  defend: ['orient', 'defend', 'hold'],
  attack: ['orient', 'approach', 'engage'],
  assist: ['orient', 'approach', 'assist'],
  search: ['orient', 'approach', 'search'],
  retreat: ['orient', 'retreat', 'observe'],
  'seek-shelter': ['orient', 'approach', 'shelter', 'hold'],
  socialize: ['orient', 'approach', 'socialize'],
  gather: ['orient', 'approach', 'gather'],
  patrol: ['orient', 'approach', 'observe'],
  recover: ['hold', 'recover', 'observe'],
  observe: ['orient', 'observe'],
});

function safeTarget(target) {
  if (!target || typeof target !== 'object') return null;
  const id = String(target.id || '').slice(0, 96);
  if (!id) return null;
  const position = target.position && Number.isFinite(Number(target.position.x)) && Number.isFinite(Number(target.position.z))
    ? freeze({ x: Number(target.position.x), y: finite(target.position.y), z: Number(target.position.z) })
    : null;
  return freeze({ id, position, score: clamp(target.score), kind: String(target.kind || 'unknown').slice(0, 32) });
}

function stepsForIntent(intent) {
  return intentPlans[intent] || intentPlans.observe;
}

function makeStep(name, index, context, policy) {
  const urgency = clamp(context.urgency);
  const scale = name === 'engage' || name === 'retreat' ? 1.15 : name === 'observe' ? 0.8 : 1;
  const duration = clamp(policy.defaultStepSeconds * scale * (1.25 - urgency * 0.35), policy.minStepSeconds, policy.maxStepSeconds);
  return freeze({ index, name, durationSeconds: duration, interruptible: !['engage', 'retreat'].includes(name), priority: Math.min(1, urgency + (name === 'observe' ? 0 : 0.1)) });
}

export function generateLivingWorldPlan({ intent = 'observe', confidence = 0, targetCandidates = [], context = {}, options = {} } = {}) {
  const policy = { ...LIVING_WORLD_PLAN_GENERATOR_POLICY, ...(options.policy || {}) };
  const acceptedConfidence = clamp(confidence);
  const normalizedIntent = intentPlans[intent] ? intent : 'observe';
  const targetList = (Array.isArray(targetCandidates) ? targetCandidates : [])
    .map(safeTarget).filter(Boolean).sort((a, b) => (b.score - a.score) || a.id.localeCompare(b.id)).slice(0, policy.maxTargetCandidates);
  const target = targetList[0] || null;
  const rawSteps = stepsForIntent(normalizedIntent);
  const steps = rawSteps.slice(0, policy.maxSteps).map((name, index) => makeStep(name, index, { urgency: context.urgency ?? acceptedConfidence }, policy));
  return freeze({
    planId: `${normalizedIntent}:${target?.id || 'none'}:${Math.round(acceptedConfidence * 1000)}`,
    intent: normalizedIntent,
    confidence: acceptedConfidence,
    target,
    targets: freeze(targetList),
    steps: freeze(steps),
    ttlSeconds: clamp(options.ttlSeconds ?? policy.defaultPlanTtlSeconds, 0.5, 60),
    generatedAtTick: Math.max(0, Math.floor(finite(context.tick))),
    reasonCodes: freeze([
      `intent:${normalizedIntent}`,
      `confidence:${acceptedConfidence.toFixed(3)}`,
      target ? `target:${target.id}` : 'target:none',
    ]),
  });
}

export function planDigest(plan) {
  if (!plan) return '';
  return [plan.intent, plan.target?.id || '-', Number(plan.confidence).toFixed(5), ...(plan.steps || []).map((step) => step.name)].join('|');
}

export function validateLivingWorldPlan(plan) {
  if (!plan || typeof plan !== 'object') return false;
  if (!intentPlans[plan.intent]) return false;
  if (!Array.isArray(plan.steps) || plan.steps.length === 0 || plan.steps.length > LIVING_WORLD_PLAN_GENERATOR_POLICY.maxSteps) return false;
  return plan.steps.every((step) => LIVING_WORLD_PLAN_STEPS.includes(step.name) && Number.isFinite(step.durationSeconds) && step.durationSeconds > 0 && step.durationSeconds <= LIVING_WORLD_PLAN_GENERATOR_POLICY.maxStepSeconds);
}
