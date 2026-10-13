const SERVICES = ['blacksmith', 'tavern', 'market', 'farm', 'barracks', 'stable'] as const;
const ACTIONS = ['craft', 'repair', 'rest', 'trade', 'gather', 'train', 'travel'] as const;
const OUTCOMES = ['completed', 'blocked', 'cancelled', 'failed'] as const;

type Service = typeof SERVICES[number];
type Action = typeof ACTIONS[number];
type Outcome = typeof OUTCOMES[number];

export type SettlementServiceOutcomeInput = {
  settlementId?: unknown;
  service?: unknown;
  action?: unknown;
  outcome?: unknown;
  receiptKey?: unknown;
  timestamp?: unknown;
  copperDelta?: unknown;
  experienceDelta?: unknown;
  itemDeltas?: unknown;
  questIds?: unknown;
};

export type SettlementServiceOutcomeReceipt = Readonly<{
  settlementId: string;
  service: Service;
  action: Action;
  outcome: Outcome;
  receiptKey: string;
  timestamp: number;
  copperDelta: number;
  experienceDelta: number;
  itemDeltas: readonly Readonly<{ itemId: string; quantityDelta: number }>[];
  questIds: readonly string[];
  signature: string;
}>;

const freeze = <T>(value: T): T => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) Object.freeze(value);
  return value;
};

const text = (value: unknown, fallback = '') => typeof value === 'string' ? value.trim() : fallback;
const int = (value: unknown, fallback = 0) => Number.isFinite(Number(value)) ? Math.trunc(Number(value)) : fallback;
const oneOf = <T extends readonly string[]>(value: unknown, values: T, fallback: T[number]) => values.includes(value as T[number]) ? value as T[number] : fallback;
const stable = (value: unknown): string => value === null || typeof value !== 'object'
  ? JSON.stringify(value)
  : Array.isArray(value)
    ? `[${value.map(stable).join(',')}]`
    : `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`).join(',')}}`;
const hash = (input: string) => {
  let value = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    value ^= input.charCodeAt(index);
    value = Math.imul(value, 16777619);
  }
  return (value >>> 0).toString(16).padStart(8, '0');
};

export function normalizeSettlementServiceOutcome(input: SettlementServiceOutcomeInput = {}): SettlementServiceOutcomeReceipt {
  const itemDeltas = Array.isArray(input.itemDeltas) ? input.itemDeltas : [];
  const normalizedItems = itemDeltas
    .map((entry) => ({
      itemId: text((entry as Record<string, unknown>)?.itemId),
      quantityDelta: int((entry as Record<string, unknown>)?.quantityDelta),
    }))
    .filter((entry) => entry.itemId)
    .sort((left, right) => left.itemId.localeCompare(right.itemId) || left.quantityDelta - right.quantityDelta);
  const questIds = Array.from(new Set((Array.isArray(input.questIds) ? input.questIds : [])
    .map((value) => text(value))
    .filter(Boolean))).sort();
  const base = {
    settlementId: text(input.settlementId, 'unknown-settlement'),
    service: oneOf(input.service, SERVICES, 'tavern'),
    action: oneOf(input.action, ACTIONS, 'rest'),
    outcome: oneOf(input.outcome, OUTCOMES, 'failed'),
    receiptKey: text(input.receiptKey, 'unkeyed'),
    timestamp: Math.max(0, int(input.timestamp)),
    copperDelta: int(input.copperDelta),
    experienceDelta: int(input.experienceDelta),
    itemDeltas: normalizedItems,
    questIds,
  };
  const signature = hash(stable(base));
  return freeze({ ...base, itemDeltas: freeze(normalizedItems.map(freeze)), questIds: freeze(questIds), signature });
}

export function isSettlementServiceOutcomeReceipt(value: unknown): value is SettlementServiceOutcomeReceipt {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as SettlementServiceOutcomeReceipt;
  return typeof candidate.settlementId === 'string'
    && SERVICES.includes(candidate.service)
    && ACTIONS.includes(candidate.action)
    && OUTCOMES.includes(candidate.outcome)
    && typeof candidate.signature === 'string'
    && Array.isArray(candidate.itemDeltas)
    && Array.isArray(candidate.questIds);
}

export function validateSettlementServiceOutcomeReceipt(value: unknown) {
  const errors: string[] = [];
  if (!isSettlementServiceOutcomeReceipt(value)) return { ok: false, errors: ['invalid-shape'] as const };
  const candidate = value as SettlementServiceOutcomeReceipt;
  const replay = normalizeSettlementServiceOutcome(candidate);
  if (replay.signature !== candidate.signature) errors.push('signature-mismatch');
  if (!Object.isFrozen(candidate) || !Object.isFrozen(candidate.itemDeltas) || !Object.isFrozen(candidate.questIds)) errors.push('not-frozen');
  return { ok: errors.length === 0, errors };
}
