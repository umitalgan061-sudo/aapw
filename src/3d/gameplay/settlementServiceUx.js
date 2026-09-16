/**
 * Deterministic UX model for settlement services already represented by the interaction economy.
 * This is intentionally a pure catalog/selector: it does not create a second quest, inventory, or economy owner.
 * Runtime callers can feed their existing interaction state and render the returned actions in any UI surface.
 * @module gameplay/settlementServiceUx
 */

const DEFAULT_SERVICES = Object.freeze([
  Object.freeze({ id: 'tavern', label: 'Taverna', role: 'rest', action: 'rest', requires: Object.freeze({ discovered: true, open: true, inCombat: false }) }),
  Object.freeze({ id: 'market', label: 'Pazar', role: 'trade', action: 'trade', requires: Object.freeze({ discovered: true, open: true, inCombat: false }) }),
  Object.freeze({ id: 'blacksmith', label: 'Demirci', role: 'smithing', action: 'smith', requires: Object.freeze({ discovered: true, open: true, inCombat: false }) }),
  Object.freeze({ id: 'stable', label: 'Ahır', role: 'travel', action: 'travel', requires: Object.freeze({ discovered: true, open: true, inCombat: false }) }),
  Object.freeze({ id: 'farm', label: 'Çiftlik', role: 'provisioning', action: 'provision', requires: Object.freeze({ discovered: true, open: true, inCombat: false }) }),
  Object.freeze({ id: 'barracks', label: 'Kışla', role: 'quest', action: 'quest', requires: Object.freeze({ discovered: true, open: true, inCombat: false }) }),
]);

function asBoolean(value) {
  return value === true;
}

function normalizeService(service, index) {
  const source = service && typeof service === 'object' ? service : {};
  const id = String(source.id ?? `service-${index + 1}`).trim();
  if (!id) return null;
  return Object.freeze({
    id,
    label: String(source.label ?? id).trim() || id,
    role: String(source.role ?? 'service').trim() || 'service',
    action: String(source.action ?? 'inspect').trim() || 'inspect',
    requires: Object.freeze({
      discovered: source.requires?.discovered !== false,
      open: source.requires?.open !== false,
      inCombat: source.requires?.inCombat === true,
    }),
  });
}

export function getSettlementServiceCatalog(services = DEFAULT_SERVICES) {
  const normalized = (Array.isArray(services) ? services : DEFAULT_SERVICES)
    .map(normalizeService)
    .filter(Boolean);
  return Object.freeze(normalized);
}

export function evaluateSettlementService(service, state = {}) {
  const normalized = normalizeService(service, 0);
  if (!normalized) return Object.freeze({ available: false, reason: 'invalid-service' });
  const reasons = [];
  if (normalized.requires.discovered && !asBoolean(state.discovered)) reasons.push('undiscovered');
  if (normalized.requires.open && !asBoolean(state.open)) reasons.push('closed');
  if (!normalized.requires.inCombat && asBoolean(state.inCombat)) reasons.push('in-combat');
  const available = reasons.length === 0;
  return Object.freeze({
    serviceId: normalized.id,
    label: normalized.label,
    role: normalized.role,
    action: normalized.action,
    available,
    reason: available ? 'available' : reasons[0],
    reasons: Object.freeze(reasons),
  });
}

export function buildSettlementServiceUxState(stateByService = {}, services = DEFAULT_SERVICES) {
  const catalog = getSettlementServiceCatalog(services);
  const entries = catalog.map((service) => evaluateSettlementService(service, stateByService?.[service.id] ?? {}));
  return Object.freeze({
    services: Object.freeze(entries),
    availableServiceIds: Object.freeze(entries.filter((entry) => entry.available).map((entry) => entry.serviceId)),
    blockedServiceIds: Object.freeze(entries.filter((entry) => !entry.available).map((entry) => entry.serviceId)),
  });
}

export function buildSettlementServicePrompt(entry) {
  if (!entry) return 'Hizmet seçilemedi.';
  if (entry.available) return `${entry.label}: ${entry.action} hazır.`;
  const reasonLabels = { undiscovered: 'keşfedilmedi', closed: 'kapalı', 'in-combat': 'çatışma sürüyor', 'invalid-service': 'geçersiz hizmet' };
  const reason = entry.reasons?.map((value) => reasonLabels[value] ?? value).join(', ') || reasonLabels[entry.reason] || 'uygun değil';
  return `${entry.label}: ${reason}.`;
}

export { DEFAULT_SERVICES as SETTLEMENT_SERVICE_CATALOG };
