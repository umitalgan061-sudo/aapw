import { buildSettlementInteriorCard, resolveSettlementInteriorAction, resolveSettlementTransition } from './settlementCampaignInterior.legacy.js';

export const SETTLEMENT_INTERIOR_RECEIPT_VERSION = 1 as const;
const ROLES = ['blacksmith','tavern','market','farm','barracks','stable','house','gate'] as const;
type Role = typeof ROLES[number];
type Phase = 'approach' | 'inside' | 'service' | 'departure';
type Result = 'ready' | 'blocked' | 'invalid-input';

const text = (value: unknown, fallback = ''): string => {
  const normalized = String(value ?? '').trim();
  return normalized ? normalized.slice(0, 160) : fallback;
};
const stable = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  return '{' + Object.keys(value as Record<string, unknown>).sort().map((key) => JSON.stringify(key)+':'+stable((value as Record<string, unknown>)[key])).join(',') + '}';
};
const digest = (value: unknown): string => {
  let hash = 2166136261;
  for (const char of stable(value)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};
const freeze = <T>(value: T): Readonly<T> => Object.freeze(value);

export interface SettlementInteriorReceiptInput {
  role: string;
  phase: string;
  action?: string;
  sourceKind?: string;
  targetKind?: string;
  sourceId?: string;
  targetId?: string;
  available?: boolean;
  questBlocked?: boolean;
  sourceAsset?: string;
  materialValidated?: boolean;
  materialManifestId?: string;
  groundAligned?: boolean;
  manifestProduced?: boolean;
  sceneAttached?: boolean;
}

export interface SettlementInteriorReceipt {
  version: 1;
  role: Role;
  phase: Phase;
  action: string;
  result: Result;
  reason: string;
  room: string;
  entrance: string;
  anchor: string;
  transitionEvent: string;
  placementReady: boolean;
  questBlocked: boolean;
  receiptKey: string;
}

const isRole = (value: string): value is Role => (ROLES as readonly string[]).includes(value);
const isPhase = (value: string): value is Phase => ['approach','inside','service','departure'].includes(value);

export function createSettlementInteriorReceipt(input: SettlementInteriorReceiptInput): Readonly<SettlementInteriorReceipt> {
  const role = text(input?.role);
  const phase = text(input?.phase);
  if (!isRole(role) || !isPhase(phase)) {
    return freeze({ version: 1, role: 'gate', phase: 'approach', action: '', result: 'invalid-input', reason: 'invalid-role-or-phase', room: '', entrance: '', anchor: '', transitionEvent: '', placementReady: false, questBlocked: false, receiptKey: 'invalid' });
  }
  const card = buildSettlementInteriorCard(role);
  const action = text(input.action, phase === 'approach' ? 'enter' : phase === 'departure' ? 'exit' : card?.activities[0]?.action ?? '');
  const actionCheck = resolveSettlementInteriorAction(role, action);
  const transitionType = phase === 'departure' ? 'exit' : phase === 'approach' ? 'enter' : null;
  const transition = transitionType ? resolveSettlementTransition(transitionType, { sourceKind: text(input.sourceKind, transitionType === 'enter' ? 'settlement' : 'interior'), targetKind: text(input.targetKind, transitionType === 'enter' ? 'interior' : 'settlement'), sourceId: input.sourceId, targetId: input.targetId }) : { ok: true, event: '' };
  const placementReady = Boolean(input.sourceAsset && input.materialValidated && input.materialManifestId && input.groundAligned && input.manifestProduced && input.sceneAttached);
  const questBlocked = input.questBlocked === true;
  const ready = input.available !== false && !questBlocked && actionCheck.ok && transition.ok && (phase === 'inside' || placementReady);
  const reason = questBlocked ? 'quest-blocked' : !actionCheck.ok ? actionCheck.reason : !transition.ok ? transition.reason : !placementReady && phase !== 'inside' ? 'placement-proof-required' : ready ? '' : 'interaction-unavailable';
  const receipt = { version: 1 as const, role, phase, action, result: ready ? 'ready' as const : 'blocked' as const, reason, room: card?.room ?? '', entrance: card?.entrance ?? '', anchor: card?.anchor ?? '', transitionEvent: transition.event ?? '', placementReady, questBlocked, receiptKey: '' };
  return freeze({ ...receipt, receiptKey: digest(receipt) });
}

export function isSettlementInteriorReceipt(value: unknown): value is SettlementInteriorReceipt {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<SettlementInteriorReceipt>;
  if (candidate.version !== 1 || !isRole(String(candidate.role)) || !isPhase(String(candidate.phase))) return false;
  if (!['ready','blocked','invalid-input'].includes(String(candidate.result))) return false;
  if (typeof candidate.receiptKey !== 'string' || candidate.receiptKey.length !== 8) return false;
  const copy = { ...candidate, receiptKey: '' };
  return candidate.receiptKey === digest(copy);
}

export const settlementInteriorReceiptRoles = (): readonly Role[] => ROLES;
