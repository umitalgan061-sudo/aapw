/**
 * Deterministic, read-only action intent projection for the existing settlement loop.
 * The caller remains authoritative for QuestSystem, economy, crafting, travel, survival,
 * persistence and scene mutation. This module only converts service/quest state into a
 * bounded UX action surface for shipped runtime consumers.
 * @module gameplay/settlementActionIntentProjection
 */

const SERVICE_ACTIONS = Object.freeze({
  market: Object.freeze(['trade']),
  blacksmith: Object.freeze(['craft', 'repair']),
  tavern: Object.freeze(['rest', 'dialogue']),
  stable: Object.freeze(['travel']),
  farm: Object.freeze(['survival']),
  barracks: Object.freeze(['train']),
});

const ACTION_PRIORITY = Object.freeze({
  continueQuest: 0,
  collectReward: 1,
  talk: 2,
  trade: 3,
  craft: 4,
  repair: 5,
  rest: 6,
  travel: 7,
  survival: 8,
  train: 9,
  dialogue: 10,
});

function finiteNumber(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function positiveCount(value) {
  return Math.max(0, Math.floor(finiteNumber(value, 0)));
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function freezeDeep(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(freezeDeep);
  return Object.freeze(value);
}

function normalizeServices(services) {
  if (!services || typeof services !== 'object') return [];
  return Object.keys(services)
    .map((serviceId) => {
      const source = services[serviceId] && typeof services[serviceId] === 'object' ? services[serviceId] : {};
      const actions = Array.isArray(source.actions) && source.actions.length
        ? source.actions.filter((action) => typeof action === 'string' && action)
        : (SERVICE_ACTIONS[serviceId] || []);
      return {
        serviceId,
        label: typeof source.label === 'string' && source.label ? source.label : serviceId,
        actions: [...new Set(actions)],
        usable: source.usable !== false && source.status !== 'blocked',
        queueCount: positiveCount(source.queueCount),
        distance: Math.max(0, finiteNumber(source.distance, 0)),
      };
    })
    .sort((a, b) => a.serviceId.localeCompare(b.serviceId));
}

function questIntents(questState) {
  const state = questState && typeof questState === 'object' ? questState : {};
  const intents = [];
  if (state.active === true && typeof state.currentStep === 'string' && state.currentStep) {
    intents.push({
      action: 'continueQuest',
      label: state.currentLabel || `Continue ${state.currentStep}`,
      source: 'quest',
      stepId: state.currentStep,
      priority: ACTION_PRIORITY.continueQuest,
    });
  }
  if (positiveCount(state.rewardsReady) > 0) {
    intents.push({
      action: 'collectReward',
      label: 'Collect reward',
      source: 'quest',
      count: positiveCount(state.rewardsReady),
      priority: ACTION_PRIORITY.collectReward,
    });
  }
  return intents;
}

export function projectSettlementActionIntents(input = {}) {
  const inSettlement = input.inSettlement === true;
  const defeated = input.defeated === true;
  if (!inSettlement || defeated) {
    return freezeDeep({
      version: 1,
      status: defeated ? 'defeated' : 'outside-settlement',
      intents: [],
      services: [],
      availableCount: 0,
      blockedCount: 0,
      fingerprint: stableStringify({ status: defeated ? 'defeated' : 'outside-settlement', intents: [] }),
    });
  }

  const services = normalizeServices(input.services);
  const intents = [...questIntents(input.questState)];
  services.forEach((service) => {
    if (!service.usable) return;
    service.actions.forEach((action) => {
      if (!Object.prototype.hasOwnProperty.call(ACTION_PRIORITY, action)) return;
      intents.push({
        action,
        label: service.label,
        source: service.serviceId,
        queueCount: service.queueCount,
        distance: service.distance,
        priority: ACTION_PRIORITY[action],
      });
    });
  });

  intents.sort((a, b) => (a.priority - b.priority) || a.source.localeCompare(b.source) || a.action.localeCompare(b.action));
  const publicIntents = intents.map(({ priority, ...intent }) => intent);
  const blockedCount = services.filter((service) => !service.usable).length;
  const result = {
    version: 1,
    status: 'ready',
    intents: publicIntents,
    services,
    availableCount: publicIntents.length,
    blockedCount,
  };
  result.fingerprint = stableStringify(result);
  return freezeDeep(result);
}

export const SETTLEMENT_ACTION_INTENT_CONTRACT = Object.freeze({
  owner: 'Günbatımı Ustası',
  mutatesQuest: false,
  mutatesEconomy: false,
  mutatesInventory: false,
  mutatesScene: false,
  requiresMaterialPlacement: false,
});
