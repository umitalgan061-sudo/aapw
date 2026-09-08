/**
 * Deterministic command-palette projection for the existing settlement runtime.
 * It is presentation-only: callers still own command execution and state mutation.
 */
import { getSettlementService, getSettlementUxMessage } from './settlementCampaignContent.js';

export const SETTLEMENT_COMMAND_PALETTE_VERSION = 1;
const MAX_COMMANDS = 24;
const ACTIONS = Object.freeze([
  ['enter', 'Yerleşime gir', 'gate'],
  ['talk', 'Konuş', 'tavern'],
  ['trade', 'Takas ekranı', 'market'],
  ['craft', 'Üretim ekranı', 'blacksmith'],
  ['travel', 'Seyahat rotaları', 'gate'],
  ['rest', 'Dinlen', 'tavern'],
  ['train', 'Eğitim', 'barracks'],
  ['save', 'Oyunu kaydet', 'house'],
  ['exit', 'Yerleşimden çık', 'gate'],
]);
const text = (value, fallback = '') => {
  const normalized = String(value ?? '').trim();
  return normalized ? normalized.slice(0, 160) : fallback;
};
const finite = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};
const clamp = (value, min, max, fallback = min) => Math.max(min, Math.min(max, finite(value, fallback)));
const freeze = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) freeze(child);
  return value;
};
const stable = (value) => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
};
const digest = (value) => {
  let hash = 2166136261;
  const source = stable(value);
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

function normalizeContext(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const availableServices = new Set(Array.isArray(source.availableServices) ? source.availableServices.map((id) => text(id)) : []);
  const activeService = text(source.activeService);
  const inSettlement = source.inSettlement !== false;
  const fatigue = clamp(source.fatigue, 0, 100, 0);
  const health = clamp(source.health, 0, 100, 100);
  const copper = Math.max(0, Math.trunc(finite(source.copper, 0)));
  const canSave = source.canSave !== false;
  return { availableServices, activeService, inSettlement, fatigue, health, copper, canSave };
}

function commandState(action, serviceId, context) {
  if (!context.inSettlement && action !== 'enter') return { enabled: false, reason: 'settlement-required' };
  if (action === 'enter' && context.inSettlement) return { enabled: false, reason: 'already-inside' };
  if (action === 'exit' && !context.inSettlement) return { enabled: false, reason: 'already-outside' };
  if (action === 'save' && !context.canSave) return { enabled: false, reason: 'save-unavailable' };
  if (action === 'rest' && context.health >= 100 && context.fatigue <= 0) return { enabled: false, reason: 'already-ready' };
  if (action === 'train' && context.copper < 5) return { enabled: false, reason: 'insufficient-copper' };
  if (serviceId && context.availableServices.size > 0 && !context.availableServices.has(serviceId)) return { enabled: false, reason: 'service-locked' };
  return { enabled: true, reason: '' };
}

export function createSettlementCommandPalette(rawContext = {}, options = {}) {
  const context = normalizeContext(rawContext);
  const uxMessage = typeof options.uxMessage === 'function' ? options.uxMessage : getSettlementUxMessage;
  const commands = ACTIONS.map(([action, label, serviceId], index) => {
    const service = getSettlementService(serviceId);
    const state = commandState(action, serviceId, context);
    const messageId = state.enabled ? 'settlement-ready' : `settlement-${state.reason}`;
    return {
      index: index + 1,
      action,
      label: text(label, action),
      shortcut: `Digit${index + 1}`,
      serviceId,
      serviceLabel: text(service?.label, serviceId),
      enabled: state.enabled,
      reason: state.reason,
      feedback: text(uxMessage?.(messageId), state.reason),
    };
  }).slice(0, MAX_COMMANDS);
  const enabledCount = commands.filter((command) => command.enabled).length;
  const result = {
    version: SETTLEMENT_COMMAND_PALETTE_VERSION,
    context: {
      activeService: context.activeService,
      inSettlement: context.inSettlement,
      fatigue: context.fatigue,
      health: context.health,
      copper: context.copper,
      canSave: context.canSave,
    },
    commands,
    enabledCount,
    blockedCount: commands.length - enabledCount,
  };
  return freeze({ ...result, digest: digest(result) });
}

export function serializeSettlementCommandPalette(palette) {
  return stable(palette ?? createSettlementCommandPalette());
}
