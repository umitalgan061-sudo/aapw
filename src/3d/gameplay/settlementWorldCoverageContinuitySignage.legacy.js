/**
 * Read-only signage and wayfinding planner for settlement boundaries.
 * It consumes existing service/route vocabulary and emits UI-ready cues.
 */
import {
  getSettlementService,
  getSettlementRoute,
} from './settlementCampaignContent.js';
import {
  SETTLEMENT_WORLD_COVERAGE_CONTINUITY_TIME_PHASES,
} from './settlementWorldCoverageContinuityAtmosphere.js';

export const SETTLEMENT_WORLD_COVERAGE_CONTINUITY_SIGNAGE_VERSION = 1;
export const SETTLEMENT_WORLD_COVERAGE_CONTINUITY_SIGN_TYPES = Object.freeze([
  'gateway', 'service', 'route', 'warning', 'checkpoint', 'landmark',
]);

const SERVICES = Object.freeze(['gate','market','tavern','blacksmith','farm','barracks','stable','house']);
const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp01 = (value, fallback = 0) => Math.max(0, Math.min(1, number(value, fallback)));
const text = (value, fallback = '') => {
  const normalized = String(value ?? '').trim();
  return normalized ? normalized.slice(0, 120) : fallback;
};
const freeze = (value, seen = new Set()) => {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value); Object.freeze(value);
  for (const child of Object.values(value)) freeze(child, seen);
  return value;
};
const stable = (value) => value === null || typeof value !== 'object'
  ? JSON.stringify(value)
  : Array.isArray(value)
    ? `[${value.map(stable).join(',')}]`
    : `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
const digest = (value) => {
  let hash = 2166136261; const source = stable(value);
  for (let index = 0; index < source.length; index += 1) { hash ^= source.charCodeAt(index); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

function stageMultiplier(stage) {
  return { far:.25, approach:.58, threshold:.9, inside:1, service:1, departure:.64, resume:.76 }[stage] ?? .5;
}
function weatherMultiplier(weather = {}) {
  const type = text(weather.type, 'clear');
  const visibility = clamp01(weather.visibility, .9);
  const intensity = clamp01(weather.intensity, 0);
  const precipitation = clamp01(weather.precipitation, 0);
  const storm = type === 'storm' ? .55 : type === 'fog' ? .7 : type === 'snow' ? .78 : 1;
  return clamp01(visibility * storm * (1 - intensity * .16) * (1 - precipitation * .12));
}
function timeMultiplier(phase) {
  if (!SETTLEMENT_WORLD_COVERAGE_CONTINUITY_TIME_PHASES.includes(phase)) return .7;
  return { 'pre-dawn':.42, dawn:.72, morning:1, midday:1, afternoon:.98, dusk:.74, evening:.52, night:.3 }[phase];
}
function serviceLabel(serviceId) {
  const service = getSettlementService(serviceId);
  return text(service?.label, serviceId);
}
function routeLabel(routeId) {
  const route = getSettlementRoute(routeId);
  return text(route?.label, routeId);
}
function signTitle(type, targetId) {
  if (type === 'gateway') return 'Settlement Gate';
  if (type === 'route') return routeLabel(targetId);
  if (type === 'checkpoint') return 'Checkpoint';
  if (type === 'warning') return 'Caution';
  return serviceLabel(targetId);
}
function signCopy(type, targetId, state) {
  if (type === 'gateway') return state === 'available' ? 'Enter settlement' : state === 'approach-only' ? 'Settlement ahead' : 'Settlement access unavailable';
  if (type === 'route') return `${routeLabel(targetId)} →`;
  if (type === 'checkpoint') return 'Resume from here';
  if (type === 'warning') return 'Visibility or access is reduced';
  return `${serviceLabel(targetId)} available`;
}

export function buildSettlementWorldCoverageSignage({
  settlementId = 'settlement',
  stage = 'far',
  gatewayState = 'blocked',
  services = SERVICES,
  routeId = 'north_gate',
  distanceMeters = 150,
  atmosphere = {},
  checkpoint = null,
  mobile = false,
  serviceFocus = null,
} = {}) {
  const normalizedDistance = Math.max(0, number(distanceMeters, 150));
  const visibility = weatherMultiplier(atmosphere.weather);
  const time = timeMultiplier(text(atmosphere.time?.phase, 'midday'));
  const stageFactor = stageMultiplier(stage);
  const base = clamp01(stageFactor * visibility * time * (mobile ? .86 : 1));
  const signs = [];
  const add = (type, targetId, priorityBias = 0) => {
    const serviceId = SERVICES.includes(targetId) ? targetId : null;
    if (type === 'service' && !serviceId) return;
    const priority = clamp01(base + priorityBias + (type === 'gateway' ? .16 : 0) + (targetId === serviceFocus ? .12 : 0));
    signs.push({
      id: `${settlementId}:${type}:${targetId}`,
      type,
      targetId,
      title: signTitle(type, targetId),
      copy: signCopy(type, targetId, gatewayState),
      priority: Math.round(priority * 1000) / 1000,
      visible: priority >= .22,
      distanceMeters: Math.round(normalizedDistance * 10) / 10,
      mobile,
    });
  };
  if (gatewayState !== 'inside') add('gateway', 'gate', .1);
  if (stage === 'threshold' || stage === 'inside' || stage === 'service') {
    for (const serviceId of services.filter((id) => SERVICES.includes(id)).slice(0, 8)) add('service', serviceId, serviceId === serviceFocus ? .08 : 0);
  } else if (stage === 'approach') {
    for (const serviceId of services.filter((id) => SERVICES.includes(id)).slice(0, 3)) add('service', serviceId, -.12);
  }
  if (routeId) add('route', routeId, stage === 'departure' ? .1 : -.04);
  if (checkpoint) add('checkpoint', checkpoint.activeService || 'house', stage === 'resume' ? .18 : -.1);
  if (visibility < .45) add('warning', 'visibility', .08);
  signs.sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
  return freeze({ version: SETTLEMENT_WORLD_COVERAGE_CONTINUITY_SIGNAGE_VERSION, settlementId: text(settlementId, 'settlement'), stage, gatewayState, visibility, timeMultiplier:time, stageMultiplier:stageFactor, signs, signCount:signs.length, readableCount:signs.filter((sign)=>sign.visible).length, fingerprint:digest(signs) });
}

export function chooseSettlementWorldCoveragePrimarySign(signage) {
  const visible = (signage?.signs || []).filter((sign) => sign.visible);
  return freeze(visible[0] || null);
}

export function validateSettlementWorldCoverageSignage(input = {}) {
  const result = buildSettlementWorldCoverageSignage(input);
  const errors = [];
  if (!SETTLEMENT_WORLD_COVERAGE_CONTINUITY_SIGN_TYPES.includes(result.signs[0]?.type) && result.signCount > 0) errors.push('unknown-sign-type');
  if (result.signs.some((sign) => sign.priority < 0 || sign.priority > 1)) errors.push('priority-range');
  if (result.signs.some((sign) => !sign.id || !sign.title || !sign.copy)) errors.push('sign-completeness');
  if (result.readableCount > result.signCount) errors.push('readable-count');
  return freeze({ ok: errors.length === 0, errors, fingerprint: result.fingerprint });
}

export const SETTLEMENT_WORLD_COVERAGE_CONTINUITY_SIGNAGE_API = Object.freeze({
  version: SETTLEMENT_WORLD_COVERAGE_CONTINUITY_SIGNAGE_VERSION,
  signTypes: [...SETTLEMENT_WORLD_COVERAGE_CONTINUITY_SIGN_TYPES],
  serviceCount: SERVICES.length,
});
