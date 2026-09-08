/**
 * Read-only settlement service board planner.
 *
 * Composes the existing authored settlement content into a bounded board for
 * shipped UI. It owns no quest, economy, inventory, travel or scene state.
 */
import { getSettlementService, listSettlementServices } from './settlementCampaignContent.js';

export const SETTLEMENT_SERVICE_BOARD_LIMITS = Object.freeze({ services: 8, actions: 6, text: 160 });

const PRIORITY = Object.freeze({ quest: 5, craft: 4, trade: 3, rest: 2, travel: 1, talk: 1, interact: 1, equip: 1, train: 1, save: 1 });
const ROLE_ACTION = Object.freeze({ blacksmith: 'craft', tavern: 'acceptQuest', market: 'trade', farm: 'interact', barracks: 'train', stable: 'travel', house: 'save', gate: 'travel' });

const text = (value, fallback = '') => { const v = String(value ?? '').trim(); return v ? v.slice(0, SETTLEMENT_SERVICE_BOARD_LIMITS.text) : fallback; };
const id = (value) => String(value ?? '').trim().slice(0, SETTLEMENT_SERVICE_BOARD_LIMITS.text);
const bool = (value) => value === true;

function normalizeContext(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  return {
    unlocked: new Set(Array.isArray(source.unlockedServices) ? source.unlockedServices.map(id).filter(Boolean) : listSettlementServices()),
    completed: new Set(Array.isArray(source.completedServices) ? source.completedServices.map(id).filter(Boolean) : []),
    fatigue: Math.max(0, Number.isFinite(Number(source.fatigue)) ? Number(source.fatigue) : 0),
    copper: Math.max(0, Number.isFinite(Number(source.copper)) ? Number(source.copper) : 0),
  };
}

function rank(service, context) {
  const action = ROLE_ACTION[service.id] || service.actions[0] || 'interact';
  let score = PRIORITY[action] || 1;
  if (context.completed.has(service.id)) score -= 1;
  if (service.id === 'tavern' && context.fatigue >= 60) score += 3;
  if (service.id === 'market' && context.copper < 10) score += 1;
  if (service.id === 'gate' && context.fatigue < 40) score += 1;
  return score;
}

function entry(service, context) {
  const action = ROLE_ACTION[service.id] || service.actions[0] || 'interact';
  const unlocked = context.unlocked.has(service.id);
  const completed = context.completed.has(service.id);
  const state = !unlocked ? 'locked' : completed ? 'complete' : 'ready';
  const reason = state === 'locked' ? 'service-locked' : state === 'complete' ? 'already-completed' : '';
  return Object.freeze({
    id: service.id,
    label: text(service.label, service.id),
    kind: text(service.kind, 'interior'),
    domain: text(service.domain, 'settlement'),
    prompt: text(service.prompt, 'Yerleşim hizmeti'),
    primaryAction: action,
    state,
    reason,
    actions: Object.freeze(service.actions.slice(0, SETTLEMENT_SERVICE_BOARD_LIMITS.actions)),
    recommended: state === 'ready',
  });
}

export function planSettlementServiceBoard(rawContext = {}) {
  const context = normalizeContext(rawContext);
  const services = listSettlementServices()
    .map((serviceId) => getSettlementService(serviceId))
    .filter(Boolean)
    .slice(0, SETTLEMENT_SERVICE_BOARD_LIMITS.services)
    .map((service) => entry(service, context))
    .sort((a, b) => (rank(getSettlementService(b.id), context) - rank(getSettlementService(a.id), context)) || a.id.localeCompare(b.id));
  const ready = services.filter((service) => service.state === 'ready').length;
  const locked = services.filter((service) => service.state === 'locked').length;
  return Object.freeze({
    version: 1,
    services: Object.freeze(services),
    readyCount: ready,
    lockedCount: locked,
    completedCount: services.length - ready - locked,
    recommendedServiceId: services.find((service) => service.recommended)?.id || '',
    summary: `${ready} hazır, ${locked} kilitli, ${services.length - ready - locked} tamamlandı`,
  });
}

export function serializeSettlementServiceBoard(board) {
  const value = board && typeof board === 'object' ? board : planSettlementServiceBoard();
  return JSON.stringify({ version: value.version, services: value.services, readyCount: value.readyCount, lockedCount: value.lockedCount, completedCount: value.completedCount, recommendedServiceId: value.recommendedServiceId, summary: value.summary });
}
