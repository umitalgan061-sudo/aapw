/**
 * Deterministic encounter-budget planner for the settlement boundary.
 *
 * This layer converts the existing continuity/experience evidence into bounded
 * presentation slots. It never spawns actors, mutates world state, or owns
 * combat/NPC persistence. Consumers may use the returned packet to decide how
 * much authored content can be presented at once on each scale.
 */
import { createSettlementWorldCoverageContinuityExperience } from './settlementWorldCoverageContinuityExperience.js';

export const SETTLEMENT_WORLD_COVERAGE_CONTINUITY_ENCOUNTER_BUDGET_VERSION = 1;
export const SETTLEMENT_WORLD_COVERAGE_CONTINUITY_ENCOUNTER_BUDGET_LIMITS = Object.freeze({
  maxSlots: 12,
  maxPrioritySlots: 4,
  mobileScale: 0.62,
  minScore: 0.35,
});

const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const text = (value, fallback = '') => {
  const normalized = String(value ?? '').trim();
  return normalized ? normalized.slice(0, 140) : fallback;
};
const clamp01 = (value, fallback = 0) => Math.max(0, Math.min(1, number(value, fallback)));
const freeze = (value, seen = new Set()) => {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  Object.freeze(value);
  for (const child of Object.values(value)) freeze(child, seen);
  return value;
};
const stable = (value) => value === null || typeof value !== 'object'
  ? JSON.stringify(value)
  : Array.isArray(value)
    ? `[${value.map(stable).join(',')}]`
    : `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
const digest = (value) => {
  let hash = 2166136261;
  const source = stable(value);
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

function stageWeight(stage) {
  return {
    far: 0.58,
    approach: 0.72,
    threshold: 0.92,
    inside: 1,
    service: 1,
    departure: 0.74,
    resume: 0.86,
  }[stage] ?? 0.5;
}
function cueWeight(cue) {
  const base = clamp01(cue?.score, 0);
  const priority = clamp01(number(cue?.priority, base), base);
  return Math.round(clamp01(base * 0.7 + priority * 0.3) * 1000) / 1000;
}
function roleForCue(cue) {
  const type = text(cue?.type, 'ambient');
  if (type === 'gateway' || type === 'warning') return 'navigation';
  if (type === 'service') return 'interaction';
  if (type === 'road' || type === 'route') return 'travel';
  if (type === 'checkpoint') return 'resume';
  return 'atmosphere';
}
function slotCost(role, mobile) {
  const desktop = { navigation: 1.05, interaction: 1.1, travel: 0.95, resume: 0.9, atmosphere: 0.72 }[role] ?? 0.8;
  return Math.round(desktop * (mobile ? SETTLEMENT_WORLD_COVERAGE_CONTINUITY_ENCOUNTER_BUDGET_LIMITS.mobileScale : 1) * 100) / 100;
}
function buildCandidates(experience, mobile) {
  const rows = experience.quickCues.map((cue, index) => {
    const role = roleForCue(cue);
    const weight = Math.round((cueWeight(cue) * stageWeight(experience.stage)) * 1000) / 1000;
    return {
      id: `encounter:${cue.id}`,
      rank: index + 1,
      sourceId: cue.id,
      type: cue.type,
      role,
      label: cue.label,
      copy: cue.copy,
      score: weight,
      cost: slotCost(role, mobile),
      metadata: cue.metadata,
    };
  });
  return candidates.filter((row) => row.score >= SETTLEMENT_WORLD_COVERAGE_CONTINUITY_ENCOUNTER_BUDGET_LIMITS.minScore)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}
function chooseSlots(candidates, mobile) {
  const maxSlots = Math.max(2, Math.min(
    SETTLEMENT_WORLD_COVERAGE_CONTINUITY_ENCOUNTER_BUDGET_LIMITS.maxSlots,
    mobile ? 8 : 12,
  ));
  const chosen = [];
  const usedRoles = new Set();
  let cost = 0;
  for (const candidate of candidates) {
    const rolePenalty = usedRoles.has(candidate.role) ? 0.08 : 0;
    const nextCost = Math.round((cost + candidate.cost + rolePenalty) * 100) / 100;
    if (chosen.length >= maxSlots || nextCost > maxSlots * 0.98) continue;
    chosen.push({
      ...candidate,
      selectedScore: Math.round(Math.max(0, candidate.score - rolePenalty) * 1000) / 1000,
    });
    usedRoles.add(candidate.role);
    cost = nextCost;
  }
  return { slots: chosen, budgetCost: cost, maxSlots };
}
function buildPrioritySlots(slots) {
  return slots.slice(0, SETTLEMENT_WORLD_COVERAGE_CONTINUITY_ENCOUNTER_BUDGET_LIMITS.maxPrioritySlots)
    .map((slot, index) => ({
      rank: index + 1,
      id: slot.id,
      role: slot.role,
      score: slot.selectedScore,
      label: slot.label,
    }));
}

export function createSettlementWorldCoverageContinuityEncounterBudget(options = {}) {
  const mobile = Boolean(options.mobile);
  const experience = createSettlementWorldCoverageContinuityExperience(options);
  const selected = chooseSlots(buildCandidates(experience, mobile), mobile);
  const roles = Object.freeze([...new Set(selected.slots.map((slot) => slot.role))]);
  const result = {
    version: SETTLEMENT_WORLD_COVERAGE_CONTINUITY_ENCOUNTER_BUDGET_VERSION,
    settlementId: experience.settlementId,
    stage: experience.stage,
    mode: experience.mode,
    mobile,
    readiness: experience.readiness,
    candidateCount: buildCandidates(experience, mobile).length,
    selectedCount: selected.slots.length,
    maxSlots: selected.maxSlots,
    budgetCost: selected.budgetCost,
    roles,
    prioritySlots: buildPrioritySlots(selected.slots),
    slots: selected.slots,
    ownership: {
      readOnly: true,
      noNpcSpawn: true,
      noCombatMutation: true,
      noSaveMutation: true,
    },
  };
  return freeze({ ...result, fingerprint: digest(result) });
}

export function validateSettlementWorldCoverageContinuityEncounterBudget(options = {}) {
  const budget = createSettlementWorldCoverageContinuityEncounterBudget(options);
  const errors = [];
  if (budget.selectedCount > budget.maxSlots) errors.push('slot-cap');
  if (budget.prioritySlots.length > SETTLEMENT_WORLD_COVERAGE_CONTINUITY_ENCOUNTER_BUDGET_LIMITS.maxPrioritySlots) errors.push('priority-cap');
  if (budget.budgetCost < 0) errors.push('negative-cost');
  if (!budget.ownership.readOnly || !budget.ownership.noNpcSpawn || !budget.ownership.noSaveMutation) errors.push('ownership');
  const ids = budget.slots.map((slot) => slot.id);
  if (new Set(ids).size !== ids.length) errors.push('duplicate-slot-id');
  if (budget.slots.some((slot) => slot.score < 0 || slot.score > 1)) errors.push('score-range');
  if (budget.slots.some((slot) => slot.cost <= 0)) errors.push('cost-range');
  return freeze({
    ok: errors.length === 0,
    errors,
    settlementId: budget.settlementId,
    selectedCount: budget.selectedCount,
    budgetCost: budget.budgetCost,
    fingerprint: budget.fingerprint,
  });
}

export function summarizeSettlementWorldCoverageContinuityEncounterBudget(options = {}) {
  const budget = createSettlementWorldCoverageContinuityEncounterBudget(options);
  return freeze({
    settlementId: budget.settlementId,
    stage: budget.stage,
    mode: budget.mode,
    mobile: budget.mobile,
    selectedCount: budget.selectedCount,
    maxSlots: budget.maxSlots,
    roles: budget.roles,
    priorityCount: budget.prioritySlots.length,
    budgetCost: budget.budgetCost,
    topSlot: budget.slots[0]?.id ?? null,
    fingerprint: budget.fingerprint,
  });
}

export const SETTLEMENT_WORLD_COVERAGE_CONTINUITY_ENCOUNTER_BUDGET_API = Object.freeze({
  version: SETTLEMENT_WORLD_COVERAGE_CONTINUITY_ENCOUNTER_BUDGET_VERSION,
  maxSlots: SETTLEMENT_WORLD_COVERAGE_CONTINUITY_ENCOUNTER_BUDGET_LIMITS.maxSlots,
  maxPrioritySlots: SETTLEMENT_WORLD_COVERAGE_CONTINUITY_ENCOUNTER_BUDGET_LIMITS.maxPrioritySlots,
  planner: 'createSettlementWorldCoverageContinuityEncounterBudget',
  validate: 'validateSettlementWorldCoverageContinuityEncounterBudget',
  summary: 'summarizeSettlementWorldCoverageContinuityEncounterBudget',
});
