const freeze = (value) => Object.freeze(value);

export const SETTLEMENT_QUEST_CHAIN_VERSION = 1;

const finiteInt = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
};

const normalizeId = (value) => String(value ?? '').trim();

function normalizeNode(node, index) {
  const id = normalizeId(node?.id) || `step-${index + 1}`;
  const prerequisites = Array.isArray(node?.prerequisites)
    ? node.prerequisites.map(normalizeId).filter(Boolean)
    : [];
  return freeze({
    id,
    title: String(node?.title ?? id),
    prerequisites: freeze([...new Set(prerequisites)]),
    rewardCopper: Math.max(0, finiteInt(node?.rewardCopper)),
    requiredItem: normalizeId(node?.requiredItem) || null,
    requiredQuantity: Math.max(0, finiteInt(node?.requiredQuantity)),
    tags: freeze(Array.isArray(node?.tags) ? [...new Set(node.tags.map((tag) => String(tag).trim()).filter(Boolean))] : []),
  });
}

export function normalizeSettlementQuestChain(definition = {}) {
  const rawNodes = Array.isArray(definition.nodes) ? definition.nodes : [];
  const seen = new Set();
  const nodes = [];
  for (let index = 0; index < rawNodes.length; index += 1) {
    const node = normalizeNode(rawNodes[index], index);
    if (seen.has(node.id)) continue;
    seen.add(node.id);
    nodes.push(node);
  }
  return freeze({
    version: SETTLEMENT_QUEST_CHAIN_VERSION,
    id: normalizeId(definition.id) || 'settlement-chain',
    settlementId: normalizeId(definition.settlementId) || null,
    nodes: freeze(nodes),
  });
}

function nodeMap(chain) {
  return new Map((chain?.nodes ?? []).map((node) => [node.id, node]));
}

export function createSettlementQuestChainState(chainDefinition, savedState = {}) {
  const chain = normalizeSettlementQuestChain(chainDefinition);
  const completed = new Set(Array.isArray(savedState.completed) ? savedState.completed.map(normalizeId) : []);
  const active = normalizeId(savedState.active) || null;
  const progress = {};
  for (const [id, value] of Object.entries(savedState.progress ?? {})) {
    progress[id] = Math.max(0, finiteInt(value));
  }
  const map = nodeMap(chain);
  for (const id of [...completed]) if (!map.has(id)) completed.delete(id);
  return freeze({
    chain,
    active: active && map.has(active) ? active : null,
    completed: freeze([...completed].sort()),
    progress: freeze({ ...progress }),
  });
}

export function availableSettlementQuestNodes(state) {
  const completed = new Set(state?.completed ?? []);
  const nodes = state?.chain?.nodes ?? [];
  return freeze(nodes.filter((node) => !completed.has(node.id) && node.prerequisites.every((id) => completed.has(id))));
}

export function advanceSettlementQuestChain(state, nodeId, { itemCounts = {}, setActive = true } = {}) {
  const current = createSettlementQuestChainState(state?.chain, state);
  const id = normalizeId(nodeId);
  const node = current.chain.nodes.find((candidate) => candidate.id === id);
  if (!node) return freeze({ ok: false, reason: 'unknown-node', state: current });
  if (!availableSettlementQuestNodes(current).some((candidate) => candidate.id === id)) {
    return freeze({ ok: false, reason: 'prerequisite-not-met', state: current });
  }
  if (node.requiredItem && Math.max(0, finiteInt(itemCounts[node.requiredItem])) < node.requiredQuantity) {
    return freeze({ ok: false, reason: 'required-item-missing', requiredItem: node.requiredItem, requiredQuantity: node.requiredQuantity, state: current });
  }
  const completed = [...current.completed, id].sort();
  const nextAvailable = current.chain.nodes.find((candidate) => !completed.includes(candidate.id) && candidate.prerequisites.every((prerequisite) => completed.includes(prerequisite)));
  const nextState = freeze({
    chain: current.chain,
    active: setActive ? (nextAvailable?.id ?? null) : current.active,
    completed: freeze(completed),
    progress: current.progress,
  });
  return freeze({ ok: true, completedNode: id, rewardCopper: node.rewardCopper, nextNode: nextAvailable?.id ?? null, state: nextState });
}

export function settlementQuestChainSnapshot(state) {
  const normalized = createSettlementQuestChainState(state?.chain, state);
  return freeze({
    version: SETTLEMENT_QUEST_CHAIN_VERSION,
    chainId: normalized.chain.id,
    settlementId: normalized.chain.settlementId,
    active: normalized.active,
    completed: normalized.completed,
    progress: normalized.progress,
  });
}
