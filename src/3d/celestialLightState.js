/**
 * Shared read-only celestial key-light state for custom shaders.
 *
 * Built-in Three.js materials already receive the live DirectionalLight objects automatically, but
 * custom shaders (notably `world/water.js`) do not. Publishing the winning sun/moon key here keeps
 * those shaders synchronized with `lighting.js` without duplicating the day/night orbit maths.
 * @module celestialLightState
 */

const DEFAULT_DIRECTION = Object.freeze({ x: 0.557086, y: 0.742781, z: 0.371391 });
const DEFAULT_COLOR = Object.freeze({ r: 1, g: 0.887923, b: 0.637597 });
const PHOTOMETRIC_TIE_RATIO = 0.14;

let state = Object.freeze({
	source: 'sun',
	direction: DEFAULT_DIRECTION,
	color: DEFAULT_COLOR,
	intensity: 1,
	nightFactor: 0,
});

function normalizedDirection(position) {
	const x = Number(position?.x) || 0;
	const y = Number(position?.y) || 0;
	const z = Number(position?.z) || 0;
	const length = Math.hypot(x, y, z) || 1;
	return Object.freeze({ x: x / length, y: y / length, z: z / length });
}

function frozenColor(color) {
	return Object.freeze({
		r: Number.isFinite(color?.r) ? Math.max(0, color.r) : 1,
		g: Number.isFinite(color?.g) ? Math.max(0, color.g) : 1,
		b: Number.isFinite(color?.b) ? Math.max(0, color.b) : 1,
	});
}

function photometricKeyScore(intensity, color) {
	const luminance = 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;
	return intensity * Math.max(0.02, luminance);
}

function smoothstep01(value) {
	const t = Math.max(0, Math.min(1, value));
	return t * t * (3 - 2 * t);
}

function blendedDirection(a, b, amount) {
	const t = Math.max(0, Math.min(1, amount));
	return normalizedDirection({
		x: a.x + (b.x - a.x) * t,
		y: a.y + (b.y - a.y) * t,
		z: a.z + (b.z - a.z) * t,
	});
}

function blendedColor(a, b, amount) {
	const t = Math.max(0, Math.min(1, amount));
	return Object.freeze({
		r: a.r + (b.r - a.r) * t,
		g: a.g + (b.g - a.g) * t,
		b: a.b + (b.b - a.b) * t,
	});
}

/**
 * Publishes whichever visible celestial body currently provides the stronger direct key.
 * Direction is surface-to-light, matching the convention used by `world/water.js`'s half-vector.
 *
 * Outside the short crossover window the built-in directional-light intensity remains authoritative.
 * Near an actual sun/moon tie, luminance breaks the winner tie while direction and colour blend
 * continuously across the same narrow photometric window. This avoids an artificial reflection
 * snap at dawn/dusk without inventing a second lighting authority or changing the day/night clock.
 * Intensity always stays equal to the strongest built-in directional light, preserving parity.
 */
export function publishCelestialLightState({
	sunPosition,
	sunColor,
	sunIntensity = 0,
	moonPosition,
	moonColor,
	moonIntensity = 0,
	nightFactor = 0,
}) {
	const safeSunIntensity = Math.max(0, Number(sunIntensity) || 0);
	const safeMoonIntensity = Math.max(0, Number(moonIntensity) || 0);
	const safeSunColor = frozenColor(sunColor);
	const safeMoonColor = frozenColor(moonColor);
	const sunDirection = normalizedDirection(sunPosition);
	const moonDirection = normalizedDirection(moonPosition);
	const strongestIntensity = Math.max(safeSunIntensity, safeMoonIntensity);
	const intensityDelta = Math.abs(safeSunIntensity - safeMoonIntensity);
	const nearTie = strongestIntensity > 0 && intensityDelta / strongestIntensity <= PHOTOMETRIC_TIE_RATIO;
	const sunPhotometricScore = photometricKeyScore(safeSunIntensity, safeSunColor);
	const moonPhotometricScore = photometricKeyScore(safeMoonIntensity, safeMoonColor);
	const rawMoonWins = safeMoonIntensity > safeSunIntensity;
	const photometricMoonWins = moonPhotometricScore > sunPhotometricScore;
	const moonWins = nearTie ? photometricMoonWins : rawMoonWins;
	const scoreTotal = sunPhotometricScore + moonPhotometricScore;
	const moonPhotometricShare = scoreTotal > 0 ? moonPhotometricScore / scoreTotal : (moonWins ? 1 : 0);
	const tieProximity = nearTie
		? 1 - Math.min(1, intensityDelta / Math.max(strongestIntensity * PHOTOMETRIC_TIE_RATIO, 1e-9))
		: 0;
	const blendAmount = nearTie
		? (moonWins
			? 1 - (1 - moonPhotometricShare) * smoothstep01(tieProximity)
			: moonPhotometricShare * smoothstep01(tieProximity))
		: (moonWins ? 1 : 0);
	state = Object.freeze({
		source: moonWins ? 'moon' : 'sun',
		direction: blendedDirection(sunDirection, moonDirection, blendAmount),
		color: blendedColor(safeSunColor, safeMoonColor, blendAmount),
		intensity: strongestIntensity,
		nightFactor: Math.max(0, Math.min(1, Number(nightFactor) || 0)),
	});
	return state;
}

export function getCelestialLightState() {
	return state;
}
