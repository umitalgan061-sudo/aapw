/** Deterministic cross-device input intent normalization for the existing player caller. */
const clamp01 = (v, fallback = 0) => Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : fallback;
const finite = (v, fallback = 0) => Number.isFinite(v) ? v : fallback;
const ACTIONS = Object.freeze(['light','heavy','dodge','parry','block','lockOn','aim','interact']);
const alias = Object.freeze({
  light: 'light', heavy: 'heavy', dodge: 'dodge', roll: 'dodge', parry: 'parry', guard: 'block', block: 'block',
  lockon: 'lockOn', 'lock-on': 'lockOn', aim: 'aim', interact: 'interact'
});
function normalizeAction(value) { const key = String(value ?? '').trim().toLowerCase(); return alias[key] ?? null; }
function sourcePriority(source) { return ({ keyboard: 4, mouse: 4, gamepad: 3, touch: 2, pwa: 2 })[String(source ?? '').toLowerCase()] ?? 1; }
function normalizeVector(x, y) { const nx = finite(x), ny = finite(y); const len = Math.hypot(nx, ny); return len > 1 ? { x: nx / len, y: ny / len } : { x: nx, y: ny }; }
function deepFreeze(value) { if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value; Object.freeze(value); for (const child of Object.values(value)) deepFreeze(child); return value; }
export function resolvePlayerInputIntentParity(input = {}) {
  const raw = Array.isArray(input.actions) ? input.actions : [];
  const seen = new Map();
  for (const item of raw) {
    const action = normalizeAction(item?.action ?? item?.intent ?? item);
    if (!action || !ACTIONS.includes(action)) continue;
    const candidate = { action, source: String(item?.source ?? 'unknown').toLowerCase(), pressed: Boolean(item?.pressed ?? true), value: clamp01(item?.value, 1), sequence: Math.max(0, Math.floor(finite(item?.sequence, 0))) };
    const prior = seen.get(action);
    if (!prior || candidate.sequence > prior.sequence || (candidate.sequence === prior.sequence && sourcePriority(candidate.source) > sourcePriority(prior.source))) seen.set(action, candidate);
  }
  const actions = [...seen.values()].filter((item) => item.pressed).sort((a, b) => a.sequence - b.sequence || sourcePriority(b.source) - sourcePriority(a.source) || a.action.localeCompare(b.action));
  const move = normalizeVector(input.moveX, input.moveY);
  const look = normalizeVector(input.lookX, input.lookY);
  const primary = actions[0]?.action ?? null;
  const result = { move, look, actions, primaryAction: primary, deviceCount: new Set(actions.map((item) => item.source)).size, parity: { keyboard: false, mouse: false, gamepad: false, touch: false, pwa: false } };
  for (const item of actions) if (item.source in result.parity) result.parity[item.source] = true;
  return deepFreeze(result);
}
export const PLAYER_INPUT_INTENT_ACTIONS = ACTIONS;
export const serializePlayerInputIntentParity = (value) => JSON.stringify(value);
