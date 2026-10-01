/**
 * Read-only objective planner for the existing settlement vertical slice.
 *
 * It projects node gates into actionable objective rows for shipped UX without
 * owning quest state, inventory, economy, dialogue, persistence, or scene state.
 */

import { evaluateSettlementGates } from './settlementVerticalSlice.js';

const LIMITS = Object.freeze({ nodes: 24, gates: 8, text: 160, id: 96 });
const GATE_LABELS = Object.freeze({
  flag: 'Bayrak', item: 'Eşya', reputation: 'İtibar', quest: 'Görev', capability: 'Yetenek', proximity: 'Mesafe',
});

const clampText = (value, fallback = '') => {
  const normalized = String(value ?? '').trim();
  return normalized ? normalized.slice(0, LIMITS.text) : fallback;
};
const normalizeId = (value, fallback = '') => {
  const normalized = String(value ?? '').trim();
  return normalized ? normalized.slice(0, LIMITS.id) : fallback;
};
const freeze = (value) => Object.freeze(value);

function gateTarget(gate) {
  if (!gate || typeof gate !== 'object') return '';
  if (gate.type === 'flag') return normalizeId(gate.key);
  if (gate.type === 'item') return `${normalizeId(gate.itemId)} ×${gate.quantity}`;
  if (gate.type === 'reputation') return `${normalizeId(gate.factionId)} ≥${gate.minimum}`;
  if (gate.type === 'quest') return normalizeId(gate.questId);
  if (gate.type === 'capability') return normalizeId(gate.capability);
  if (gate.type === 'proximity') return `≤${gate.distance}m`;
  return '';
}

function normalizeGate(gate) {
  if (!gate || typeof gate !== 'object') return null;
  const type = normalizeId(gate.type);
  if (!GATE_LABELS[type]) return null;
  const target = gateTarget(gate);
  return freeze({
    type,
    label: GATE_LABELS[type],
    target,
    reason: clampText(gate.reason, 'Koşul karşılanmadı'),
  });
}

function nodeRows(definition) {
  const nodes = Array.isArray(definition?.nodes) ? definition.nodes.slice(0, LIMITS.nodes) : [];
  return nodes.map((node, index) => {
    const nodeId = normalizeId(node?.id, `node-${index + 1}`);
    const gates = (Array.isArray(node?.gates) ? node.gates : [])
      .slice(0, LIMITS.gates)
      .map(normalizeGate)
      .filter(Boolean);
    return { id: nodeId, label: clampText(node?.label, nodeId), kind: normalizeId(node?.kind, 'interior'), gates };
  });
}

export function planSettlementQuestObjectives({ definition, context = {}, currentNodeId = '' } = {}) {
  const rows = nodeRows(definition);
  const currentId = normalizeId(currentNodeId || definition?.entryNodeId);
  const objectives = rows.map((node, index) => {
    const gateResult = evaluateSettlementGates(node.gates, context);
    const isCurrent = node.id === currentId;
    const status = gateResult.ok ? (isCurrent ? 'ready' : 'available') : (isCurrent ? 'blocked' : 'locked');
    return freeze({
      sequence: index + 1,
      nodeId: node.id,
      nodeLabel: node.label,
      nodeKind: node.kind,
      current: isCurrent,
      status,
      actionable: status === 'ready' || status === 'available',
      reasons: freeze(gateResult.reasons.slice(0, LIMITS.gates)),
      gates: freeze(node.gates),
    });
  });
  const readyCount = objectives.filter((objective) => objective.actionable).length;
  return freeze({
    version: 1,
    currentNodeId: currentId,
    objectives: freeze(objectives),
    counts: freeze({ total: objectives.length, actionable: readyCount, blocked: objectives.length - readyCount }),
  });
}

export function summarizeSettlementQuestObjectives(plan) {
  const safePlan = plan && typeof plan === 'object' ? plan : {};
  const objectives = Array.isArray(safePlan.objectives) ? safePlan.objectives : [];
  const current = objectives.find((objective) => objective.current) || null;
  return freeze({
    current: current ? freeze({ nodeId: current.nodeId, label: current.nodeLabel, status: current.status }) : null,
    actionable: objectives.filter((objective) => objective.actionable).map((objective) => objective.nodeId),
    blocked: objectives.filter((objective) => !objective.actionable).map((objective) => objective.nodeId),
  });
}
