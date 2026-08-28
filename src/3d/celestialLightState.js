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

/**
 * Publishes whichever visible celestial body currently provides the stronger direct key.
 * Direction is surface-to-light, matching the convention used by `world/water.js`'s half-vector.
 *
 * Outside the short crossover window the built-in directional-light intensity remains authoritative.
 * Near an actual sun/moon tie, luminance breaks the directional/color tie so custom water glints do
 * not snap prematurely to a dimmer-looking chromatic key. Intensity always stays equal to the
 * strongest built-in directional light, preserving lighting parity.
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
	const strongestIntensity = Math.max(safeSunIntensity, safeMoonIntensity);
	const intensityDelta = Math.abs(safeSunIntensity - safeMoonIntensity);
	const nearTie = strongestIntensity > 0 && intensityDelta / strongestIntensity <= PHOTOMETRIC_TIE_RATIO;
	const rawMoonWins = safeMoonIntensity > safeSunIntensity;
	const photometricMoonWins = photometricKeyScore(safeMoonIntensity, safeMoonColor)
		> photometricKeyScore(safeSunIntensity, safeSunColor);
	const moonWins = nearTie ? photometricMoonWins : rawMoonWins;
	state = Object.freeze({
		source: moonWins ? 'moon' : 'sun',
		direction: normalizedDirection(moonWins ? moonPosition : sunPosition),
		color: moonWins ? safeMoonColor : safeSunColor,
		intensity: strongestIntensity,
		nightFactor: Math.max(0, Math.min(1, Number(nightFactor) || 0)),
	});
	return state;
}

export function getCelestialLightState() {
	return state;
}
