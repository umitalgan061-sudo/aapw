/**
 * Distance fog, tied to the day/night cycle (`lighting.js`) rather than a fixed look: color always
 * matches the current sky horizon color (so fogged-out terrain blends into the sky instead of
 * fading to a mismatched flat color), and density rises toward night (reduced-visibility haze) —
 * see DECISIONS.md ADR-0007 for why this reuses `lighting.js`'s output instead of a second,
 * independently-tuned keyframe table.
 *
 * Applies automatically to any built-in Three.js material (`MeshStandardMaterial`, etc. — e.g.
 * `world/terrain.js`'s ground) via `scene.fog`, three.js's own mechanism. Custom `ShaderMaterial`s
 * (`sky.js`, `world/water.js`) do **not** fog unless they explicitly include the `fog_*` GLSL
 * chunks — `sky.js` deliberately opts out (`fog: false`, it's a backdrop, must never fog into
 * itself); `world/water.js` participates explicitly through those chunks.
 * @module fog
 */

import * as THREE from 'three';

/** Exponential-squared falloff (`THREE.FogExp2`) reads more natural than linear fog at this world's
 * scale. Tuned so nearby terrain stays readable while kilometre-scale views retain atmospheric
 * perspective instead of ending in a hard, uniformly clear horizon. */
const FOG_DENSITY_DAY = 0.00036;
/** Night keeps a modestly denser veil without turning exploration into a visibility wall. */
const FOG_DENSITY_NIGHT = 0.00054;
/** Dawn/dusk humidity/scattering peak. This is visual-only and does not alter weather/gameplay. */
const FOG_TWILIGHT_DENSITY_GAIN = 0.000085;
/** Midday dry-air clarity keeps long views from reading like the same opacity slider at every phase. */
const FOG_MIDDAY_CLARITY_GAIN = 0.000022;
/** Twilight is deliberately narrower than a simple parabola so haze belongs near low-angle light. */
const FOG_TWILIGHT_CURVE_POWER = 2.35;
/** Slightly neutral atmospheric tint mixed into the sky-derived horizon only when haze is strongest. */
const FOG_HAZE_TINT = new THREE.Color(0x9aa6ad);
/** A warmer aerosol tint near low-angle sun keeps dawn/dusk from becoming a neutral grey wash. */
const FOG_TWILIGHT_WARM_TINT = new THREE.Color(0xb5a79c);
const FOG_HAZE_TINT_MAX = 0.075;
const FOG_TWILIGHT_WARM_TINT_MAX = 0.032;

/**
 * Creates the scene fog. Caller assigns it to `scene.fog` and calls `updateFog` every frame
 * afterward — the color/density below are placeholders, immediately overwritten on first update.
 * @returns {THREE.FogExp2}
 */
export function createFog() {
	return new THREE.FogExp2(0x000000, FOG_DENSITY_DAY);
}

/**
 * Syncs fog color/density to the current day/night state. Call once per frame, after
 * `lighting.js`'s `updateDayNightLighting`.
 *
 * A bounded twilight lobe avoids the old perfectly linear day→night density ramp. The lobe uses a
 * powered sine rather than `4*x*(1-x)`: it rises later and falls sooner, concentrating suspended
 * aerosol visibility around genuinely low-angle light instead of making half the diurnal cycle
 * equally hazy. A small midday clarity notch restores long-distance separation under high sun.
 * Both effects are render-only and remain subordinate to the authoritative lighting horizon color.
 *
 * @param {THREE.FogExp2} fog
 * @param {{horizonColor: THREE.Color, nightFactor: number}} dayNight - `lighting.js`'s per-frame output.
 */
export function updateFog(fog, dayNight) {
	const nightFactor = THREE.MathUtils.clamp(dayNight.nightFactor, 0, 1);
	const twilight = Math.pow(Math.sin(Math.PI * nightFactor), FOG_TWILIGHT_CURVE_POWER);
	const fullDay = 1 - THREE.MathUtils.smoothstep(nightFactor, 0.08, 0.42);

	fog.color.copy(dayNight.horizonColor)
		.lerp(FOG_HAZE_TINT, twilight * FOG_HAZE_TINT_MAX)
		.lerp(FOG_TWILIGHT_WARM_TINT, twilight * FOG_TWILIGHT_WARM_TINT_MAX);

	fog.density = THREE.MathUtils.lerp(FOG_DENSITY_DAY, FOG_DENSITY_NIGHT, nightFactor)
		+ twilight * FOG_TWILIGHT_DENSITY_GAIN
		- fullDay * FOG_MIDDAY_CLARITY_GAIN;
}
