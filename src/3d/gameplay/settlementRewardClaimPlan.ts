export const SETTLEMENT_REWARD_CLAIM_PLAN_VERSION = 1;

const finiteInt = (value, fallback = 0, max = 999999) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(max, Math.trunc(number)));
};

const text = (value) => typeof value === 'string' && value.trim() ? value.trim() : '';
const freeze = (value) => Object.freeze(value);
const stableHash = (value) => {
  let hash = 2166136261;
  for (const char of String(value)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

const normalizeIdList = (value) => freeze([...new Set(Array.isArray(value) ? value.map(text).filter(Boolean) : [])].sort());

export function projectSettlementRewardClaimPlan(input = {}) {
  const preview = input.preview ?? {};
  const chains = Array.isArray(preview.chains) ? preview.chains : [];
  const requestedIds = normalizeIdList(input.requestedChainIds);
  const available = new Map(chains.filter((chain) => chain && typeof chain.id === 'string').map((chain) => [chain.id, chain]));
  const selected = requestedIds.map((id) => available.get(id)).filter(Boolean);
  const missingChainIds = freeze(requestedIds.filter((id) => !available.has(id)));
  const blockedChainIds = freeze(selected.filter((chain) => chain.readyToClaim !== true).map((chain) => chain.id).sort());
  const claimable = selected.filter((chain) => chain.readyToClaim === true && chain.locked !== true);
  const claimableChainIds = freeze(claimable.map((chain) => chain.id).sort());
  const totals = freeze(claimable.reduce((acc, chain) => ({
    xp: acc.xp + finiteInt(chain.reward?.xp),
    copper: acc.copper + finiteInt(chain.reward?.copper),
    skillPoints: acc.skillPoints + finiteInt(chain.reward?.skillPoints, 0, 999),
  }), { xp: 0, copper: 0, skillPoints: 0 }));
  const canClaim = claimable.length > 0 && missingChainIds.length === 0 && blockedChainIds.length === 0;
  const reason = canClaim ? 'ready' : missingChainIds.length ? 'missing-chain' : blockedChainIds.length ? 'not-claimable' : 'empty-selection';
  const signature = stableHash(JSON.stringify({ version: SETTLEMENT_REWARD_CLAIM_PLAN_VERSION, requestedIds, claimableChainIds, missingChainIds, blockedChainIds, totals, canClaim, reason }));
  return freeze({ version: SETTLEMENT_REWARD_CLAIM_PLAN_VERSION, requestedChainIds: requestedIds, claimableChainIds, missingChainIds, blockedChainIds, totals, canClaim, reason, signature });
}

export function isSettlementRewardClaimPlan(value) {
  return Boolean(
    value && Object.isFrozen(value) &&
    value.version === SETTLEMENT_REWARD_CLAIM_PLAN_VERSION &&
    Array.isArray(value.requestedChainIds) && Object.isFrozen(value.requestedChainIds) &&
    Array.isArray(value.claimableChainIds) && Object.isFrozen(value.claimableChainIds) &&
    Array.isArray(value.missingChainIds) && Object.isFrozen(value.missingChainIds) &&
    Array.isArray(value.blockedChainIds) && Object.isFrozen(value.blockedChainIds) &&
    value.totals && Object.isFrozen(value.totals) &&
    Number.isInteger(value.totals.xp) && Number.isInteger(value.totals.copper) && Number.isInteger(value.totals.skillPoints) &&
    typeof value.canClaim === 'boolean' && typeof value.reason === 'string' && typeof value.signature === 'string'
  );
}
