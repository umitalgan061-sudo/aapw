/**
 * Runtime bridge for settlement service UX.
 * Composes the existing interaction-owned state into a stable, DOM-free panel model.
 * No quest, inventory, economy, or placement framework is created here.
 * @module gameplay/settlementServiceRuntime
 */

import {
  buildSettlementServicePrompt,
  buildSettlementServiceUxState,
  getSettlementServiceCatalog,
} from './settlementServiceUx.js';

const DEFAULT_SERVICE_STATE = Object.freeze({
  discovered: false,
  open: false,
  inCombat: false,
});

function normalizeState(value) {
  const source = value && typeof value === 'object' ? value : {};
  return Object.freeze({
    discovered: source.discovered === true,
    open: source.open === true,
    inCombat: source.inCombat === true,
  });
}

function normalizeSettlementId(value) {
  const id = String(value ?? '').trim();
  return id || 'unknown-settlement';
}

function deriveServiceState(interactionState = {}, service) {
  const serviceState = interactionState?.settlements?.[service.id]
    ?? interactionState?.settlementServices?.[service.id]
    ?? interactionState?.services?.[service.id]
    ?? DEFAULT_SERVICE_STATE;
  return normalizeState(serviceState);
}

export function buildSettlementServicePanel(interactionState = {}, services) {
  const catalog = getSettlementServiceCatalog(services);
  const stateByService = Object.fromEntries(catalog.map((service) => [service.id, deriveServiceState(interactionState, service)]));
  const uxState = buildSettlementServiceUxState(stateByService, catalog);
  const entries = Object.freeze(uxState.services.map((entry) => Object.freeze({
    ...entry,
    prompt: buildSettlementServicePrompt(entry),
    enabled: entry.available,
  })));

  return Object.freeze({
    settlementId: normalizeSettlementId(interactionState?.settlementId ?? interactionState?.siteId),
    services: entries,
    availableServiceIds: uxState.availableServiceIds,
    blockedServiceIds: uxState.blockedServiceIds,
    primaryAction: uxState.availableServiceIds[0] ?? null,
    interactionMode: interactionState?.inCombat === true ? 'combat-locked' : 'settlement-services',
  });
}

export function getSettlementServiceAction(panel, serviceId) {
  const id = String(serviceId ?? '').trim();
  if (!panel || !Array.isArray(panel.services) || !id) return Object.freeze({ ok: false, reason: 'invalid-selection' });
  const entry = panel.services.find((service) => service.serviceId === id);
  if (!entry) return Object.freeze({ ok: false, reason: 'unknown-service', serviceId: id });
  if (!entry.enabled) return Object.freeze({ ok: false, reason: entry.reason, serviceId: id, prompt: entry.prompt });
  return Object.freeze({ ok: true, serviceId: id, action: entry.action, role: entry.role, prompt: entry.prompt });
}

export function buildSettlementServiceRuntimeEvidence(interactionState = {}, services) {
  const panel = buildSettlementServicePanel(interactionState, services);
  return Object.freeze({
    panel,
    catalogSize: panel.services.length,
    availableCount: panel.availableServiceIds.length,
    blockedCount: panel.blockedServiceIds.length,
    deterministicKey: panel.services.map((entry) => `${entry.serviceId}:${entry.reason}:${entry.action}`).join('|'),
    noDuplicateServiceIds: new Set(panel.services.map((entry) => entry.serviceId)).size === panel.services.length,
  });
}
