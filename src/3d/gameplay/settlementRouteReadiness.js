const MAX_ROUTES = 24;
const MAX_REASONS = 8;

const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const text = (value, fallback = '') => typeof value === 'string' ? value.trim() : fallback;
const bool = (value) => value === true;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const stable = (value) => {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
};
const freeze = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) freeze(child);
  return value;
};

function normalizeRoute(route, index) {
  const id = text(route?.id, `route-${index + 1}`);
  const name = text(route?.name, id);
  const cost = Math.max(0, Math.round(finite(route?.cost, 0)));
  const fatigue = Math.max(0, Math.round(finite(route?.fatigue, 0)));
  const minReputation = Math.round(finite(route?.minReputation, 0));
  const requiredSkill = Math.max(0, Math.round(finite(route?.requiredSkill, 0)));
  const requiredItem = text(route?.requiredItem, '');
  const destination = text(route?.destination, id);
  return { id, name, destination, cost, fatigue, minReputation, requiredSkill, requiredItem, enabled: route?.enabled !== false };
}

function evaluate(route, context) {
  const reasons = [];
  if (!context.insideSettlement) reasons.push('outside-settlement');
  if (context.defeated) reasons.push('defeated');
  if (!route.enabled) reasons.push('route-disabled');
  if (context.copper < route.cost) reasons.push('insufficient-copper');
  if (context.fatigue + route.fatigue > context.maxFatigue) reasons.push('fatigue-limit');
  if (context.reputation < route.minReputation) reasons.push('reputation-required');
  if (context.skill < route.requiredSkill) reasons.push('skill-required');
  if (route.requiredItem && (context.items[route.requiredItem] ?? 0) < 1) reasons.push('item-required');
  return { available: reasons.length === 0, reasons: reasons.slice(0, MAX_REASONS) };
}

export function buildSettlementRouteReadiness(input = {}) {
  const contextInput = input.context ?? input;
  const context = {
    insideSettlement: bool(contextInput.insideSettlement ?? contextInput.inSettlement),
    defeated: bool(contextInput.defeated),
    copper: Math.max(0, Math.round(finite(contextInput.copper, 0))),
    fatigue: Math.max(0, Math.round(finite(contextInput.fatigue, 0))),
    maxFatigue: Math.max(0, Math.round(finite(contextInput.maxFatigue, 100))),
    reputation: Math.round(finite(contextInput.reputation, 0)),
    skill: Math.max(0, Math.round(finite(contextInput.skill, 0))),
    items: Object.fromEntries(Object.entries(contextInput.items && typeof contextInput.items === 'object' ? contextInput.items : {}).map(([key, value]) => [key, Math.max(0, Math.floor(finite(value, 0)))])),
  };
  const routes = (Array.isArray(input.routes) ? input.routes : []).slice(0, MAX_ROUTES).map(normalizeRoute).sort((a, b) => a.id.localeCompare(b.id));
  const rows = routes.map((route) => {
    const result = evaluate(route, context);
    return { ...route, ...result, reason: result.reasons[0] ?? null, estimatedFatigue: context.fatigue + route.fatigue, estimatedCopper: Math.max(0, context.copper - route.cost) };
  });
  const available = rows.filter((row) => row.available);
  const primary = available[0] ?? rows[0] ?? null;
  const snapshot = {
    version: 1,
    context: { ...context, items: { ...context.items } },
    routes: rows,
    counts: { total: rows.length, available: available.length, blocked: rows.length - available.length },
    primaryRouteId: primary?.id ?? null,
    nextAction: primary ? (primary.available ? 'travel' : 'resolve-blocker') : 'none',
    ownership: ['SettlementCampaignRuntime', 'QuestSystem', 'Inventory', 'Economy', 'Travel', 'SaveLoad'],
  };
  snapshot.fingerprint = stable(snapshot);
  return freeze(snapshot);
}

export function validateSettlementRouteReadiness(value) {
  return Boolean(value && value.version === 1 && Array.isArray(value.routes) && value.routes.length <= MAX_ROUTES && value.counts && typeof value.fingerprint === 'string');
}
