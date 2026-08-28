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
	// Custom water/glint shaders need the visually dominant celestial key, not merely the numerically
	// larger Three.js intensity. Luminance weighting prevents a dim blue moon from taking over while
	// the warmer twilight sun still contributes the stronger perceived direct reflection.
	const luminance = 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;
	return intensity * Math.max(0.02, luminance);
}

/**
 * Publishes whichever visible celestial body currently provides the stronger direct key.
 * Direction is surface-to-light, matching the convention used by `world/water.js`'s half-vector.
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
	const sunScore = photometricKeyScore(safeSunIntensity, safeSunColor);
	const moonScore = photometricKeyScore(safeMoonIntensity, safeMoonColor);
	const moonWins = moonScore > sunScore;
	state = Object.freeze({
		source: moonWins ? 'moon' : 'sun',
		direction: normalizedDirection(moonWins ? moonPosition : sunPosition),
		color: moonWins ? safeMoonColor : safeSunColor,
		intensity: moonWins ? safeMoonIntensity : safeSunIntensity,
		nightFactor: Math.max(0, Math.min(1, Number(nightFactor) || 0)),
	});
	return state;
}

export function getCelestialLightState() {
	return state;
}
