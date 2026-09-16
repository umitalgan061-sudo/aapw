/**
 * Distance-aware visibility budget.
 *
 * Centralizes a conservative visibility envelope for world systems that already perform culling or
 * streaming. It does not traverse a scene graph. Callers provide counts and current quality; the module
 * returns target bands for near/mid/far content so different systems can converge on the same budget.
 */

const QUALITY = Object.freeze({ minimal: 0, balanced: 1, high: 2, ultra: 3 });
const freeze = (value) => {
	if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
	Object.freeze(value);
	for (const child of Object.values(value)) freeze(child);
	return value;
};
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function index(tier) { return QUALITY[tier] ?? QUALITY.balanced; }
function finite(value, fallback) { return Number.isFinite(value) ? value : fallback; }

export function buildVisibilityBudget({ tier = 'balanced', coarsePointer = false, reducedMotion = false, drawDistance = 600, maxObjects = 2000 } = {}) {
	const q = index(tier);
	const distance = clamp(finite(drawDistance, 600), 100, 2000);
	const objectLimit = clamp(Math.round(finite(maxObjects, 2000)), 100, 5000);
	const near = [80, 120, 180, 260][q];
	const mid = [240, 380, 560, 760][q];
	const ratio = coarsePointer ? 0.65 : reducedMotion ? 0.75 : 1;
	const budget = {
		nearDistance: Math.min(near, distance),
		midDistance: Math.min(mid, distance),
		farDistance: distance,
		nearObjects: Math.min(objectLimit, Math.round([160, 320, 560, 900][q] * ratio)),
		midObjects: Math.min(objectLimit, Math.round([260, 520, 900, 1400][q] * ratio)),
		farObjects: Math.min(objectLimit, Math.round([320, 760, 1300, 2200][q] * ratio)),
		updateCadenceHz: [10, 15, 24, 30][q] * (reducedMotion ? 0.75 : 1),
	};
	if (coarsePointer) budget.farObjects = Math.min(budget.farObjects, 900);
	return freeze({ version: 1, tier, budget, rules: { nearHighestDetail: true, farCanUseImpostor: q >= 1, mobileFarCap: coarsePointer, reducedMotionCap: reducedMotion } });
}

export function classifyDistance(distance, budget) {
	const value = Math.max(0, finite(distance, 0));
	if (value <= (budget?.nearDistance ?? 0)) return 'near';
	if (value <= (budget?.midDistance ?? 0)) return 'mid';
	if (value <= (budget?.farDistance ?? 0)) return 'far';
	return 'culled';
}

export function visibilityTargetCount(distanceBand, budget) {
	if (distanceBand === 'near') return budget?.nearObjects ?? 0;
	if (distanceBand === 'mid') return budget?.midObjects ?? 0;
	if (distanceBand === 'far') return budget?.farObjects ?? 0;
	return 0;
}

export function runtimeVisibilityConstants() { return freeze({ quality: QUALITY }); }
