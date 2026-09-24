export const SETTLEMENT_REWARD_PREVIEW_VERSION = 1;

const SERVICES = Object.freeze(['blacksmith', 'tavern', 'market', 'farm', 'barracks', 'stable']);
const text = (value, fallback = '') => typeof value === 'string' && value.trim() ? value.trim() : fallback;
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clampInt = (value, min = 0, max = 999999) => Math.max(min, Math.min(max, Math.trunc(finite(value, min))));
const freeze = (value) => Object.freeze(value);

const stableHash = (value) => {
  let hash = 2166136261;
  for (const char of String(value)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

const normalizeReward = (reward) => freeze({
  xp: clampInt(reward?.xp, 0),
  copper: clampInt(reward?.copper, 0),
  perk: text(reward?.perk),
  skill: text(reward?.skill),
  skillPoints: clampInt(reward?.skillPoints, 0, 999),
});

const normalizeChain = (chain) => {
  const id = text(chain?.id || chain?.chainId);
  if (!id) return null;
  const service = SERVICES.includes(text(chain?.service)) ? text(chain.service) : 'unknown';
  const steps = Array.isArray(chain?.steps) ? chain.steps : [];
  const declaredTotalSteps = clampInt(chain?.totalSteps ?? chain?.progress?.total, 0);
  const totalSteps = Math.max(steps.length, declaredTotalSteps);
  const completedSteps = clampInt(chain?.completedSteps ?? chain?.progress?.completed, 0, totalSteps || 999999);
  const progress = totalSteps > 0 ? Math.min(1, completedSteps / totalSteps) : 0;
  const reward = normalizeReward(chain?.reward);
  const completionReady = totalSteps > 0 && completedSteps >= totalSteps;
  const readyToClaim = !Boolean(chain?.locked) && completionReady && chain?.readyToClaim !== false;
  const locked = Boolean(chain?.locked);
  return freeze({ id, service, reward, completedSteps, totalSteps, progress, readyToClaim, locked });
};

export function projectSettlementRewardPreview(input = {}) {
  const normalized = (Array.isArray(input.chains) ? input.chains : [])
    .map(normalizeChain)
    .filter(Boolean)
    .sort((a, b) => a.id.localeCompare(b.id) || JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const chains = [];
  const seenIds = new Set();
  for (const chain of normalized) {
    if (seenIds.has(chain.id)) continue;
    seenIds.add(chain.id);
    chains.push(chain);
  }
  const claimable = chains.filter((chain) => chain.readyToClaim);
  const totals = chains.reduce((acc, chain) => ({
    xp: acc.xp + chain.reward.xp,
    copper: acc.copper + chain.reward.copper,
    skillPoints: acc.skillPoints + chain.reward.skillPoints,
  }), { xp: 0, copper: 0, skillPoints: 0 });
  const signature = stableHash(JSON.stringify({ chains, claimable: claimable.map((chain) => chain.id), totals }));
  return freeze({
    version: SETTLEMENT_REWARD_PREVIEW_VERSION,
    chains: freeze(chains),
    claimableChainIds: freeze(claimable.map((chain) => chain.id)),
    totals: freeze(totals),
    claimableCount: claimable.length,
    signature,
  });
}

export function isSettlementRewardPreview(value) {
  return Boolean(value && value.version === SETTLEMENT_REWARD_PREVIEW_VERSION && Array.isArray(value.chains) && Array.isArray(value.claimableChainIds) && typeof value.signature === 'string' && Object.isFrozen(value));
}
