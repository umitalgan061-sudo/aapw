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
/** Startup must never expose a black fog horizon before the first lighting tick. */
const FOG_BOOT_HORIZON_COLOR = 0x596979;
/** Dynamic lighting is authoritative, but a transient near-black horizon must not black-hole distant terrain. */
const FOG_HORIZON_LUMINANCE_FLOOR = 0.035;
const FOG_HORIZON_FLOOR_COLOR = new THREE.Color(FOG_BOOT_HORIZON_COLOR);
/** Keep all phase-dependent clarity/aerosol terms inside a safe aerial-perspective envelope. */
const FOG_DENSITY_MIN = 0.00026;
const FOG_DENSITY_MAX = 0.00072;
/** Dawn/dusk humidity/scattering peak. This is visual-only and does not alter weather/gameplay. */
const FOG_TWILIGHT_DENSITY_GAIN = 0.000085;
/** Warm low-angle chroma gets a small extra aerosol column instead of sharing one twilight opacity. */
const FOG_WARM_AEROSOL_DENSITY_GAIN = 0.000020;
/** Ochre/golden horizons carry a slightly denser mineral aerosol veil than rosy/magenta sunsets. */
const FOG_DUST_AEROSOL_DENSITY_GAIN = 0.000014;
/** Saturated cool twilight implies a cleaner Rayleigh-dominant column than pale humid dusk. */
const FOG_CLEAR_TWILIGHT_CLARITY_GAIN = 0.000020;
/** Saturated post-sunset blue hour keeps extra long-range silhouette separation instead of humid haze. */
const FOG_CLEAR_BLUE_HOUR_CLARITY_GAIN = 0.000018;
/** Cool chromatic deep night keeps a little extra silhouette depth instead of one uniform nocturnal veil. */
const FOG_CLEAR_DEEP_NIGHT_CLARITY_GAIN = 0.000016;
/** Midday dry-air clarity keeps long views from reading like the same opacity slider at every phase. */
const FOG_MIDDAY_CLARITY_GAIN = 0.000022;
/** Saturated bright daylight implies a cleaner optical column than a pale overcast-looking horizon. */
const FOG_CLEAR_BLUE_DAY_CLARITY_GAIN = 0.000026;
/** Bright but low-chroma daylight carries a restrained humid aerosol veil rather than clear-sky contrast. */
const FOG_HUMID_DAY_DENSITY_GAIN = 0.000038;
/** Bright moonlit horizons recover a little long-range separation instead of looking like overcast night. */
const FOG_MOONLIT_CLARITY_GAIN = 0.000030;
/** Twilight is deliberately narrower than a simple parabola so haze belongs near low-angle light. */
const FOG_TWILIGHT_CURVE_POWER = 2.35;
/** Slightly neutral atmospheric tint mixed into the sky-derived horizon only when haze is strongest. */
const FOG_HAZE_TINT = new THREE.Color(0x9aa6ad);
/** A warmer aerosol tint near low-angle sun keeps dawn/dusk from becoming a neutral grey wash. */
const FOG_TWILIGHT_WARM_TINT = new THREE.Color(0xb5a79c);
/** Red-dominant low-angle horizons pick up a faint dust/aerosol warmth without inventing weather. */
const FOG_WARM_AEROSOL_TINT = new THREE.Color(0xc2a18f);
/** Golden/ochre low-angle light gets a mineral aerosol bias distinct from pink/magenta twilight. */
const FOG_DUST_AEROSOL_TINT = new THREE.Color(0xb99a78);
/** Rosy sunsets remain optically lighter and slightly cooler than dust-rich golden hour. */
const FOG_ROSY_AEROSOL_TINT = new THREE.Color(0xb49aa2);
/** Cool saturated twilight retains a restrained Rayleigh blue instead of collapsing into grey haze. */
const FOG_CLEAR_TWILIGHT_TINT = new THREE.Color(0x738fa7);
/** Moonless/dark horizons cool distant silhouettes slightly instead of preserving warm twilight dust. */
const FOG_NIGHT_COOL_TINT = new THREE.Color(0x596979);
/** Blue-hour aerosol tint: after direct warmth collapses, distant terrain keeps a cool humid veil. */
const FOG_BLUE_HOUR_TINT = new THREE.Color(0x71899b);
/** Clear blue hour keeps a slightly deeper Rayleigh bias than humid post-sunset haze. */
const FOG_CLEAR_BLUE_HOUR_TINT = new THREE.Color(0x657f99);
/** Clear chromatic deep night preserves a darker blue aerial perspective without adding weather state. */
const FOG_CLEAR_DEEP_NIGHT_TINT = new THREE.Color(0x53687d);
/** Moonlit aerosol tint keeps nocturnal distance cues cool-neutral rather than crushing them into blue-grey. */
const FOG_MOONLIT_TINT = new THREE.Color(0x748493);
/** Clean high-sun air retains sky colour but biases the residual aerosol toward a restrained Rayleigh blue. */
const FOG_CLEAR_DAY_TINT = new THREE.Color(0x829bb0);
/** Humid bright daylight is slightly neutralised to mimic moisture scattering without inventing weather state. */
const FOG_HUMID_DAY_TINT = new THREE.Color(0xa4aaab);
const FOG_HAZE_TINT_MAX = 0.075;
const FOG_TWILIGHT_WARM_TINT_MAX = 0.032;
const FOG_WARM_AEROSOL_TINT_MAX = 0.024;
const FOG_DUST_AEROSOL_TINT_MAX = 0.026;
const FOG_ROSY_AEROSOL_TINT_MAX = 0.018;
const FOG_CLEAR_TWILIGHT_TINT_MAX = 0.024;
const FOG_NIGHT_COOL_TINT_MAX = 0.038;
const FOG_BLUE_HOUR_TINT_MAX = 0.045;
const FOG_CLEAR_BLUE_HOUR_TINT_MAX = 0.028;
const FOG_CLEAR_DEEP_NIGHT_TINT_MAX = 0.020;
const FOG_MOONLIT_TINT_MAX = 0.028;
const FOG_CLEAR_DAY_TINT_MAX = 0.026;
const FOG_HUMID_DAY_TINT_MAX = 0.036;
/** A small post-sunset humidity lift separates blue hour from both warm dusk and fully dark night. */
const FOG_BLUE_HOUR_DENSITY_GAIN = 0.000032;

/**
 * Creates the scene fog. Caller assigns it to `scene.fog` and calls `updateFog` every frame
 * afterward. The startup colour intentionally matches a plausible cool horizon instead of black so
 * a first-frame capture can never expose a black atmospheric backdrop while lighting initializes.
 * @returns {THREE.FogExp2}
 */
export function createFog() {
	return new THREE.FogExp2(FOG_BOOT_HORIZON_COLOR, FOG_DENSITY_DAY);
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
 * shoulder before reaching restrained cool night aerial perspective. Red-over-blue horizon chroma
 * additionally drives a small warm aerosol lobe, so amber sunrise/sunset does not share exactly the
 * same tint and optical depth as a neutral low-angle sky. Within that warm lobe, green retention
 * separates ochre/golden mineral aerosol from red-blue-balanced rosy twilight: dusty golden hour is
 * slightly denser and earthier, while pink/magenta sunsets stay optically lighter. Cool, saturated
 * twilight now receives the complementary treatment: a bounded clarity recovery and Rayleigh-blue
 * tint preserve long-range silhouette separation instead of forcing every low-angle phase through
 * the same humid grey veil. Post-sunset blue hour follows the same optical distinction: low-chroma
 * horizons retain the humid aerosol shoulder, while saturated cool horizons recover bounded clarity
 * and a deeper Rayleigh tint. Deep night now keeps that distinction too: a dark but cool/chromatic
 * horizon receives a small bounded clarity recovery and deeper blue aerial perspective, while neutral
 * dark horizons retain the denser nocturnal veil. All branches are derived only from authoritative
 * horizon color and night factor, so they add no weather or geography authority. Bright moonlit
 * horizons then recover a bounded amount of clarity and a slightly more neutral cool aerosol tint,
 * preventing clear nights from reading like uniformly overcast fog. High-sun daylight also reads the
 * authoritative horizon chroma: a bright saturated sky receives a small extra clarity/tint response,
 * while a bright low-chroma horizon receives a restrained humid aerosol lift. The clear and humid
 * responses are deliberately complementary, so daytime distance does not collapse into a single
 * global haze preset. All effects remain render-only and subordinate to lighting.js.
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
	const horizonWarmth = THREE.MathUtils.clamp(dayNight.horizonColor.r - dayNight.horizonColor.b, 0, 1);
	const horizonGoldenBalance = THREE.MathUtils.clamp(dayNight.horizonColor.g - dayNight.horizonColor.b, 0, 1);
	const horizonRosyBalance = THREE.MathUtils.clamp(dayNight.horizonColor.b - dayNight.horizonColor.g * 0.72, 0, 1);
	const horizonCoolness = THREE.MathUtils.clamp(dayNight.horizonColor.b - dayNight.horizonColor.r * 0.82, 0, 1);
	const brightDay = fullDay * THREE.MathUtils.smoothstep(horizonLuminance, 0.30, 0.70);
	const clearBlueDay = brightDay * THREE.MathUtils.smoothstep(horizonChroma, 0.16, 0.44);
	const humidDay = brightDay
		* (1 - THREE.MathUtils.smoothstep(horizonChroma, 0.09, 0.26))
		* THREE.MathUtils.smoothstep(horizonLuminance, 0.40, 0.76);
	const litTwilight = twilight * THREE.MathUtils.smoothstep(horizonLuminance, 0.08, 0.46);
	const warmAerosol = litTwilight
		* THREE.MathUtils.smoothstep(horizonWarmth, 0.025, 0.24)
		* THREE.MathUtils.smoothstep(horizonChroma, 0.08, 0.34);
	const dustAerosol = warmAerosol
		* THREE.MathUtils.smoothstep(horizonGoldenBalance, 0.035, 0.22)
		* (1 - THREE.MathUtils.smoothstep(horizonRosyBalance, 0.05, 0.20));
	const rosyAerosol = warmAerosol
		* THREE.MathUtils.smoothstep(horizonRosyBalance, 0.025, 0.18)
		* (1 - THREE.MathUtils.smoothstep(horizonGoldenBalance, 0.16, 0.34));
	const clearTwilight = litTwilight
		* THREE.MathUtils.smoothstep(horizonChroma, 0.20, 0.46)
		* THREE.MathUtils.smoothstep(horizonCoolness, 0.018, 0.18)
		* (1 - THREE.MathUtils.smoothstep(horizonWarmth, 0.08, 0.24));
	const darkeningTwilight = twilight * (1 - THREE.MathUtils.smoothstep(horizonLuminance, 0.10, 0.34));
	const blueHour = darkeningTwilight
		* THREE.MathUtils.smoothstep(nightFactor, 0.42, 0.68)
		* (1 - THREE.MathUtils.smoothstep(nightFactor, 0.72, 0.94));
	const clearBlueHour = blueHour
		* THREE.MathUtils.smoothstep(horizonChroma, 0.16, 0.38)
		* THREE.MathUtils.smoothstep(horizonCoolness, 0.012, 0.14);
	const humidBlueHour = blueHour * (1 - THREE.MathUtils.smoothstep(horizonChroma, 0.10, 0.30));
	const deepNight = THREE.MathUtils.smoothstep(nightFactor, 0.70, 0.98)
		* (1 - THREE.MathUtils.smoothstep(horizonLuminance, 0.08, 0.24));
	const clearDeepNight = deepNight
		* THREE.MathUtils.smoothstep(horizonChroma, 0.045, 0.16)
		* THREE.MathUtils.smoothstep(horizonCoolness, 0.006, 0.075);
	const moonlitNight = THREE.MathUtils.smoothstep(nightFactor, 0.76, 0.98)
		* THREE.MathUtils.smoothstep(horizonLuminance, 0.16, 0.34);

	fog.color.copy(dayNight.horizonColor)
		.lerp(FOG_HAZE_TINT, twilight * FOG_HAZE_TINT_MAX)
		.lerp(FOG_TWILIGHT_WARM_TINT, litTwilight * FOG_TWILIGHT_WARM_TINT_MAX)
		.lerp(FOG_WARM_AEROSOL_TINT, warmAerosol * FOG_WARM_AEROSOL_TINT_MAX)
		.lerp(FOG_DUST_AEROSOL_TINT, dustAerosol * FOG_DUST_AEROSOL_TINT_MAX)
		.lerp(FOG_ROSY_AEROSOL_TINT, rosyAerosol * FOG_ROSY_AEROSOL_TINT_MAX)
		.lerp(FOG_CLEAR_TWILIGHT_TINT, clearTwilight * FOG_CLEAR_TWILIGHT_TINT_MAX)
		.lerp(FOG_CLEAR_DAY_TINT, clearBlueDay * FOG_CLEAR_DAY_TINT_MAX)
		.lerp(FOG_HUMID_DAY_TINT, humidDay * FOG_HUMID_DAY_TINT_MAX)
		.lerp(FOG_BLUE_HOUR_TINT, humidBlueHour * FOG_BLUE_HOUR_TINT_MAX)
		.lerp(FOG_CLEAR_BLUE_HOUR_TINT, clearBlueHour * FOG_CLEAR_BLUE_HOUR_TINT_MAX)
		.lerp(FOG_NIGHT_COOL_TINT, deepNight * FOG_NIGHT_COOL_TINT_MAX)
		.lerp(FOG_CLEAR_DEEP_NIGHT_TINT, clearDeepNight * FOG_CLEAR_DEEP_NIGHT_TINT_MAX)
		.lerp(FOG_MOONLIT_TINT, moonlitNight * FOG_MOONLIT_TINT_MAX);

	const fogLuminance = fog.color.r * 0.2126 + fog.color.g * 0.7152 + fog.color.b * 0.0722;
	if (fogLuminance < FOG_HORIZON_LUMINANCE_FLOOR) {
		const rescue = THREE.MathUtils.clamp((FOG_HORIZON_LUMINANCE_FLOOR - fogLuminance) / FOG_HORIZON_LUMINANCE_FLOOR, 0, 1);
		fog.color.lerp(FOG_HORIZON_FLOOR_COLOR, rescue);
	}

	const density = THREE.MathUtils.lerp(FOG_DENSITY_DAY, FOG_DENSITY_NIGHT, nightFactor)
		+ twilight * FOG_TWILIGHT_DENSITY_GAIN
		+ warmAerosol * FOG_WARM_AEROSOL_DENSITY_GAIN
		+ dustAerosol * FOG_DUST_AEROSOL_DENSITY_GAIN
		+ humidBlueHour * FOG_BLUE_HOUR_DENSITY_GAIN
		+ humidDay * FOG_HUMID_DAY_DENSITY_GAIN
		- clearTwilight * FOG_CLEAR_TWILIGHT_CLARITY_GAIN
		- clearBlueHour * FOG_CLEAR_BLUE_HOUR_CLARITY_GAIN
		- clearDeepNight * FOG_CLEAR_DEEP_NIGHT_CLARITY_GAIN
		- fullDay * FOG_MIDDAY_CLARITY_GAIN
		- clearBlueDay * FOG_CLEAR_BLUE_DAY_CLARITY_GAIN
		- moonlitNight * FOG_MOONLIT_CLARITY_GAIN;
	fog.density = THREE.MathUtils.clamp(density, FOG_DENSITY_MIN, FOG_DENSITY_MAX);
}
