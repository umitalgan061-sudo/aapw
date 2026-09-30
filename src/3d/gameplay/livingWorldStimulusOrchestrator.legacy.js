/**
 * Living-world stimulus orchestration runtime.
 *
 * This is a composition layer over existing perception/reaction/faction/fauna owners. It ingests
 * external signals, normalizes them, keeps bounded temporal memory, ranks salience, arbitrates a
 * semantic intent, and produces a short-lived consumer plan. It does not move actors or mutate
 * world state. All timing is supplied by the caller for deterministic replay.
 */

import { normalizeLivingWorldStimulusBatch, validateNormalizedStimulus } from './livingWorldStimulusNormalizer.js';
import { createLivingWorldStimulusMemory } from './livingWorldStimulusMemory.js';
import { rankLivingWorldStimuli, summarizeSalience } from './livingWorldStimulusSalience.js';
import { arbitrateLivingWorldIntent, validateIntentDecision } from './livingWorldIntentArbiter.js';
import { generateLivingWorldPlan, validateLivingWorldPlan } from './livingWorldPlanGenerator.js';

const freeze = Object.freeze;
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, finite(value, min)));

export const LIVING_WORLD_STIMULUS_ORCHESTRATOR_POLICY = freeze({
  id: 'living-world-stimulus-orchestrator-2026-09-v1',
  maxSignalsPerTick: 48,
  maxPlansPerTick: 12,
  maxActorsPerTick: 64,
  defaultDecisionIntervalSeconds: 0.12,
  maxDecisionIntervalSeconds: 2,
  minDecisionIntervalSeconds: 0.04,
  planCooldownSeconds: 0.25,
  failureCooldownSeconds: 0.5,
  historySize: 32,
});

function actorPosition(actor) {
  if (!actor?.position) return null;
  const x = finite(actor.position.x, NaN);
  const y = finite(actor.position.y, 0);
  const z = finite(actor.position.z, NaN);
  return [x, z].every(Number.isFinite) ? { x, y, z } : null;
}

function sanitizeActor(actor, index) {
  if (!actor || typeof actor !== 'object') return null;
  const id = String(actor.id || `actor-${index}`).slice(0, 96);
  return freeze({
    id,
    position: actorPosition(actor),
    staminaRatio: clamp(actor.staminaRatio, 0, 1),
    healthRatio: clamp(actor.healthRatio, 0, 1),
    currentIntent: typeof actor.currentIntent === 'string' ? actor.currentIntent.slice(0, 48) : null,
    inCombat: Boolean(actor.inCombat),
    defeated: Boolean(actor.defeated),
    nearHome: Boolean(actor.nearHome),
    isProtected: Boolean(actor.isProtected),
    capabilities: freeze({
      canAttack: actor.capabilities?.canAttack !== false,
      canAssist: actor.capabilities?.canAssist !== false,
      canGather: actor.capabilities?.canGather !== false,
      canSocialize: actor.capabilities?.canSocialize !== false,
      canShelter: actor.capabilities?.canShelter !== false,
      canPursue: actor.capabilities?.canPursue !== false,
    }),
  });
}

export function createLivingWorldStimulusOrchestrator(options = {}) {
  const policy = freeze({ ...LIVING_WORLD_STIMULUS_ORCHESTRATOR_POLICY, ...(options.policy || {}) });
  const memory = createLivingWorldStimulusMemory({ policy: options.memoryPolicy });
  const latestPlans = new Map();
  const lastDecisions = new Map();
  const history = [];
  let disposed = false;
  let tick = 0;
  let revision = 0;
  let acceptedSignals = 0;
  let rejectedSignals = 0;
  let generatedPlans = 0;
  let failedDecisions = 0;

  function ingest(signals, nowSeconds = 0) {
    if (disposed) return freeze({ accepted: 0, rejected: 0, revision });
    const batch = normalizeLivingWorldStimulusBatch(signals).slice(0, policy.maxSignalsPerTick);
    let accepted = 0;
    for (const signal of batch) {
      if (validateNormalizedStimulus(signal) && memory.accept(signal, nowSeconds)) {
        accepted += 1;
        acceptedSignals += 1;
      } else {
        rejectedSignals += 1;
      }
    }
    revision += 1;
    return freeze({ accepted, rejected: batch.length - accepted, revision });
  }

  function chooseStimuli(actor, nowSeconds) {
    const ranked = rankLivingWorldStimuli(memory.query({}, nowSeconds), {
      observerPosition: actor.position,
    }, options.salience);
    return ranked.slice(0, policy.maxSignalsPerTick).map((entry) => ({ ...entry.stimulus, salience: entry.score }));
  }

  function canReplan(actorId, nowSeconds, confidence) {
    const previous = lastDecisions.get(actorId);
    if (!previous) return true;
    const elapsed = Math.max(0, nowSeconds - previous.atSeconds);
    const threshold = previous.intent === 'idle' && confidence > previous.confidence
      ? policy.planCooldownSeconds * 0.5
      : policy.planCooldownSeconds;
    return elapsed >= threshold;
  }

  function decideActor(actor, nowSeconds = tick * policy.defaultDecisionIntervalSeconds) {
    if (disposed) return null;
    const safeActor = sanitizeActor(actor, 0);
    if (!safeActor) return null;
    const stimuli = chooseStimuli(safeActor, nowSeconds);
    const salience = summarizeSalience(rankLivingWorldStimuli(stimuli, { observerPosition: safeActor.position }, options.salience));
    const decision = arbitrateLivingWorldIntent({
      stimuli,
      state: safeActor,
      capabilities: safeActor.capabilities,
      options: options.arbiter,
    });
    if (!validateIntentDecision(decision)) {
      failedDecisions += 1;
      return null;
    }
    if (!canReplan(safeActor.id, nowSeconds, decision.confidence)) return latestPlans.get(safeActor.id) || null;
    const targetCandidates = stimuli.filter((stimulus) => stimulus.targetId || stimulus.actorId).map((stimulus) => ({
      id: stimulus.targetId || stimulus.actorId,
      kind: stimulus.kind,
      position: stimulus.position,
      score: stimulus.salience,
    }));
    const plan = generateLivingWorldPlan({
      intent: decision.intent,
      confidence: decision.confidence,
      targetCandidates,
      context: { tick, urgency: salience.max },
      options: options.planner,
    });
    if (!validateLivingWorldPlan(plan)) {
      failedDecisions += 1;
      return null;
    }
    latestPlans.set(safeActor.id, plan);
    lastDecisions.set(safeActor.id, { intent: decision.intent, confidence: decision.confidence, atSeconds: nowSeconds });
    generatedPlans += 1;
    return freeze({ actorId: safeActor.id, decision, plan, salience });
  }

  function tickOnce({ deltaSeconds = policy.defaultDecisionIntervalSeconds, nowSeconds = null, actors = [], signals = [] } = {}) {
    if (disposed) return freeze({ tick, disposed: true, decisions: [], stats: snapshotStats() });
    const delta = clamp(deltaSeconds, policy.minDecisionIntervalSeconds, policy.maxDecisionIntervalSeconds);
    const now = nowSeconds == null ? tick * delta : Math.max(0, finite(nowSeconds, tick * delta));
    tick += 1;
    ingest(signals, now);
    memory.prune(now);
    const safeActors = (Array.isArray(actors) ? actors : []).slice(0, policy.maxActorsPerTick).map(sanitizeActor).filter(Boolean);
    const decisions = [];
    for (const actor of safeActors) {
      const result = decideActor(actor, now);
      if (result) decisions.push(result);
      if (decisions.length >= policy.maxPlansPerTick) break;
    }
    const frame = freeze({ tick, nowSeconds: now, deltaSeconds: delta, decisions: freeze(decisions), stats: snapshotStats(), memory: memory.summary(now) });
    history.push(frame);
    while (history.length > policy.historySize) history.shift();
    return frame;
  }

  function snapshotStats() {
    return freeze({ tick, revision, acceptedSignals, rejectedSignals, generatedPlans, failedDecisions, activePlans: latestPlans.size, rememberedSignals: memory.summarize(tick * policy.defaultDecisionIntervalSeconds).size });
  }

  function snapshot(nowSeconds = tick * policy.defaultDecisionIntervalSeconds) {
    return freeze({ policy, disposed, tick, revision, stats: snapshotStats(), memory: memory.snapshot(nowSeconds), latestPlans: freeze([...latestPlans.entries()].map(([id, plan]) => freeze({ actorId: id, plan }))), history: freeze(history.slice(-policy.historySize)) });
  }

  function reset() {
    if (disposed) return;
    memory.clear();
    latestPlans.clear();
    lastDecisions.clear();
    history.length = 0;
    revision += 1;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    memory.dispose();
    latestPlans.clear();
    lastDecisions.clear();
    history.length = 0;
    revision += 1;
  }

  return freeze({ ingest, decideActor, tickOnce, snapshot, reset, dispose, memory, get disposed() { return disposed; }, get tick() { return tick; }, get revision() { return revision; } });
}
