/**
 * Distance/surface resonance policy.
 *
 * Nearby walls, caves and enclosed spaces can make the same source feel very different. This policy
 * consumes explicit enclosure and material observations and returns bounded resonance/low-frequency
 * adjustments. It does not perform collision or geometry queries itself.
 */

const SURFACES = Object.freeze({ OPEN: 'open', STONE: 'stone', WOOD: 'wood', EARTH: 'earth', METAL: 'metal', ICE: 'ice', WATER: 'water', FOLIAGE: 'foliage' });
const freeze = (value) => { if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value; Object.freeze(value); for (const child of Object.values(value)) freeze(child); return value; };
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const finiteOr = (value, fallback) => Number.isFinite(value) ? value : fallback;
const surfaceFactor = Object.freeze({ open: 0, stone: 1, wood: 0.65, earth: 0.8, metal: 1.15, ice: 0.75, water: 0.55, foliage: 0.25 });

export function createResonancePolicy({ surface = 'open', enclosure = 0, distance = 10, roomSize = 100, lowFrequencyBias = 0 } = {}) {
	const material = SURFACES[surface] ? surface : 'open';
	const enclosed = clamp(finiteOr(enclosure, 0), 0, 1);
	const distanceFactor = clamp(1 - Math.max(0, finiteOr(distance, 10)) / Math.max(10, finiteOr(roomSize, 100)), 0, 1);
	const surfaceWeight = surfaceFactor[material] ?? 0;
	const resonance = clamp(enclosed * 0.55 + distanceFactor * 0.2 + surfaceWeight * 0.25, 0, 1);
	const low = clamp(finiteOr(lowFrequencyBias, 0) + resonance * 0.2, -0.2, 0.5);
	return freeze({ version: 1, surface: material, enclosure: Number(enclosed.toFixed(4)), distanceMeters: Math.max(0, finiteOr(distance, 10)), roomSizeMeters: Math.max(10, finiteOr(roomSize, 100)), resonance: Number(resonance.toFixed(5)), lowFrequencyBias: Number(low.toFixed(5)), highFrequencyDamping: Number((resonance * 0.4).toFixed(5)), rules: { preferLongerDecay: resonance > 0.55, emphasizeLowMids: resonance > 0.45, dampHarshTransients: resonance > 0.7 } });
}

export function blendResonance(previous, next, deltaSeconds = 0.016) {
	const t = clamp(Math.max(0, finiteOr(deltaSeconds, 0.016)) * 5, 0, 1);
	const blend = (key) => finiteOr(previous?.[key], 0) + (finiteOr(next?.[key], 0) - finiteOr(previous?.[key], 0)) * t;
	return freeze({ version: 1, resonance: blend('resonance'), lowFrequencyBias: blend('lowFrequencyBias'), highFrequencyDamping: blend('highFrequencyDamping'), enclosure: blend('enclosure') });
}

export function resonanceSurfaceConstants() { return freeze({ surfaces: SURFACES, factor: surfaceFactor }); }
