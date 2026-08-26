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
/** Saturated bright daylight implies a cleaner optical column than a pale overcast-looking horizon. */
const FOG_CLEAR_BLUE_DAY_CLARITY_GAIN = 0.000026;
/** Bright moonlit horizons recover a little long-range separation instead of looking like overcast night. */
const FOG_MOONLIT_CLARITY_GAIN = 0.000030;
/** Twilight is deliberately narrower than a simple parabola so haze belongs near low-angle light. */
const FOG_TWILIGHT_CURVE_POWER = 2.35;
/** Slightly neutral atmospheric tint mixed into the sky-derived horizon only when haze is strongest. */
const FOG_HAZE_TINT = new THREE.Color(0x9aa6ad);
/** A warmer aerosol tint near low-angle sun keeps dawn/dusk from becoming a neutral grey wash. */
const FOG_TWILIGHT_WARM_TINT = new THREE.Color(0xb5a79c);
/** Moonless/dark horizons cool distant silhouettes slightly instead of preserving warm twilight dust. */
const FOG_NIGHT_COOL_TINT = new THREE.Color(0x596979);
/** Blue-hour aerosol tint: after direct warmth collapses, distant terrain keeps a cool humid veil. */
const FOG_BLUE_HOUR_TINT = new THREE.Color(0x71899b);
/** Moonlit aerosol tint keeps nocturnal distance cues cool-neutral rather than crushing them into blue-grey. */
const FOG_MOONLIT_TINT = new THREE.Color(0x748493);
/** Clean high-sun air retains sky colour but biases the residual aerosol toward a restrained Rayleigh blue. */
const FOG_CLEAR_DAY_TINT = new THREE.Color(0x829bb0);
const FOG_HAZE_TINT_MAX = 0.075;
const FOG_TWILIGHT_WARM_TINT_MAX = 0.032;
const FOG_NIGHT_COOL_TINT_MAX = 0.038;
const FOG_BLUE_HOUR_TINT_MAX = 0.045;
const FOG_MOONLIT_TINT_MAX = 0.028;
const FOG_CLEAR_DAY_TINT_MAX = 0.026;
/** A small post-sunset humidity lift separates blue hour from both warm dusk and fully dark night. */
const FOG_BLUE_HOUR_DENSITY_GAIN = 0.000032;

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
 * equally hazy. Horizon luminance further gates the warm aerosol response: bright low-angle sky can
 * illuminate haze, while a dark post-twilight horizon transitions through a short blue-hour humidity
 * shoulder before reaching restrained cool night aerial perspective. The blue-hour shoulder is
 * derived only from the authoritative horizon luminance/night factor, so it introduces no separate
 * clock or geography. Bright moonlit horizons then recover a bounded amount of clarity and a slightly
 * more neutral cool aerosol tint, preventing clear nights from reading like uniformly overcast fog.
 * High-sun daylight also reads the authoritative horizon chroma: a bright saturated sky receives a
 * small extra clarity/tint response while a pale low-chroma horizon keeps the normal aerosol column.
 * This avoids making every daytime view the same global haze preset without inventing weather state.
 * All effects remain render-only and subordinate to the authoritative lighting horizon color.
 *
 * @param {THREE.FogExp2} fog
 * @param {{horizonColor: THREE.Color, nightFactor: number}} dayNight - `lighting.js`'s per-frame output.
 */
export function updateFog(fog, dayNight) {
	const nightFactor = THREE.MathUtils.clamp(dayNight.nightFactor, 0, 1);
	const twilight = Math.pow(Math.sin(Math.PI * nightFactor), FOG_TWILIGHT_CURVE_POWER);
	const fullDay = 1 - THREE.MathUtils.smoothstep(nightFactor, 0.08, 0.42);
	const horizonLuminance = THREE.MathUtils.clamp(
		dayNight.horizonColor.r * 0.2126 + dayNight.horizonColor.g * 0.7152 + dayNight.horizonColor.b * 0.0722,
		0,
		1,
	);
	const horizonMax = Math.max(dayNight.horizonColor.r, dayNight.horizonColor.g, dayNight.horizonColor.b);
	const horizonMin = Math.min(dayNight.horizonColor.r, dayNight.horizonColor.g, dayNight.horizonColor.b);
	const horizonChroma = THREE.MathUtils.clamp(horizonMax - horizonMin, 0, 1);
	const clearBlueDay = fullDay
		* THREE.MathUtils.smoothstep(horizonLuminance, 0.34, 0.72)
		* THREE.MathUtils.smoothstep(horizonChroma, 0.16, 0.44);
	const litTwilight = twilight * THREE.MathUtils.smoothstep(horizonLuminance, 0.08, 0.46);
	const darkeningTwilight = twilight * (1 - THREE.MathUtils.smoothstep(horizonLuminance, 0.10, 0.34));
	const blueHour = darkeningTwilight
		* THREE.MathUtils.smoothstep(nightFactor, 0.42, 0.68)
		* (1 - THREE.MathUtils.smoothstep(nightFactor, 0.72, 0.94));
	const deepNight = THREE.MathUtils.smoothstep(nightFactor, 0.70, 0.98)
		* (1 - THREE.MathUtils.smoothstep(horizonLuminance, 0.08, 0.24));
	const moonlitNight = THREE.MathUtils.smoothstep(nightFactor, 0.76, 0.98)
		* THREE.MathUtils.smoothstep(horizonLuminance, 0.16, 0.34);

	fog.color.copy(dayNight.horizonColor)
		.lerp(FOG_HAZE_TINT, twilight * FOG_HAZE_TINT_MAX)
		.lerp(FOG_TWILIGHT_WARM_TINT, litTwilight * FOG_TWILIGHT_WARM_TINT_MAX)
		.lerp(FOG_CLEAR_DAY_TINT, clearBlueDay * FOG_CLEAR_DAY_TINT_MAX)
		.lerp(FOG_BLUE_HOUR_TINT, blueHour * FOG_BLUE_HOUR_TINT_MAX)
		.lerp(FOG_NIGHT_COOL_TINT, deepNight * FOG_NIGHT_COOL_TINT_MAX)
		.lerp(FOG_MOONLIT_TINT, moonlitNight * FOG_MOONLIT_TINT_MAX);

	fog.density = THREE.MathUtils.lerp(FOG_DENSITY_DAY, FOG_DENSITY_NIGHT, nightFactor)
		+ twilight * FOG_TWILIGHT_DENSITY_GAIN
		+ blueHour * FOG_BLUE_HOUR_DENSITY_GAIN
		- fullDay * FOG_MIDDAY_CLARITY_GAIN
		- clearBlueDay * FOG_CLEAR_BLUE_DAY_CLARITY_GAIN
		- moonlitNight * FOG_MOONLIT_CLARITY_GAIN;
}