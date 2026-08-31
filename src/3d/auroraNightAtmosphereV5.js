/**
 * Final Run221 night-atmosphere calibration plus the full-world lower-hemisphere continuity fix.
 *
 * V4's irregular ray curtains passed visual review, but the lower night sky beneath the auroral
 * arc remained too close to black. The original V5 lift fixed the visible horizon. Full-world
 * orthographic proof later exposed a second shipped-runtime problem: finite world-anchored marine
 * planes can end inside the camera frustum, revealing the camera-relative sky's below-horizon
 * hemisphere behind them as a sharply different colour. That contrast makes the otherwise valid
 * finite low-cost water footprint read as a rectangular tile.
 *
 * This refinement keeps sky geometry, map geography, hydrology and water coverage untouched. It
 * only aligns the non-geographic below-horizon atmosphere floor with the deep marine blue family,
 * so a far-water footprint edge cannot turn into a dark rectangular backdrop seam. Day/twilight
 * still retain the authored horizon bounce because the replacement only changes the night floor.
 */

export const WORLD_SKY_MARINE_FLOOR_POLICY = Object.freeze({
	id: 'camera-relative-marine-lower-hemisphere-continuity-v1',
	renderOnly: true,
	cameraRelative: true,
	canonicalGeographyUnchanged: true,
	canonicalWaterCoverageUnchanged: true,
	finiteWaterFootprintSafe: true,
	blackBackgroundFallback: false,
	marineNightFloorRgb: Object.freeze([0.031, 0.105, 0.165]),
});

export function applyAuroraNightAtmosphereV5(material) {
	material.fragmentShader = material.fragmentShader
		.replace(
			'vec3 deepHorizon = vec3(0.018, 0.042, 0.086);',
			'vec3 deepHorizon = vec3(0.050, 0.092, 0.165);',
		)
		.replace(
			'vec3 deepZenith = vec3(0.0035, 0.009, 0.027);',
			'vec3 deepZenith = vec3(0.009, 0.020, 0.052);',
		)
		.replace(
			'vec3 nightBounce = vec3(0.018, 0.026, 0.052);',
			`vec3 nightBounce = vec3(${WORLD_SKY_MARINE_FLOOR_POLICY.marineNightFloorRgb.map((value) => value.toFixed(3)).join(', ')});`,
		)
		.replace(
			'finalColor += oxygenGreen * haze * 0.10;',
			'finalColor += oxygenGreen * haze * 0.11;',
		);
	material.needsUpdate = true;
	material.userData.auroraNightAtmosphereV5 = true;
	material.userData.worldSkyMarineFloorPolicy = WORLD_SKY_MARINE_FLOOR_POLICY;
	return material;
}
