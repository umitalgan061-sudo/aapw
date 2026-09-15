/**
 * Deterministic, read-only availability timeline for the existing settlement services.
 *
 * The caller supplies its authoritative clock, service rows and gating observations. This module
 * only produces a bounded presentation projection for HUD, dialogue and travel UX consumers.
 */

const SERVICES = Object.freeze([
  'gate', 'market', 'tavern', 'blacksmith', 'farm', 'barracks', 'stable', 'house',
]);
const MAX_ROWS = 24;
const MAX_HORIZON = 24;

function text(value, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized ? normalized.slice(0, 96) : fallback;
}
function finite(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}
function bool(value, fallback = false) {
  return typeof value === 'boolean' ? value : fallback;
}
function clamp(value, min, max) { return Math.min(max, Math.max(min, finite(value, min))); }
function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freeze(child);
  return Object.freeze(value);
}
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (!value || typeof value !== 'object') return JSON.stringify(value);
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
}
function digest(value) {
  let hash = 2166136261;
  for (const char of stable(value)) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function normalizeWindow(source = {}) {
  const start = clamp(source.startHour, 0, 23);
  const end = clamp(source.endHour, 0, 23);
  return { startHour: start, endHour: end, overnight: end < start };
}
function inWindow(hour, window) {
  if (window.startHour === window.endHour) return true;
  return window.overnight ? hour >= window.startHour || hour < window.endHour : hour >= window.startHour && hour < window.endHour;
}
function serviceRow(raw, index, hour, context) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const service = SERVICES.includes(source.service) ? source.service : SERVICES[index % SERVICES.length];
  const window = normalizeWindow(source);
  const scheduled = inWindow(hour, window);
  const enabled = bool(source.enabled, true);
  const inside = bool(context.insideSettlement, true);
  const defeated = bool(context.defeated, false);
  const fatigue = clamp(context.fatigue, 0, 100);
  const requiredFatigue = clamp(source.maxFatigue, 0, 100);
  const gate = inside && !defeated && enabled && scheduled && fatigue <= requiredFatigue;
  const reason = !inside ? 'outside-settlement' : defeated ? 'defeated' : !enabled ? 'service-disabled' : !scheduled ? 'closed-hours' : fatigue > requiredFatigue ? 'too-fatigued' : '';
  return { service, label: text(source.label, service), available: gate, reason, startHour: window.startHour, endHour: window.endHour, scheduled, priority: clamp(source.priority, 0, 999), index };
}

export function buildSettlementServiceAvailabilityTimeline(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const context = source.context && typeof source.context === 'object' ? source.context : {};
  const hour = clamp(source.currentHour, 0, 23);
  const horizon = Math.round(clamp(source.horizonHours, 0, MAX_HORIZON));
  const rawRows = Array.isArray(source.services) ? source.services.slice(0, MAX_ROWS) : [];
  const rows = rawRows.map((row, index) => serviceRow(row, index, hour, context));
  rows.sort((a, b) => Number(b.available) - Number(a.available) || a.priority - b.priority || a.service.localeCompare(b.service) || a.index - b.index);
  const snapshots = Array.from({ length: horizon + 1 }, (_, offset) => {
    const targetHour = (hour + offset) % 24;
    return Object.freeze({ hour: targetHour, openServices: rows.filter((row) => inWindow(targetHour, { startHour: row.startHour, endHour: row.endHour })).map((row) => row.service).sort() });
  });
  const available = rows.filter((row) => row.available).length;
  const result = { version: 1, currentHour: hour, horizonHours: horizon, available, blocked: rows.length - available, primaryService: rows.find((row) => row.available)?.service || '', rows: rows.map(({ index, ...row }) => row), snapshots, context: { insideSettlement: bool(context.insideSettlement, true), defeated: bool(context.defeated, false), fatigue: clamp(context.fatigue, 0, 100) } };
  result.fingerprint = digest(result);
  result.stable = stable(result);
  return freeze(result);
}

export function validateSettlementServiceAvailabilityTimeline(value) {
  const ok = Boolean(value && value.version === 1 && Array.isArray(value.rows) && value.rows.length <= MAX_ROWS && Array.isArray(value.snapshots));
  return { ok, reason: ok ? '' : 'invalid-timeline' };
}
