// @ts-nocheck
/**
 * Bounded adapter between caller-owned gameplay state and saveGameRepository.js.
 *
 * The adapter intentionally has no knowledge of Three.js, DOM, renderer instances or concrete game
 * services. It creates a compact JSON-safe snapshot from explicit source fields and applies restores
 * through caller-owned callbacks. Unknown fields are discarded at the boundary.
 */

const SCHEMA = 'aapw.gameplay-snapshot';
const VERSION = 2;
const MAX_RECENT_EVENTS = 32;
const MAX_INVENTORY_ITEMS = 128;
const MAX_QUESTS = 128;
const MAX_EQUIPMENT = 32;
const MAX_WORLD_FLAGS = 256;
const MAX_STRING = 256;

function n(value, fallback = 0) { const x = Number(value); return Number.isFinite(x) ? x : fallback; }
function integer(value, fallback = 0) { return Math.round(n(value, fallback)); }
function clamp(value, low, high) { return Math.min(high, Math.max(low, n(value, low))); }
function text(value, fallback = '') { return typeof value === 'string' ? value.slice(0, MAX_STRING) : fallback; }
function bool(value) { return value === true; }
function boundedArray(value, limit) { return Array.isArray(value) ? value.slice(0, limit) : []; }
function safePrimitive(value) { return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value === null; }

function normalizePosition(position = {}) {
  return {
    x: Number(n(position.x).toFixed(3)),
    y: Number(n(position.y).toFixed(3)),
    z: Number(n(position.z).toFixed(3)),
  };
}

function normalizeInventory(items) {
  return boundedArray(items, MAX_INVENTORY_ITEMS).map((item) => ({
    id: text(item?.id ?? item?.itemId),
    quantity: clamp(integer(item?.quantity, 1), 0, 9999),
  })).filter((item) => item.id && item.quantity > 0);
}

function normalizeQuests(quests) {
  return boundedArray(quests, MAX_QUESTS).map((quest) => ({
    id: text(quest?.id ?? quest?.questId),
    state: text(quest?.state, 'unknown'),
    progress: clamp(quest?.progress, 0, 1),
  })).filter((quest) => quest.id);
}

function normalizeEquipment(equipment) {
  const source = equipment && typeof equipment === 'object' ? equipment : {};
  const output = {};
  for (const slot of Object.keys(source).slice(0, MAX_EQUIPMENT)) {
    const value = source[slot];
    if (safePrimitive(value)) output[text(slot)] = value;
    else if (value && typeof value === 'object') output[text(slot)] = text(value.id ?? value.itemId);
  }
  return output;
}

function normalizeWorldFlags(flags) {
  const source = flags && typeof flags === 'object' ? flags : {};
  const output = {};
  for (const key of Object.keys(source).sort().slice(0, MAX_WORLD_FLAGS)) {
    const value = source[key];
    if (safePrimitive(value)) output[text(key)] = value;
  }
  return output;
}

function normalizeRecentEvents(events) {
  return boundedArray(events, MAX_RECENT_EVENTS).map((event, index) => ({
    id: text(event?.id ?? `event-${index}`),
    type: text(event?.type, 'unknown'),
    at: Math.max(0, integer(event?.at, 0)),
  }));
}

export function buildGameplaySnapshot(source = {}, options = {}) {
  const player = source.player ?? {};
  const world = source.world ?? {};
  const snapshot = {
    schema: SCHEMA,
    version: VERSION,
    capturedAtMs: Math.max(0, integer(options.capturedAtMs, 0)),
    seed: integer(source.seed, 0),
    player: {
      id: text(player.id, 'player'),
      position: normalizePosition(player.position),
      health: clamp(player.health, 0, 100000),
      stamina: clamp(player.stamina, 0, 100000),
      poise: clamp(player.poise, 0, 100000),
      level: clamp(integer(player.level, 1), 1, 999),
      experience: clamp(integer(player.experience, 0), 0, 1000000000),
      inventory: normalizeInventory(player.inventory),
      equipment: normalizeEquipment(player.equipment),
    },
    world: {
      day: clamp(integer(world.day, 0), 0, 100000),
      timeOfDayMinutes: clamp(integer(world.timeOfDayMinutes, 720), 0, 1439),
      currentSettlementId: text(world.currentSettlementId ?? world.settlementId),
      visitedSettlementIds: boundedArray(world.visitedSettlementIds, MAX_WORLD_FLAGS).map((id) => text(id)).filter(Boolean),
      flags: normalizeWorldFlags(world.flags),
    },
    quests: normalizeQuests(source.quests),
    recentEvents: normalizeRecentEvents(source.recentEvents),
  };
  return Object.freeze(snapshot);
}

export function validateGameplaySnapshot(snapshot, { expectedSeed = null } = {}) {
  if (!snapshot || snapshot.schema !== SCHEMA) return { valid: false, reason: 'SCHEMA' };
  if (snapshot.version !== VERSION) return { valid: false, reason: 'VERSION', version: snapshot.version };
  if (expectedSeed !== null && integer(snapshot.seed) !== integer(expectedSeed)) return { valid: false, reason: 'SEED' };
  if (!snapshot.player || !snapshot.world) return { valid: false, reason: 'ROOT_FIELDS' };
  if (!snapshot.player.position || !Number.isFinite(snapshot.player.position.x) || !Number.isFinite(snapshot.player.position.z)) return { valid: false, reason: 'POSITION' };
  if (!Array.isArray(snapshot.player.inventory) || snapshot.player.inventory.length > MAX_INVENTORY_ITEMS) return { valid: false, reason: 'INVENTORY_LIMIT' };
  if (!Array.isArray(snapshot.quests) || snapshot.quests.length > MAX_QUESTS) return { valid: false, reason: 'QUEST_LIMIT' };
  if (!Array.isArray(snapshot.recentEvents) || snapshot.recentEvents.length > MAX_RECENT_EVENTS) return { valid: false, reason: 'EVENT_LIMIT' };
  return { valid: true, reason: 'OK', version: VERSION };
}

export function createRestorePlan(snapshot, options = {}) {
  const validation = validateGameplaySnapshot(snapshot, options);
  if (!validation.valid) return Object.freeze({ ok: false, reason: validation.reason, validation });
  const restore = {
    player: {
      position: normalizePosition(snapshot.player.position),
      health: clamp(snapshot.player.health, 0, 100000),
      stamina: clamp(snapshot.player.stamina, 0, 100000),
      poise: clamp(snapshot.player.poise, 0, 100000),
      level: clamp(snapshot.player.level, 1, 999),
      experience: clamp(snapshot.player.experience, 0, 1000000000),
      inventory: normalizeInventory(snapshot.player.inventory),
      equipment: normalizeEquipment(snapshot.player.equipment),
    },
    world: {
      day: clamp(snapshot.world.day, 0, 100000),
      timeOfDayMinutes: clamp(snapshot.world.timeOfDayMinutes, 0, 1439),
      currentSettlementId: text(snapshot.world.currentSettlementId),
      visitedSettlementIds: boundedArray(snapshot.world.visitedSettlementIds, MAX_WORLD_FLAGS).map(text).filter(Boolean),
      flags: normalizeWorldFlags(snapshot.world.flags),
    },
    quests: normalizeQuests(snapshot.quests),
    recentEvents: normalizeRecentEvents(snapshot.recentEvents),
  };
  return Object.freeze({ ok: true, seed: integer(snapshot.seed), version: VERSION, restore: Object.freeze(restore), validation });
}

export function applyRestorePlan(plan, handlers = {}) {
  if (!plan?.ok || !plan.restore) return { ok: false, reason: plan?.reason ?? 'INVALID_PLAN' };
  let applied = 0;
  try {
    if (typeof handlers.player === 'function') { handlers.player(plan.restore.player, plan.seed); applied += 1; }
    if (typeof handlers.world === 'function') { handlers.world(plan.restore.world, plan.seed); applied += 1; }
    if (typeof handlers.quests === 'function') { handlers.quests(plan.restore.quests, plan.seed); applied += 1; }
    if (typeof handlers.recentEvents === 'function') { handlers.recentEvents(plan.restore.recentEvents, plan.seed); applied += 1; }
    return Object.freeze({ ok: true, applied, seed: plan.seed, version: plan.version });
  } catch (error) {
    return { ok: false, reason: error?.message ?? 'RESTORE_HANDLER_ERROR', applied };
  }
}

export function summarizeGameplaySnapshot(snapshot = {}) {
  const validation = validateGameplaySnapshot(snapshot);
  if (!validation.valid) return Object.freeze({ valid: false, reason: validation.reason });
  return Object.freeze({
    valid: true,
    seed: integer(snapshot.seed),
    level: integer(snapshot.player.level),
    health: Number(n(snapshot.player.health).toFixed(2)),
    stamina: Number(n(snapshot.player.stamina).toFixed(2)),
    inventoryItems: snapshot.player.inventory.length,
    questCount: snapshot.quests.length,
    visitedSettlements: snapshot.world.visitedSettlementIds.length,
    recentEvents: snapshot.recentEvents.length,
  });
}

export const GAMEPLAY_SNAPSHOT_SCHEMA = SCHEMA;
export const GAMEPLAY_SNAPSHOT_VERSION = VERSION;
export const GAMEPLAY_SNAPSHOT_LIMITS = Object.freeze({ MAX_RECENT_EVENTS, MAX_INVENTORY_ITEMS, MAX_QUESTS, MAX_EQUIPMENT, MAX_WORLD_FLAGS, MAX_STRING });
