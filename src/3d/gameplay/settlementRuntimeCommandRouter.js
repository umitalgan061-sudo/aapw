/**
 * Runtime-facing command router for the authored settlement content contract.
 *
 * This module only classifies and preflights commands. Authoritative handlers,
 * state mutation, persistence and scene ownership remain injected by callers.
 */
import {
  getSettlementService,
  resolveCraftingRecipe,
  resolveTradeQuote,
  resolveTravelCost,
} from './settlementCampaignContent.js';

const ACTIONS = Object.freeze(['talk', 'trade', 'buy', 'sell', 'craft', 'travel', 'rest', 'save']);

function cleanText(value, fallback = '') {
  return typeof value === 'string' ? value.trim().slice(0, 96) : fallback;
}

function cleanCount(value, fallback = 1) {
  const count = Math.trunc(Number(value));
  return Number.isFinite(count) ? Math.max(1, Math.min(999, count)) : fallback;
}

function buildBase(command) {
  return {
    serviceId: cleanText(command?.serviceId),
    action: cleanText(command?.action),
    requestId: cleanText(command?.requestId),
  };
}

export function routeSettlementCommand(command = {}, snapshot = {}) {
  const base = buildBase(command);
  if (!base.serviceId || !ACTIONS.includes(base.action)) {
    return Object.freeze({ ok: false, reason: 'invalid-command', ...base });
  }

  const service = getSettlementService(base.serviceId);
  if (!service) return Object.freeze({ ok: false, reason: 'unknown-service', ...base });
  if (!service.actions.includes(base.action)) {
    return Object.freeze({ ok: false, reason: 'unsupported-action', ...base, serviceLabel: service.label });
  }

  if (base.action === 'buy' || base.action === 'sell') {
    const quote = resolveTradeQuote(cleanText(command.itemId), cleanCount(command.quantity), base.action, snapshot.tradeModifiers);
    return Object.freeze({ ...base, serviceLabel: service.label, domain: service.domain, preflight: quote, handler: 'trade' });
  }

  if (base.action === 'craft') {
    const result = resolveCraftingRecipe(cleanText(command.recipeId), snapshot);
    return Object.freeze({ ...base, serviceLabel: service.label, domain: service.domain, preflight: result, handler: 'craft' });
  }

  if (base.action === 'travel') {
    const result = resolveTravelCost(cleanText(command.routeId), snapshot.travelModifiers);
    return Object.freeze({ ...base, serviceLabel: service.label, domain: service.domain, preflight: result, handler: 'travel' });
  }

  return Object.freeze({
    ...base,
    serviceLabel: service.label,
    domain: service.domain,
    preflight: { ok: true, reason: 'ready' },
    handler: base.action,
  });
}

export function createSettlementCommandBatch(commands = [], snapshot = {}) {
  const list = Array.isArray(commands) ? commands : [];
  const bounded = list.slice(0, 32).map((command) => routeSettlementCommand(command, snapshot));
  const ready = bounded.filter((entry) => entry.preflight?.ok === true).length;
  return Object.freeze({
    count: bounded.length,
    ready,
    blocked: bounded.length - ready,
    commands: Object.freeze(bounded),
  });
}

export function serializeSettlementCommandResult(result = {}) {
  return JSON.stringify({
    ok: result.ok === true,
    reason: cleanText(result.reason),
    serviceId: cleanText(result.serviceId),
    action: cleanText(result.action),
    handler: cleanText(result.handler),
    preflight: result.preflight && typeof result.preflight === 'object' ? result.preflight : null,
  });
}
