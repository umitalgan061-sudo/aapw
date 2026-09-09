const MAX_MILESTONES = 16;
const MAX_HISTORY = 24;

const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const text = (value, fallback = '') => typeof value === 'string' && value.trim() ? value.trim() : fallback;
const clamp = (value, min, max) => Math.min(max, Math.max(min, finite(value, min)));
const idOf = (value, fallback) => text(value, fallback).slice(0, 96);

const stable = value => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
};

const freezeDeep = value => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(freezeDeep);
  return Object.freeze(value);
};

const normalizeMilestone = (row, index) => {
  const source = row && typeof row === 'object' ? row : {};
  const status = ['locked', 'available', 'active', 'complete'].includes(source.status) ? source.status : 'locked';
  const progress = clamp(source.progress, 0, 1);
  return {
    id: idOf(source.id, `milestone-${index + 1}`),
    label: text(source.label, `Milestone ${index + 1}`),
    kind: ['quest', 'dialogue', 'trade', 'craft', 'travel', 'rest', 'save'].includes(source.kind) ? source.kind : 'quest',
    status,
    progress,
    action: text(source.action, status === 'complete' ? 'review' : 'continue'),
    serviceId: idOf(source.serviceId, ''),
    questId: idOf(source.questId, ''),
    rewardCopper: Math.max(0, Math.floor(finite(source.rewardCopper, 0))),
    rewardXp: Math.max(0, Math.floor(finite(source.rewardXp, 0)))
  };
};

const normalizeHistory = history => (Array.isArray(history) ? history : []).slice(-MAX_HISTORY).map((entry, index) => ({
  id: idOf(entry?.id, `event-${index + 1}`),
  type: text(entry?.type, 'unknown'),
  milestoneId: idOf(entry?.milestoneId, ''),
  ok: entry?.ok !== false,
  sequence: Math.max(0, Math.floor(finite(entry?.sequence, index))),
  timestamp: Math.max(0, Math.floor(finite(entry?.timestamp, 0)))
})).sort((a, b) => a.sequence - b.sequence || a.id.localeCompare(b.id));

export const buildSettlementMilestoneBoard = (snapshot = {}, input = {}) => {
  const state = snapshot && typeof snapshot === 'object' ? snapshot : {};
  const milestones = (Array.isArray(input.milestones) ? input.milestones : []).slice(0, MAX_MILESTONES).map(normalizeMilestone);
  const history = normalizeHistory(input.history);
  const active = milestones.filter(row => row.status === 'active');
  const available = milestones.filter(row => row.status === 'available');
  const complete = milestones.filter(row => row.status === 'complete');
  const blocked = milestones.filter(row => row.status === 'locked');
  const primary = active[0] || available[0] || complete[0] || milestones[0] || null;
  const board = {
    version: 1,
    settlementId: idOf(state.settlementId || state.locationId, 'settlement'),
    insideSettlement: state.settlementId !== undefined || state.locationId !== undefined,
    defeated: finite(state.health, 1) <= 0,
    copper: Math.max(0, Math.floor(finite(state.copper, 0))),
    counts: { total: milestones.length, active: active.length, available: available.length, complete: complete.length, blocked: blocked.length },
    primaryMilestoneId: primary?.id || '',
    primaryAction: primary?.action || 'enter',
    milestones,
    history,
    rewardPreview: {
      copper: complete.reduce((sum, row) => sum + row.rewardCopper, 0),
      xp: complete.reduce((sum, row) => sum + row.rewardXp, 0)
    },
    digest: ''
  };
  board.digest = stable({ ...board, digest: undefined });
  return freezeDeep(board);
};

export const serializeSettlementMilestoneBoard = board => stable(board && typeof board === 'object' ? board : {});

export const validateSettlementMilestoneBoard = board => {
  const value = board && typeof board === 'object' ? board : {};
  const errors = [];
  if (value.version !== 1) errors.push('version');
  if (!value.counts || value.counts.total !== (Array.isArray(value.milestones) ? value.milestones.length : -1)) errors.push('counts.total');
  if (value.digest !== stable({ ...value, digest: undefined })) errors.push('digest');
  if (!Object.isFrozen(value)) errors.push('frozen');
  return { ok: errors.length === 0, errors };
};
