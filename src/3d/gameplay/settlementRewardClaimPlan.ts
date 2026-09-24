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
const canonicalChainKey = (chain) => JSON.stringify({
  id: text(chain?.id),
  readyToClaim: chain?.readyToClaim === true,
  locked: chain?.locked === true,
  reward: {
    xp: finiteInt(chain?.reward?.xp),
    copper: finiteInt(chain?.reward?.copper),
    skillPoints: finiteInt(chain?.reward?.skillPoints, 0, 999),
  },
});

const normalizeChains = (value) => {
  const byId = new Map();
  for (const chain of Array.isArray(value) ? value : []) {
    const id = text(chain?.id);
    if (!id) continue;
    const candidate = { ...chain, id };
    const previous = byId.get(id);
    if (!previous || canonicalChainKey(candidate) < canonicalChainKey(previous)) byId.set(id, candidate);
  }
  return byId;
};

const isSortedUnique = (items) => items.every((item, index) => index === 0 || items[index - 1] < item);
const planSignature = (value) => stableHash(JSON.stringify({
  version: SETTLEMENT_REWARD_CLAIM_PLAN_VERSION,
  requestedIds: value.requestedChainIds,
  claimableChainIds: value.claimableChainIds,
  missingChainIds: value.missingChainIds,
  blockedChainIds: value.blockedChainIds,
  totals: value.totals,
  canClaim: value.canClaim,
  reason: value.reason,
}));

export function projectSettlementRewardClaimPlan(input = {}) {
  const preview = input.preview ?? {};
  const requestedIds = normalizeIdList(input.requestedChainIds);
  const available = normalizeChains(preview.chains);
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
  const signature = planSignature({ requestedChainIds: requestedIds, claimableChainIds, missingChainIds, blockedChainIds, totals, canClaim, reason });
  return freeze({ version: SETTLEMENT_REWARD_CLAIM_PLAN_VERSION, requestedChainIds: requestedIds, claimableChainIds, missingChainIds, blockedChainIds, totals, canClaim, reason, signature });
}

export function isSettlementRewardClaimPlan(value) {
  const stringArray = (items) => Array.isArray(items) && Object.isFrozen(items) && items.every((item) => typeof item === 'string') && isSortedUnique(items);
  const validReason = ['ready', 'missing-chain', 'not-claimable', 'empty-selection'].includes(value?.reason);
  const validTotals = value?.totals && Object.isFrozen(value.totals) &&
    Number.isInteger(value.totals.xp) && value.totals.xp >= 0 &&
    Number.isInteger(value.totals.copper) && value.totals.copper >= 0 &&
    Number.isInteger(value.totals.skillPoints) && value.totals.skillPoints >= 0;
  const invariant = value?.canClaim === (value?.reason === 'ready') &&
    (value?.canClaim ? value.claimableChainIds.length > 0 && value.missingChainIds.length === 0 && value.blockedChainIds.length === 0 : true);
  return Boolean(
    value && Object.isFrozen(value) &&
    value.version === SETTLEMENT_REWARD_CLAIM_PLAN_VERSION &&
    stringArray(value.requestedChainIds) &&
    stringArray(value.claimableChainIds) &&
    stringArray(value.missingChainIds) &&
    stringArray(value.blockedChainIds) &&
    validTotals &&
    typeof value.canClaim === 'boolean' &&
    validReason && invariant &&
    planSignature(value) === value.signature
  );
}
