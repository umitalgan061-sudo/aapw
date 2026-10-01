/**
 * Read-only handoff projection for the existing settlement QuestSystem.
 *
 * The caller remains authoritative for quest progression and reward mutation.
 * This module turns caller-owned quest/service observations into a bounded,
 * deterministic handoff model for settlement NPC, dialogue and HUD consumers.
 */

export const SETTLEMENT_QUEST_HANDOFF_VERSION = 1;
const MAX_OBJECTIVES = 12;
const MAX_REWARDS = 8;
const text = (value, fallback = '') => typeof value === 'string' && value.trim() ? value.trim() : fallback;
const bool = (value) => value === true;
const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const idOf = (value, fallback) => text(value?.id ?? value?.key ?? value?.objectiveId, fallback);
const freeze = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach((child) => {
    if (child && typeof child === 'object') freeze(child);
  });
  return value;
};

const objectiveState = (objective) => {
  if (bool(objective?.completed)) return 'complete';
  if (bool(objective?.blocked)) return 'blocked';
  if (bool(objective?.active) || bool(objective?.available)) return 'active';
  return 'upcoming';
};

const normalizeObjective = (objective, index) => {
  const required = Math.max(0, Math.floor(finite(objective?.required ?? objective?.target, 1)));
  const progress = clamp(Math.floor(finite(objective?.progress ?? objective?.current, 0)), 0, required || Number.MAX_SAFE_INTEGER);
  const state = objectiveState(objective);
  return {
    id: idOf(objective, `objective-${index + 1}`),
    title: text(objective?.title ?? objective?.label, `Objective ${index + 1}`),
    service: text(objective?.service ?? objective?.nodeKind, 'settlement'),
    state,
    progress,
    required,
    remaining: Math.max(0, required - progress),
    blockingReason: state === 'blocked' ? text(objective?.blockingReason ?? objective?.reason, 'blocked') : '',
    handoffAction: text(objective?.handoffAction ?? objective?.action, state === 'active' ? 'continue' : state === 'complete' ? 'claim' : 'inspect'),
  };
};

const normalizeReward = (reward, index) => ({
  id: idOf(reward, `reward-${index + 1}`),
  kind: text(reward?.kind ?? reward?.type, 'unknown'),
  label: text(reward?.label ?? reward?.name, `Reward ${index + 1}`),
  amount: Math.max(0, finite(reward?.amount ?? reward?.value, 0)),
  claimable: bool(reward?.claimable),
});

export function buildSettlementQuestHandoff(snapshot = {}) {
  const objectives = Array.isArray(snapshot?.objectives) ? snapshot.objectives.slice(0, MAX_OBJECTIVES).map(normalizeObjective) : [];
  const rewards = Array.isArray(snapshot?.rewards) ? snapshot.rewards.slice(0, MAX_REWARDS).map(normalizeReward) : [];
  const active = objectives.find((item) => item.state === 'active') ?? objectives.find((item) => item.state === 'blocked') ?? objectives[0] ?? null;
  const completed = objectives.filter((item) => item.state === 'complete').length;
  const blocked = objectives.filter((item) => item.state === 'blocked').length;
  const claimableRewards = rewards.filter((item) => item.claimable).length;
  const insideSettlement = bool(snapshot?.insideSettlement ?? snapshot?.inSettlement);
  const alive = snapshot?.alive !== false && finite(snapshot?.health, 1) > 0;
  const canInteract = insideSettlement && alive;

  return freeze({
    version: SETTLEMENT_QUEST_HANDOFF_VERSION,
    settlementId: text(snapshot?.settlementId ?? snapshot?.settlement, 'unknown-settlement'),
    questId: text(snapshot?.questId ?? snapshot?.chainId, 'unknown-quest'),
    canInteract,
    blockedReason: !alive ? 'player-defeated' : !insideSettlement ? 'outside-settlement' : '',
    activeObjectiveId: active?.id ?? '',
    activeObjectiveState: active?.state ?? 'empty',
    objectives,
    rewards,
    summary: {
      totalObjectives: objectives.length,
      completedObjectives: completed,
      blockedObjectives: blocked,
      remainingObjectives: Math.max(0, objectives.length - completed),
      claimableRewards,
    },
    nextAction: !canInteract ? 'return-to-settlement' : claimableRewards > 0 ? 'claim-reward' : active?.handoffAction ?? 'inspect-quest',
  });
}

export function serializeSettlementQuestHandoff(snapshot = {}) {
  return JSON.stringify(buildSettlementQuestHandoff(snapshot));
}

export default buildSettlementQuestHandoff;
