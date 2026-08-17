/**
 * Camera-relative sky atmosphere calibration shared by the shipped world sky.
 * This module changes render response only; it has no map-space input and cannot author geography.
 */

const clamp01 = (value) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
const smoothstep = (edge0, edge1, value) => {
	const t = clamp01((value - edge0) / (edge1 - edge0));
	return t * t * (3 - 2 * t);
};
const lerp = (a, b, t) => a + (b - a) * t;

export const SKY_ATMOSPHERE_PROFILE_POLICY = Object.freeze({
	id: 'world-sky-day-night-atmosphere-profile-v1',
	input: 'lighting-day-night-factor',
	cameraRelative: true,
	mapSpaceNoise: false,
	renderOnly: true,
});

/**
 * Returns bounded atmosphere coefficients for the current lighting phase.
 * Twilight deliberately receives the strongest horizon haze: low-angle light reveals atmospheric
 * depth most clearly, while full night keeps enough lower-hemisphere bounce to avoid black voids.
 */
export function sampleSkyAtmosphereProfile(nightFactor) {
	const night = clamp01(nightFactor);
	const day = 1 - night;
	const twilight = 1 - Math.abs(day - 0.5) * 2;
	const twilightCurve = smoothstep(0.08, 0.92, twilight);
	const deepNight = smoothstep(0.62, 1, night);
	const fullDay = smoothstep(0.62, 1, day);

	return Object.freeze({
		horizonHazeStrength: clamp01(
			0.20
			+ twilightCurve * 0.18
			+ fullDay * 0.055
			- deepNight * 0.035,
		),
		groundBounceStrength: clamp01(
			lerp(0.085, 0.145, fullDay)
			+ twilightCurve * 0.018
			+ deepNight * 0.018,
		),
		upperAirStrength: clamp01(
			lerp(0.055, 0.105, fullDay)
			+ twilightCurve * 0.012
			- deepNight * 0.012,
		),
		bandingDitherStrength: 0.006,
	});
}
