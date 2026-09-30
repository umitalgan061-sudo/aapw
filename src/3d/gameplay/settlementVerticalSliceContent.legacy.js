/**
 * Authored settlement service-flow content for the existing vertical slice coordinator.
 *
 * This module describes a useful order of service encounters; it does not create geography,
 * spawn models/NPCs, own quest data, or mutate inventory/economy. Existing settlement callers
 * may translate the returned role ids into their canonical POI/node ids.
 */

export const SETTLEMENT_CONTENT_VERSION = 1;

const SERVICE_ROLES = Object.freeze([
  'gate',
  'market',
  'tavern',
  'blacksmith',
  'farm',
  'barracks',
  'stable',
  'house',
]);

const SERVICE_ORDER = Object.freeze({
  arrival: Object.freeze(['gate', 'market', 'tavern']),
  commerce: Object.freeze(['market', 'blacksmith', 'farm']),
  progression: Object.freeze(['tavern', 'blacksmith', 'barracks']),
  departure: Object.freeze(['stable', 'gate']),
  recovery: Object.freeze(['tavern', 'house']),
});

const ROLE_PURPOSE = Object.freeze({
  gate: 'arrival/departure',
  market: 'trade',
  tavern: 'dialogue/rest/quest',
  blacksmith: 'crafting/smithing/trade',
  farm: 'trade/supply',
  barracks: 'dialogue/security',
  stable: 'travel',
  house: 'rest/save',
});

const ROLE_HOOKS = Object.freeze({
  gate: Object.freeze(['enter', 'exit', 'travel']),
  market: Object.freeze(['trade']),
  tavern: Object.freeze(['talk', 'interact', 'acceptQuest']),
  blacksmith: Object.freeze(['craft', 'trade']),
  farm: Object.freeze(['interact', 'trade', 'travel']),
  barracks: Object.freeze(['talk', 'interact']),
  stable: Object.freeze(['interact', 'travel']),
  house: Object.freeze(['interact', 'talk', 'save']),
});

function clean(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text ? text.slice(0, 96) : fallback;
}

function boundedArray(value, limit = 12) {
  return Array.isArray(value) ? value.map((entry) => clean(entry)).filter(Boolean).slice(0, limit) : [];
}

function normalizeRole(role) {
  const normalized = clean(role);
  return SERVICE_ROLES.includes(normalized) ? normalized : '';
}

function hash(value) {
  const source = typeof value === 'string' ? value : stable(value);
  let result = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    result ^= source.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(16).padStart(8, '0');
}

function stable(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
}

export function listSettlementContentRoles() {
  return Object.freeze(SERVICE_ROLES.slice());
}

export function isSettlementRole(role) {
  return normalizeRole(role) !== '';
}

export function getSettlementContentHooks(role) {
  const normalized = normalizeRole(role);
  return normalized ? Object.freeze(ROLE_HOOKS[normalized].slice()) : Object.freeze([]);
}

export function getSettlementRolePurpose(role) {
  return ROLE_PURPOSE[normalizeRole(role)] || '';
}

export function getSettlementServiceOrder(chapter = 'arrival') {
  const key = clean(chapter, 'arrival');
  return Object.freeze((SERVICE_ORDER[key] || []).slice());
}

export function buildSettlementContentBeat(role, options = {}) {
  const normalizedRole = normalizeRole(role);
  if (!normalizedRole) return null;
  const hooks = getSettlementContentHooks(normalizedRole);
  const targetId = clean(options.targetId, `${normalizedRole}-node`);
  return Object.freeze({
    version: SETTLEMENT_CONTENT_VERSION,
    role: normalizedRole,
    targetId,
    purpose: getSettlementRolePurpose(normalizedRole),
    hooks,
    required: options.required === true,
    questHook: clean(options.questHook),
    rewardHook: clean(options.rewardHook),
    hint: clean(options.hint, `Bir sonraki adım: ${normalizedRole}`),
  });
}

export function buildSettlementContentJourney(options = {}) {
  const requested = Array.isArray(options.roles) && options.roles.length
    ? options.roles.map(normalizeRole).filter(Boolean)
    : getSettlementServiceOrder(options.chapter || 'arrival');
  const unique = [...new Set(requested)].slice(0, 8);
  const beats = unique.map((role, index) => buildSettlementContentBeat(role, {
    targetId: options.targets?.[role],
    required: Array.isArray(options.requiredRoles) && options.requiredRoles.includes(role),
    questHook: options.questHooks?.[role],
    rewardHook: options.rewardHooks?.[role],
    hint: options.hints?.[role],
  }));
  return Object.freeze({
    version: SETTLEMENT_CONTENT_VERSION,
    chapter: clean(options.chapter, 'custom'),
    settlementId: clean(options.settlementId, 'settlement'),
    beats: Object.freeze(beats),
    firstRole: beats[0]?.role || '',
    lastRole: beats[beats.length - 1]?.role || '',
    beatCount: beats.length,
    fingerprint: hash({
      chapter: clean(options.chapter, 'custom'),
      settlementId: clean(options.settlementId, 'settlement'),
      beats,
    }),
  });
}

export function validateSettlementContentJourney(journey = {}) {
  const errors = [];
  if (journey.version !== SETTLEMENT_CONTENT_VERSION) errors.push('unsupported-version');
  if (!clean(journey.settlementId)) errors.push('missing-settlement-id');
  if (!Array.isArray(journey.beats) || !journey.beats.length) errors.push('missing-beats');
  const roles = new Set();
  for (const [index, beat] of (journey.beats || []).entries()) {
    const role = normalizeRole(beat?.role);
    if (!role) errors.push(`invalid-role:${index}`);
    if (roles.has(role)) errors.push(`duplicate-role:${role}`);
    roles.add(role);
    if (!clean(beat?.targetId)) errors.push(`missing-target:${role || index}`);
    if (!Array.isArray(beat?.hooks) || !beat.hooks.length) errors.push(`missing-hooks:${role || index}`);
  }
  return Object.freeze({ ok: errors.length === 0, errors: Object.freeze(errors), beatCount: Array.isArray(journey.beats) ? journey.beats.length : 0 });
}

export function buildSettlementContentCheckpoint(journey, completedRoles = []) {
  const valid = validateSettlementContentJourney(journey);
  const completed = new Set(boundedArray(completedRoles, 8).map(normalizeRole).filter(Boolean));
  const progress = (journey?.beats || []).map((beat, index) => Object.freeze({
    index,
    role: normalizeRole(beat?.role),
    targetId: clean(beat?.targetId),
    completed: completed.has(normalizeRole(beat?.role)),
  }));
  const completedCount = progress.filter((entry) => entry.completed).length;
  return Object.freeze({
    ok: valid.ok,
    reason: valid.ok ? '' : valid.errors[0],
    beatCount: progress.length,
    completedCount,
    remainingCount: Math.max(0, progress.length - completedCount),
    complete: valid.ok && progress.length > 0 && completedCount === progress.length,
    next: progress.find((entry) => !entry.completed) || null,
    progress: Object.freeze(progress),
    fingerprint: hash({ valid, progress }),
  });
}

export function appendSettlementContentBeat(journey, role, options = {}) {
  const base = journey && typeof journey === 'object' ? journey : {};
  const current = Array.isArray(base.beats) ? base.beats.slice(0, 8) : [];
  const normalizedRole = normalizeRole(role);
  if (!normalizedRole || current.some((beat) => normalizeRole(beat?.role) === normalizedRole)) return null;
  return buildSettlementContentJourney({
    settlementId: clean(base.settlementId, 'settlement'),
    chapter: clean(base.chapter, 'custom'),
    roles: [...current.map((beat) => normalizeRole(beat?.role)).filter(Boolean), normalizedRole],
    targets: { [normalizedRole]: options.targetId },
    requiredRoles: options.required === true ? [normalizedRole] : [],
    questHooks: { [normalizedRole]: options.questHook },
    rewardHooks: { [normalizedRole]: options.rewardHook },
  });
}

export function settlementContentChapterNames() {
  return Object.freeze(Object.keys(SERVICE_ORDER));
}

export function summarizeSettlementContent(journey) {
  const validation = validateSettlementContentJourney(journey);
  const checkpoint = buildSettlementContentCheckpoint(journey, []);
  return Object.freeze({
    ok: validation.ok,
    settlementId: clean(journey?.settlementId),
    chapter: clean(journey?.chapter),
    beatCount: checkpoint.beatCount,
    requiredCount: (journey?.beats || []).filter((beat) => beat?.required === true).length,
    roles: Object.freeze((journey?.beats || []).map((beat) => normalizeRole(beat?.role)).filter(Boolean)),
    fingerprint: checkpoint.fingerprint,
  });
}

export function roleIsUsefulForChapter(role, chapter) {
  const normalizedRole = normalizeRole(role);
  const order = getSettlementServiceOrder(chapter);
  return Boolean(normalizedRole && order.includes(normalizedRole));
}

export function buildSettlementQuestHook(role, questId, options = {}) {
  const normalizedRole = normalizeRole(role);
  const normalizedQuest = clean(questId);
  if (!normalizedRole || !normalizedQuest) return null;
  return Object.freeze({
    version: SETTLEMENT_CONTENT_VERSION,
    role: normalizedRole,
    questId: normalizedQuest,
    trigger: clean(options.trigger, 'talk'),
    objective: clean(options.objective, `${normalizedRole} ile etkileş`),
    requiresRoleVisited: options.requiresRoleVisited === true,
    fingerprint: hash({ role: normalizedRole, questId: normalizedQuest, trigger: clean(options.trigger, 'talk'), objective: clean(options.objective, `${normalizedRole} ile etkileş`) }),
  });
}

export function buildSettlementTravelHook(originRole, destinationRole, options = {}) {
  const origin = normalizeRole(originRole);
  const destination = normalizeRole(destinationRole);
  if (!origin || !destination || origin === destination) return null;
  return Object.freeze({
    version: SETTLEMENT_CONTENT_VERSION,
    originRole: origin,
    destinationRole: destination,
    requiresRoadOpen: options.requiresRoadOpen !== false,
    requiresDiscovery: options.requiresDiscovery !== false,
    travelMode: clean(options.travelMode, 'road'),
    hint: clean(options.hint, `${origin} → ${destination}`),
  });
}
