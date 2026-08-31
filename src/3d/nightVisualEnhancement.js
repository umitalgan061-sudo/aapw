import * as THREE from 'three';

const NIGHT_CINEMATIC_FILL_NAME = 'Game Night Cinematic Fill';
const NIGHT_CINEMATIC_DAY_INTENSITY = 0.02;
const NIGHT_CINEMATIC_FULL_INTENSITY = 0.58;
const NIGHT_CINEMATIC_TWILIGHT_SKY = new THREE.Color(0x8aa6c3);
const NIGHT_CINEMATIC_BLUE_HOUR_SKY = new THREE.Color(0x728fb2);
const NIGHT_CINEMATIC_MOONLIT_SKY = new THREE.Color(0x667f9f);
const NIGHT_CINEMATIC_DEEP_SKY = new THREE.Color(0x4b6789);
const NIGHT_CINEMATIC_TWILIGHT_GROUND = new THREE.Color(0x4d5146);
const NIGHT_CINEMATIC_BLUE_HOUR_GROUND = new THREE.Color(0x3f4841);
const NIGHT_CINEMATIC_MOONLIT_GROUND = new THREE.Color(0x343c37);
const NIGHT_CINEMATIC_DEEP_GROUND = new THREE.Color(0x202927);

function smoothNight(value) {
	const n = THREE.MathUtils.clamp(Number(value) || 0, 0, 1);
	return n * n * (3 - 2 * n);
}

function deepNightWeight(night) {
	return THREE.MathUtils.smoothstep(night, 0.42, 0.94);
}

function transitionShoulder(night) {
	const rise = THREE.MathUtils.smoothstep(night, 0.18, 0.56);
	const fall = 1 - THREE.MathUtils.smoothstep(night, 0.7, 0.98);
	return rise * fall;
}

function blueHourWeight(night) {
	const rise = THREE.MathUtils.smoothstep(night, 0.08, 0.34);
	const fall = 1 - THREE.MathUtils.smoothstep(night, 0.46, 0.72);
	return rise * fall;
}

function moonlitPlateau(night) {
	const rise = THREE.MathUtils.smoothstep(night, 0.28, 0.58);
	const fall = 1 - THREE.MathUtils.smoothstep(night, 0.78, 1.0);
	return rise * fall;
}

function nightPhaseColorWeights(night) {
	const blue = THREE.MathUtils.smoothstep(night, 0.08, 0.36);
	const moon = THREE.MathUtils.smoothstep(night, 0.34, 0.66);
	const deep = THREE.MathUtils.smoothstep(night, 0.72, 0.98);
	const preDeep = 1 - deep;
	const preMoon = 1 - moon;
	return {
		twilight: preDeep * preMoon * (1 - blue),
		blueHour: preDeep * preMoon * blue,
		moonlit: preDeep * moon,
		deepNight: deep,
	};
}

function blendNightPhaseColor(target, twilight, blueHour, moonlit, deepNight, weights) {
	target.setRGB(
		twilight.r * weights.twilight + blueHour.r * weights.blueHour + moonlit.r * weights.moonlit + deepNight.r * weights.deepNight,
		twilight.g * weights.twilight + blueHour.g * weights.blueHour + moonlit.g * weights.moonlit + deepNight.g * weights.deepNight,
		twilight.b * weights.twilight + blueHour.b * weights.blueHour + moonlit.b * weights.moonlit + deepNight.b * weights.deepNight,
	);
}

export function installNightVisualEnhancement(hemisphere) {
	if (!hemisphere?.isHemisphereLight) throw new Error('Night visual enhancement requires the canonical hemisphere light.');
	const existing = hemisphere.getObjectByName(NIGHT_CINEMATIC_FILL_NAME);
	if (existing?.isHemisphereLight) return existing;
	const fill = new THREE.HemisphereLight(NIGHT_CINEMATIC_TWILIGHT_SKY, NIGHT_CINEMATIC_TWILIGHT_GROUND, NIGHT_CINEMATIC_DAY_INTENSITY);
	fill.name = NIGHT_CINEMATIC_FILL_NAME;
	fill.userData.gameNightVisualEnhancement = true;
	fill.userData.phaseAdaptive = true;
	hemisphere.add(fill);
	return fill;
}

export function updateNightVisualEnhancement(hemisphere, nightFactor) {
	const fill = installNightVisualEnhancement(hemisphere);
	const night = smoothNight(nightFactor);
	const deepNight = deepNightWeight(night);
	const shoulder = transitionShoulder(night);
	const blueHour = blueHourWeight(night);
	const moonlit = moonlitPlateau(night);
	const colorWeights = nightPhaseColorWeights(night);
	blendNightPhaseColor(fill.color, NIGHT_CINEMATIC_TWILIGHT_SKY, NIGHT_CINEMATIC_BLUE_HOUR_SKY, NIGHT_CINEMATIC_MOONLIT_SKY, NIGHT_CINEMATIC_DEEP_SKY, colorWeights);
	blendNightPhaseColor(fill.groundColor, NIGHT_CINEMATIC_TWILIGHT_GROUND, NIGHT_CINEMATIC_BLUE_HOUR_GROUND, NIGHT_CINEMATIC_MOONLIT_GROUND, NIGHT_CINEMATIC_DEEP_GROUND, colorWeights);
	const readability = THREE.MathUtils.lerp(NIGHT_CINEMATIC_DAY_INTENSITY, NIGHT_CINEMATIC_FULL_INTENSITY, night);
	const twilightAdaptation = THREE.MathUtils.lerp(0.96, 1.035, blueHour);
	fill.intensity = readability * twilightAdaptation * (1 + shoulder * 0.055 + moonlit * 0.035) * THREE.MathUtils.lerp(1, 0.78, deepNight);
	fill.userData.deepNightWeight = deepNight;
	fill.userData.transitionShoulder = shoulder;
	fill.userData.blueHourWeight = blueHour;
	fill.userData.moonlitPlateau = moonlit;
	fill.userData.phaseColorWeights = colorWeights;
	return fill.intensity;
}

export function getNightVisualEnhancementSnapshot(hemisphere) {
	const fill = hemisphere?.getObjectByName?.(NIGHT_CINEMATIC_FILL_NAME);
	return Object.freeze({
		name: NIGHT_CINEMATIC_FILL_NAME,
		installed: Boolean(fill?.isHemisphereLight),
		intensity: Number(fill?.intensity || 0),
		dayIntensity: NIGHT_CINEMATIC_DAY_INTENSITY,
		fullNightIntensity: NIGHT_CINEMATIC_FULL_INTENSITY,
		deepNightWeight: Number(fill?.userData?.deepNightWeight || 0),
		transitionShoulder: Number(fill?.userData?.transitionShoulder || 0),
		blueHourWeight: Number(fill?.userData?.blueHourWeight || 0),
		moonlitPlateau: Number(fill?.userData?.moonlitPlateau || 0),
		phaseColorWeights: Object.freeze({ ...(fill?.userData?.phaseColorWeights || {}) }),
		phaseAdaptive: Boolean(fill?.userData?.phaseAdaptive),
	});
}
