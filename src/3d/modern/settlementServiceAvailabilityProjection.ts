export const SETTLEMENT_SERVICE_ORDER = Object.freeze([
  'blacksmith',
  'tavern',
  'market',
  'farm',
  'barracks',
  'stable',
]);

const SERVICE_LABELS = Object.freeze({
  blacksmith: 'Blacksmith',
  tavern: 'Tavern',
  market: 'Market',
  farm: 'Farm',
  barracks: 'Barracks',
  stable: 'Stable',
});

const asSortedIds = (value) => Array.isArray(value)
  ? Object.freeze([...new Set(value.filter((entry) => typeof entry === 'string' && entry.trim()).map((entry) => entry.trim()))].sort())
  : Object.freeze([]);

const normalizeStatus = (value) => value === 'available' || value === 'locked' || value === 'closed' || value === 'missing' ? value : 'missing';
const normalizeReason = (value) => typeof value === 'string' && value.trim() ? value.trim() : null;

export const projectSettlementServiceAvailability = (inputs) => {
  const source = Array.isArray(inputs) ? inputs : [];
  const byService = new Map();
  for (const candidate of source) {
    if (!candidate || typeof candidate !== 'object') continue;
    const service = typeof candidate.service === 'string' ? candidate.service.trim() : '';
    if (!SETTLEMENT_SERVICE_ORDER.includes(service) || byService.has(service)) continue;
    byService.set(service, Object.freeze({
      service,
      label: SERVICE_LABELS[service],
      status: normalizeStatus(candidate.status),
      availableActions: asSortedIds(candidate.availableActions),
      missingQuestIds: asSortedIds(candidate.missingQuestIds),
      reason: normalizeReason(candidate.reason),
    }));
  }

  const rows = SETTLEMENT_SERVICE_ORDER.map((service) => byService.get(service) ?? Object.freeze({
    service,
    label: SERVICE_LABELS[service],
    status: 'missing',
    availableActions: Object.freeze([]),
    missingQuestIds: Object.freeze([]),
    reason: 'service-unreported',
  }));
  const availableCount = rows.filter((row) => row.status === 'available').length;
  const blockedCount = rows.length - availableCount;
  const actionableCount = rows.reduce((total, row) => total + row.availableActions.length, 0);
  const signature = rows.map((row) => `${row.service}:${row.status}:${row.availableActions.join(',')}:${row.missingQuestIds.join(',')}:${row.reason ?? ''}`).join('|');
  return Object.freeze({ rows: Object.freeze(rows), availableCount, blockedCount, actionableCount, signature });
};
