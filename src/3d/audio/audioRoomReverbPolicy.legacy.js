/**
 * Environment-aware room/reverb policy.
 *
 * The game world contains caves, castles, settlements, open plains and exposed coastlines. This pure
 * policy turns an explicit room description into bounded early-reflection and wet/dry recommendations.
 * It does not instantiate a ConvolverNode and therefore remains usable in headless tests.
 */

const ROOM_TYPES = Object.freeze({ OPEN: 'open', SMALL_ROOM: 'small-room', LARGE_HALL: 'large-hall', CASTLE: 'castle', CAVE: 'cave', FOREST: 'forest', COAST: 'coast', RIVER: 'river', ICE: 'ice', UNKNOWN: 'unknown' });
const freeze = (value) => { if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value; Object.freeze(value); for (const child of Object.values(value)) freeze(child); return value; };
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const finiteOr = (value, fallback) => Number.isFinite(value) ? value : fallback;
const PROFILES = Object.freeze({
	open: { wet: 0.05, decay: 0.6, density: 0.1, preDelayMs: 18, lowDamp: 0.9 },
	'small-room': { wet: 0.22, decay: 0.85, density: 0.32, preDelayMs: 12, lowDamp: 0.8 },
	'large-hall': { wet: 0.3, decay: 1.8, density: 0.42, preDelayMs: 24, lowDamp: 0.65 },
	castle: { wet: 0.34, decay: 2.4, density: 0.5, preDelayMs: 28, lowDamp: 0.58 },
	cave: { wet: 0.5, decay: 3.2, density: 0.62, preDelayMs: 35, lowDamp: 0.45 },
	forest: { wet: 0.1, decay: 1.1, density: 0.18, preDelayMs: 20, lowDamp: 0.75 },
	coast: { wet: 0.06, decay: 0.7, density: 0.08, preDelayMs: 18, lowDamp: 0.92 },
	river: { wet: 0.08, decay: 0.8, density: 0.12, preDelayMs: 19, lowDamp: 0.88 },
	ice: { wet: 0.26, decay: 2.2, density: 0.32, preDelayMs: 30, lowDamp: 0.58 },
	unknown: { wet: 0.08, decay: 0.8, density: 0.12, preDelayMs: 18, lowDamp: 0.85 },
});
function roomType(value) { return ROOM_TYPES[value] ? value : 'unknown'; }

export function createRoomReverbPolicy({ room = 'open', sizeMeters = 20, absorption = 0.25, wetOverride, nightFactor = 0 } = {}) {
	const type = roomType(room);
	const profile = PROFILES[type];
	const size = clamp(finiteOr(sizeMeters, 20), 2, 500);
	const absorb = clamp(finiteOr(absorption, 0.25), 0, 1);
	const night = clamp(finiteOr(nightFactor, 0), 0, 1);
	const wet = clamp(finiteOr(wetOverride, profile.wet) * (1 - absorb * 0.6) + night * 0.015, 0, 0.8);
	const decay = clamp(profile.decay * (0.65 + Math.min(size / 80, 1) * 0.55) * (1 - absorb * 0.45), 0.25, 5);
	const density = clamp(profile.density * (0.75 + Math.min(size / 100, 1) * 0.35), 0, 1);
	return freeze({ version: 1, room: type, sizeMeters: Number(size.toFixed(2)), absorption: Number(absorb.toFixed(3)), wet: Number(wet.toFixed(5)), dry: Number((1 - wet * 0.35).toFixed(5)), decaySeconds: Number(decay.toFixed(4)), density: Number(density.toFixed(4)), preDelayMs: profile.preDelayMs, lowDamp: profile.lowDamp });
}

export function roomReverbTransition(previous, next, deltaSeconds = 0.016) {
	const t = clamp(finiteOr(deltaSeconds, 0.016) * 3.5, 0, 1);
	const blend = (key) => finiteOr(previous?.[key], 0) + (finiteOr(next?.[key], 0) - finiteOr(previous?.[key], 0)) * t;
	return freeze({ version: 1, wet: blend('wet'), dry: blend('dry'), decaySeconds: blend('decaySeconds'), density: blend('density'), preDelayMs: blend('preDelayMs'), lowDamp: blend('lowDamp') });
}

export function roomReverbConstants() { return freeze({ roomTypes: ROOM_TYPES, profiles: PROFILES }); }
