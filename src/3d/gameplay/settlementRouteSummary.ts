const ROUTE_KINDS = Object.freeze(['settlement', 'interior', 'door', 'npc', 'vendor', 'crafting', 'quest', 'travel', 'save']);
const ACTION_LABELS = Object.freeze({
  enter: 'İçeri gir',
  exit: 'Dışarı çık',
  interact: 'Etkileş',
  talk: 'Konuş',
  trade: 'Takas',
  craft: 'Üret',
  acceptQuest: 'Görevi kabul et',
  advanceQuest: 'Görevi ilerlet',
  travel: 'Yola çık',
  save: 'Oyunu kaydet',
  back: 'Geri dön',
});

const normalizeId = (value) => (typeof value === 'string' ? value.trim() : '');
const normalizeText = (value) => (typeof value === 'string' ? value.trim() : '');
const freeze = (value) => Object.freeze(value);

function normalizeAction(action) {
  const value = normalizeId(action);
  return Object.prototype.hasOwnProperty.call(ACTION_LABELS, value) ? value : '';
}

function normalizeNode(node) {
  if (!node || typeof node !== 'object') return null;
  const kind = ROUTE_KINDS.includes(node.kind) ? node.kind : '';
  const id = normalizeId(node.id);
  if (!kind || !id) return null;
  return freeze({
    id,
    kind,
    label: normalizeText(node.label) || id,
    role: normalizeText(node.role),
  });
}

function normalizeActionRows(actions) {
  const seen = new Set();
  const rows = [];
  for (const item of Array.isArray(actions) ? actions : []) {
    const action = normalizeAction(typeof item === 'string' ? item : item?.action);
    if (!action || seen.has(action)) continue;
    seen.add(action);
    rows.push(freeze({
      action,
      label: ACTION_LABELS[action],
      targetId: normalizeId(typeof item === 'object' ? item?.targetId : ''),
      enabled: typeof item === 'object' ? item?.enabled !== false : true,
      reason: normalizeId(typeof item === 'object' ? item?.reason : ''),
    }));
  }
  return rows;
}

function stableKey(summary) {
  return JSON.stringify({
    sliceId: summary.sliceId,
    settlementId: summary.settlementId,
    nodeId: summary.node?.id || '',
    actions: summary.actions.map((row) => [row.action, row.targetId, row.enabled, row.reason]),
    visited: summary.visited,
  });
}

export function createSettlementRouteSummary(rail, options = {}) {
  if (!rail || typeof rail !== 'object' || rail.ok !== true) {
    return freeze({ ok: false, reason: 'rail-unavailable', node: null, actions: freeze([]), visited: freeze([]), key: 'rail-unavailable' });
  }

  const snapshot = rail.snapshot && typeof rail.snapshot === 'object' ? rail.snapshot : {};
  const node = normalizeNode(rail.node || snapshot.node);
  const visited = [...new Set((Array.isArray(rail.visited) ? rail.visited : snapshot.visited || []).map(normalizeId).filter(Boolean))].sort();
  const actions = normalizeActionRows(rail.actions || snapshot.actions);
  const settlementId = normalizeId(options.settlementId || rail.settlementId || snapshot.settlementId);
  const sliceId = normalizeId(options.sliceId || rail.sliceId || snapshot.sliceId);
  const nextAction = actions.find((row) => row.enabled) || actions[0] || null;
  const summary = {
    ok: true,
    sliceId,
    settlementId,
    node,
    actions: freeze(actions),
    visited: freeze(visited),
    nextAction,
    completion: node?.kind === 'save' ? 'ready-to-save' : node?.kind === 'travel' ? 'ready-to-travel' : 'in-progress',
  };
  return freeze({ ...summary, key: stableKey(summary) });
}

export function validateSettlementRouteSummary(summary) {
  if (!summary || typeof summary !== 'object' || summary.ok !== true) return false;
  if (!Array.isArray(summary.actions) || !Array.isArray(summary.visited)) return false;
  if (summary.node !== null && (!summary.node || typeof summary.node !== 'object')) return false;
  if (summary.nextAction !== null && !summary.actions.includes(summary.nextAction)) return false;
  return typeof summary.key === 'string' && summary.key.length > 0;
}
