/**
 * Role-aware decision composition for the living-world stimulus pipeline.
 *
 * It wraps the existing normalizer/memory/salience/arbiter/plan path and adds a bounded role tuning
 * step. It remains side-effect free: callers still own actors and domain execution.
 */

import { createLivingWorldStimulusOrchestrator } from './livingWorldStimulusOrchestrator.js';
import { getLivingWorldRoleProfile, applyRoleTuningToIntentScores } from './livingWorldStimulusRolePolicy.js';
import { enumerateIntentCandidates, scoreLivingWorldIntent, LIVING_WORLD_INTENT_ARBITER_POLICY } from './livingWorldIntentArbiter.js';
import { generateLivingWorldPlan } from './livingWorldPlanGenerator.js';

const freeze = Object.freeze;
const finite = (v, f = 0) => Number.isFinite(Number(v)) ? Number(v) : f;
const clamp = (v, min = 0, max = 1) => Math.min(max, Math.max(min, finite(v, min)));

export const LIVING_WORLD_STIMULUS_DECISION_RUNTIME_POLICY = freeze({
  id: 'living-world-stimulus-decision-runtime-2026-09-v1',
  maxCandidates: 16,
  maxTargets: 4,
});

export function createLivingWorldStimulusDecisionRuntime(options = {}) {
  const base = options.baseRuntime || createLivingWorldStimulusOrchestrator(options);
  let disposed = false;

  function decide(actor = {}, nowSeconds = 0) {
    if (disposed || !actor?.id) return null;
    const safeActor = { ...actor, capabilities: { ...(actor.capabilities || {}) } };
    const snapshot = base.memory.query({}, nowSeconds);
    const observer = safeActor.position || null;
    const stimuli = snapshot.map((stimulus) => ({ ...stimulus, salience: clamp(stimulus.confidence * stimulus.intensity) }));
    const candidates = enumerateIntentCandidates(stimuli, { maxCandidates: LIVING_WORLD_STIMULUS_DECISION_RUNTIME_POLICY.maxCandidates });
    const scored = candidates.map((intent) => ({ intent, score: scoreLivingWorldIntent(intent, stimuli, safeActor, safeActor.capabilities, options.arbiter) }));
    const tuned = applyRoleTuningToIntentScores(scored, safeActor.role || 'unknown');
    const winner = tuned[0] || { intent: 'observe', score: 0 };
    const confidence = clamp(winner.score / 2 + getLivingWorldRoleProfile(safeActor.role).confidenceBias);
    const targetCandidates = stimuli.filter((stimulus) => stimulus.targetId || stimulus.actorId).map((stimulus) => ({
      id: stimulus.targetId || stimulus.actorId,
      kind: stimulus.kind,
      position: stimulus.position,
      score: stimulus.salience,
    })).slice(0, LIVING_WORLD_STIMULUS_DECISION_RUNTIME_POLICY.maxTargets);
    const plan = generateLivingWorldPlan({ intent: winner.intent, confidence, targetCandidates, context: { tick: base.tick, observerPosition: observer, urgency: confidence } });
    return freeze({ actorId: String(safeActor.id), role: String(safeActor.role || 'unknown'), intent: winner.intent, confidence, scores: freeze(tuned.slice(0, LIVING_WORLD_INTENT_ARBITER_POLICY.maxCandidates)), plan });
  }

  function decideMany(actors = [], nowSeconds = 0) {
    const results = [];
    for (const actor of (Array.isArray(actors) ? actors : []).slice(0, 64)) {
      const result = decide(actor, nowSeconds);
      if (result) results.push(result);
    }
    results.sort((a, b) => (b.confidence - a.confidence) || a.actorId.localeCompare(b.actorId));
    return freeze(results);
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
  }

  return freeze({ base, decide, decideMany, dispose, get disposed() { return disposed; } });
}
