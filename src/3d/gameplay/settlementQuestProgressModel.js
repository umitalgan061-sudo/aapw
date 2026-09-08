/**
 * Read-only UX projection for authored settlement quest chains.
 * The existing QuestSystem remains authoritative for completion/state mutation.
 */
import {
  buildSettlementQuestChainProgress,
  getSettlementQuestChain,
  listSettlementQuestChains,
} from './settlementCampaignQuestChains.js';

const LIMITS = Object.freeze({ chains: 6, steps: 8, title: 120, summary: 180 });
const text = (value, fallback = '') => {
  const normalized = String(value ?? '').trim();
  return normalized ? normalized.slice(0, 180) : fallback;
};
const freeze = (value) => Object.freeze(value);

function normalizeCompletedIds(value) {
  return Array.isArray(value)
    ? [...new Set(value.map((id) => String(id ?? '').trim()).filter(Boolean))].slice(0, LIMITS.steps)
    : [];
}

export function createSettlementQuestProgressModel({
  snapshot = {},
  activeChainId = '',
  completedStepIds = [],
  ruleEvaluator,
} = {}) {
  const chainIds = listSettlementQuestChains().slice(0, LIMITS.chains);
  const completed = normalizeCompletedIds(completedStepIds);
  const chains = chainIds.map((chainId) => {
    const chain = getSettlementQuestChain(chainId);
    const progress = buildSettlementQuestChainProgress(chainId, snapshot, completed);
    const steps = (chain?.steps || []).slice(0, LIMITS.steps).map((step, index) => ({
      id: step.id,
      index,
      action: step.action,
      target: text(step.target || step.recipe || step.route, '—'),
      rewardXp: Number.isFinite(step.rewardXp) ? step.rewardXp : 0,
      completed: completed.includes(step.id),
    }));
    return {
      id: chainId,
      title: text(chain?.title, chainId),
      summary: text(chain?.summary),
      giver: text(chain?.giver),
      service: text(chain?.service),
      totalSteps: steps.length,
      completedSteps: steps.filter((step) => step.completed).length,
      nextStepId: progress?.nextStepId || steps.find((step) => !step.completed)?.id || null,
      ready: progress?.ready === true,
      steps,
    };
  });

  const active = chains.find((chain) => chain.id === activeChainId) || chains[0] || null;
  const activeStep = active?.steps.find((step) => step.id === active.nextStepId) || null;
  let evaluation = null;
  if (active && activeStep && typeof ruleEvaluator === 'function') {
    evaluation = buildSettlementQuestChainProgress(active.id, snapshot, completed, ruleEvaluator)?.evaluation || null;
  }

  return freeze({
    activeChainId: active?.id || null,
    activeStepId: activeStep?.id || null,
    activeAction: activeStep?.action || null,
    activeTarget: activeStep?.target || null,
    activeReady: active?.ready === true,
    completedStepIds: freeze(completed),
    chains: freeze(chains.map((chain) => freeze({ ...chain, steps: freeze(chain.steps.map((step) => freeze(step))) }))),
    evaluation,
  });
}

export function summarizeSettlementQuestProgress(model) {
  const source = model && typeof model === 'object' ? model : {};
  const chains = Array.isArray(source.chains) ? source.chains : [];
  const completedSteps = chains.reduce((sum, chain) => sum + (Number(chain?.completedSteps) || 0), 0);
  const totalSteps = chains.reduce((sum, chain) => sum + (Number(chain?.totalSteps) || 0), 0);
  return freeze({
    activeChainId: source.activeChainId || null,
    activeStepId: source.activeStepId || null,
    completedSteps,
    totalSteps,
    completionRatio: totalSteps > 0 ? completedSteps / totalSteps : 0,
    ready: source.activeReady === true,
  });
}
