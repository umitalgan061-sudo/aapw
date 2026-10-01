/**
 * Settlement quest reward claim planner.
 * Read-only UX projection over the existing authored quest-chain authority.
 * Claim execution and authoritative progression remain caller-owned.
 */
import {
  getSettlementQuestChain,
  getSettlementQuestChainReward,
  buildSettlementQuestChainProgress,
} from './settlementCampaignQuestChains.js';

export const SETTLEMENT_REWARD_CLAIM_PLANNER_VERSION = 1;
const MAX_CHAINS = 6;
const MAX_REWARDS = 6;
const MAX_TEXT = 160;

const text = (value, fallback = '') => {
  const normalized = String(value ?? '').trim();
  return normalized ? normalized.slice(0, MAX_TEXT) : fallback;
};
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));

function normalizeCompleted(value) {
  return Array.isArray(value) ? value.map(item => text(item)).filter(Boolean).slice(0, 64) : [];
}

function planChain(chainId, snapshot, completedStepIds, progressBuilder = buildSettlementQuestChainProgress) {
  const chain = getSettlementQuestChain(chainId);
  if (!chain) return null;
  const progress = typeof progressBuilder === 'function'
    ? progressBuilder(chainId, snapshot, completedStepIds)
    : { ok: false, reason: 'progress-builder-required' };
  const steps = Array.isArray(progress?.steps) ? progress.steps : [];
  const completed = steps.filter(step => step?.completed === true).length;
  const total = Math.min(chain.steps.length, steps.length || chain.steps.length);
  const ready = progress?.ok === true && completed >= total && total > 0;
  const reward = getSettlementQuestChainReward(chainId) || {};
  return {
    chainId,
    title: text(chain.title, chainId),
    giver: text(chain.giver, 'settlement'),
    service: text(chain.service, 'settlement'),
    progress: { completed, total, ratio: total ? clamp(completed / total, 0, 1) : 0 },
    claimable: ready,
    reward: {
      xp: Math.max(0, finite(reward.xp)),
      copper: Math.max(0, finite(reward.copper)),
      perk: text(reward.perk, ''),
    },
    reason: ready ? 'reward-ready' : progress?.reason || (progress?.ok === false ? 'progress-unavailable' : 'steps-incomplete'),
  };
}

export function buildSettlementRewardClaimPlan(snapshot = {}, completedStepIds = [], progressBuilder) {
  const completed = normalizeCompleted(completedStepIds);
  const ids = ['iron_and_oath', 'market_routes', 'road_watch', 'hearth_and_home', 'winter_supply', 'stable_master'];
  const chains = ids.slice(0, MAX_CHAINS)
    .map(id => planChain(id, clone(snapshot), completed, progressBuilder))
    .filter(Boolean);
  const claimable = chains.filter(chain => chain.claimable);
  const rewards = claimable.slice(0, MAX_REWARDS).map(chain => ({ chainId: chain.chainId, ...chain.reward }));
  return Object.freeze({
    version: SETTLEMENT_REWARD_CLAIM_PLANNER_VERSION,
    claimableCount: claimable.length,
    incompleteCount: chains.length - claimable.length,
    chains: Object.freeze(chains.map(chain => Object.freeze(chain))),
    rewards: Object.freeze(rewards.map(reward => Object.freeze(reward))),
    summary: Object.freeze({
      headline: claimable.length ? 'Ödül alınabilir' : 'Ödül için ilerleme gerekli',
      xp: rewards.reduce((sum, reward) => sum + reward.xp, 0),
      copper: rewards.reduce((sum, reward) => sum + reward.copper, 0),
    }),
  });
}

export function serializeSettlementRewardClaimPlan(plan) {
  return JSON.stringify(plan ?? buildSettlementRewardClaimPlan());
}
