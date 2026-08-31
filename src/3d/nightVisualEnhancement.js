import * as THREE from 'three';

const NIGHT_CINEMATIC_FILL_NAME = 'Game Night Cinematic Fill';
const NIGHT_CINEMATIC_DAY_INTENSITY = 0.02;
const NIGHT_CINEMATIC_FULL_INTENSITY = 0.58;
const NIGHT_CINEMATIC_TWILIGHT_SKY = new THREE.Color(0x8aa6c3);
const NIGHT_CINEMATIC_DEEP_SKY = new THREE.Color(0x536f92);
const NIGHT_CINEMATIC_TWILIGHT_GROUND = new THREE.Color(0x4d5146);
const NIGHT_CINEMATIC_DEEP_GROUND = new THREE.Color(0x252e2c);

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
	fill.color.copy(NIGHT_CINEMATIC_TWILIGHT_SKY).lerp(NIGHT_CINEMATIC_DEEP_SKY, deepNight);
	fill.groundColor.copy(NIGHT_CINEMATIC_TWILIGHT_GROUND).lerp(NIGHT_CINEMATIC_DEEP_GROUND, deepNight);
	const readability = THREE.MathUtils.lerp(NIGHT_CINEMATIC_DAY_INTENSITY, NIGHT_CINEMATIC_FULL_INTENSITY, night);
	fill.intensity = readability * (1 + shoulder * 0.07) * THREE.MathUtils.lerp(1, 0.84, deepNight);
	fill.userData.deepNightWeight = deepNight;
	fill.userData.transitionShoulder = shoulder;
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
		phaseAdaptive: Boolean(fill?.userData?.phaseAdaptive),
	});
}
