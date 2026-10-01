export type SettlementProgressLedgerService = 'blacksmith' | 'tavern' | 'market' | 'farm' | 'barracks' | 'stable';

export interface SettlementProgressLedgerReceipt {
  settlementId: string;
  service: SettlementProgressLedgerService;
  completedActions: readonly string[];
  requiredActions: readonly string[];
  completedCount: number;
  requiredCount: number;
  progress: number;
  readyToAdvance: boolean;
  signature: string;
}

const SERVICES = new Set<SettlementProgressLedgerService>([
  'blacksmith', 'tavern', 'market', 'farm', 'barracks', 'stable',
]);

const cleanId = (value: unknown, fallback: string) => {
  const text = typeof value === 'string' ? value.trim() : '';
  return text || fallback;
};

const sortedUnique = (values: unknown): string[] => {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.filter((value): value is string => typeof value === 'string' && value.trim().length > 0).map((value) => value.trim()))].sort();
};

const clamp01 = (value: number) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));

const hash = (value: string) => {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(16).padStart(8, '0');
};

const freeze = <T>(value: T): Readonly<T> => Object.freeze(value);

export function createSettlementProgressLedgerProjection(input: {
  settlementId?: unknown;
  service?: unknown;
  requiredActions?: unknown;
  completedActions?: unknown;
} = {}): Readonly<SettlementProgressLedgerReceipt> {
  const settlementId = cleanId(input.settlementId, 'settlement');
  const service = SERVICES.has(input.service as SettlementProgressLedgerService)
    ? input.service as SettlementProgressLedgerService
    : 'tavern';
  const requiredActions = sortedUnique(input.requiredActions);
  const completedActions = sortedUnique(input.completedActions).filter((action) => requiredActions.includes(action));
  const requiredCount = requiredActions.length;
  const completedCount = completedActions.length;
  const progress = requiredCount === 0 ? 0 : clamp01(completedCount / requiredCount);
  const signature = hash(JSON.stringify({ settlementId, service, requiredActions, completedActions }));

  return freeze({
    settlementId,
    service,
    completedActions: freeze(completedActions),
    requiredActions: freeze(requiredActions),
    completedCount,
    requiredCount,
    progress,
    readyToAdvance: requiredCount > 0 && completedCount === requiredCount,
    signature,
  });
}

export function isSettlementProgressLedgerReceipt(value: unknown): value is SettlementProgressLedgerReceipt {
  if (!value || typeof value !== 'object') return false;
  const receipt = value as SettlementProgressLedgerReceipt;
  return typeof receipt.settlementId === 'string'
    && SERVICES.has(receipt.service)
    && Array.isArray(receipt.completedActions)
    && Array.isArray(receipt.requiredActions)
    && Number.isInteger(receipt.completedCount)
    && Number.isInteger(receipt.requiredCount)
    && typeof receipt.progress === 'number'
    && typeof receipt.readyToAdvance === 'boolean'
    && typeof receipt.signature === 'string';
}
