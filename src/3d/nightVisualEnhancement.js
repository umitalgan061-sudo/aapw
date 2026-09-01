import * as THREE from 'three';

const NIGHT_CINEMATIC_FILL_NAME = 'Game Night Cinematic Fill';
const NIGHT_CINEMATIC_DAY_INTENSITY = 0.02;
const NIGHT_CINEMATIC_FULL_INTENSITY = 0.34;
const NIGHT_CINEMATIC_TWILIGHT_SKY = new THREE.Color(0x8aa6c3);
const NIGHT_CINEMATIC_BLUE_HOUR_SKY = new THREE.Color(0x728fb2);
const NIGHT_CINEMATIC_MOONLIT_SKY = new THREE.Color(0x667f9f);
const NIGHT_CINEMATIC_DEEP_SKY = new THREE.Color(0x4b6789);
const NIGHT_CINEMATIC_AIRGLOW_SKY = new THREE.Color(0x52759a);
const NIGHT_CINEMATIC_TWILIGHT_GROUND = new THREE.Color(0x4d5146);
const NIGHT_CINEMATIC_BLUE_HOUR_GROUND = new THREE.Color(0x3f4841);
const NIGHT_CINEMATIC_MOONLIT_GROUND = new THREE.Color(0x343c37);
const NIGHT_CINEMATIC_DEEP_GROUND = new THREE.Color(0x202927);
const NIGHT_CINEMATIC_WARM_HORIZON = new THREE.Color(0x766f63);
const NIGHT_CINEMATIC_PURKINJE = new THREE.Color(0.91, 1.0, 1.07);
const NIGHT_CINEMATIC_ZENITH_SPECTRAL_SHIFT = new THREE.Color(0.94, 0.995, 1.075);
const NIGHT_CINEMATIC_STARLIGHT_SPECTRAL_SHIFT = new THREE.Color(0.90, 0.985, 1.12);

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

function nocturnalAirglowWeight(night) {
	const rise = THREE.MathUtils.smoothstep(night, 0.72, 0.92);
	const deepHold = 1 - 0.18 * THREE.MathUtils.smoothstep(night, 0.97, 1.0);
	return rise * deepHold;
}

function deepStarlightWeight(night) {
	const rise = THREE.MathUtils.smoothstep(night, 0.80, 0.97);
	return rise * (1 - 0.12 * THREE.MathUtils.smoothstep(night, 0.985, 1.0));
}

function horizonWarmthWeight(night) {
	const sunsetTail = 1 - THREE.MathUtils.smoothstep(night, 0.34, 0.72);
	const darkAdaptation = THREE.MathUtils.smoothstep(night, 0.14, 0.44);
	return sunsetTail * darkAdaptation;
}

function mesopicGroundAdaptation(night, moonlit, deepNight) {
	const onset = THREE.MathUtils.smoothstep(night, 0.38, 0.7);
	const rodDominance = THREE.MathUtils.lerp(0.08, 0.22, deepNight);
	return onset * Math.max(rodDominance, moonlit * 0.14);
}

function mesopicGroundChromaLoss(night, deepNight) {
	const onset = THREE.MathUtils.smoothstep(night, 0.46, 0.82);
	return onset * THREE.MathUtils.lerp(0.06, 0.18, deepNight);
}

function preserveSpectralLuminance(color, spectralTarget, amount, maxAmount = 0.24) {
	const strength = THREE.MathUtils.clamp(amount, 0, maxAmount);
	const luminance = color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722;
	const target = spectralTarget.clone().multiplyScalar(luminance);
	const targetLuminance = target.r * 0.2126 + target.g * 0.7152 + target.b * 0.0722;
	if (targetLuminance > 1e-6) target.multiplyScalar(luminance / targetLuminance);
	color.lerp(target, strength);
}

function nightSurfaceContrast(night, moonlit, deepNight) {
	const directionalWindow = THREE.MathUtils.smoothstep(night, 0.34, 0.72) * (1 - THREE.MathUtils.smoothstep(night, 0.9, 1.0));
	const moonReliefProtection = 1 - 0.18 * Math.max(moonlit, directionalWindow);
	const deepAmbientFalloff = THREE.MathUtils.lerp(1, 0.82, deepNight);
	return moonReliefProtection * deepAmbientFalloff;
}

function terrainNightAdaptation(night, blueHour, moonlit, deepNight) {
	const adaptation = THREE.MathUtils.smoothstep(night, 0.3, 0.9);
	const blueHourLift = blueHour * 0.018;
	const moonlitRelief = moonlit * 0.028;
	const deepCompression = deepNight * 0.045;
	return THREE.MathUtils.clamp(1 + blueHourLift + moonlitRelief - deepCompression * adaptation, 0.94, 1.045);
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
	const airglow = nocturnalAirglowWeight(night);
	const starlight = deepStarlightWeight(night);
	const horizonWarmth = horizonWarmthWeight(night);
	const mesopic = mesopicGroundAdaptation(night, moonlit, deepNight);
	const chromaLoss = mesopicGroundChromaLoss(night, deepNight);
	const mesopicSpectralShift = Math.max(chromaLoss, mesopic * 0.55);
	const zenithSpectralShift = blueHour * 0.065 + moonlit * 0.045 + airglow * 0.025;
	const surfaceContrast = nightSurfaceContrast(night, moonlit, deepNight) * (1 - starlight * 0.025);
	const terrainAdaptation = terrainNightAdaptation(night, blueHour, moonlit, deepNight);
	const colorWeights = nightPhaseColorWeights(night);
	blendNightPhaseColor(fill.color, NIGHT_CINEMATIC_TWILIGHT_SKY, NIGHT_CINEMATIC_BLUE_HOUR_SKY, NIGHT_CINEMATIC_MOONLIT_SKY, NIGHT_CINEMATIC_DEEP_SKY, colorWeights);
	blendNightPhaseColor(fill.groundColor, NIGHT_CINEMATIC_TWILIGHT_GROUND, NIGHT_CINEMATIC_BLUE_HOUR_GROUND, NIGHT_CINEMATIC_MOONLIT_GROUND, NIGHT_CINEMATIC_DEEP_GROUND, colorWeights);
	// Airglow belongs to the upper hemisphere, while mesopic adaptation belongs to terrain bounce.
	// A bounded warm horizon tail keeps twilight mineral/vegetation colours from collapsing into a uniform blue wash.
	fill.color.lerp(NIGHT_CINEMATIC_AIRGLOW_SKY, airglow * 0.075);
	fill.groundColor.lerp(NIGHT_CINEMATIC_WARM_HORIZON, horizonWarmth * 0.055);
	// Keep blue-hour/moonlit skylight spectrally distinct from terrain bounce without changing luminance.
	preserveSpectralLuminance(fill.color, NIGHT_CINEMATIC_ZENITH_SPECTRAL_SHIFT, zenithSpectralShift, 0.10);
	// Deep-night starlight remains a weak upper-hemisphere spectral cue; terrain bounce is not tinted with it.
	preserveSpectralLuminance(fill.color, NIGHT_CINEMATIC_STARLIGHT_SPECTRAL_SHIFT, starlight * 0.055, 0.06);
	// Shift the existing phase colour spectrally instead of blending terrain bounce toward one flat grey-green swatch.
	preserveSpectralLuminance(fill.groundColor, NIGHT_CINEMATIC_PURKINJE, mesopicSpectralShift);
	const readability = THREE.MathUtils.lerp(NIGHT_CINEMATIC_DAY_INTENSITY, NIGHT_CINEMATIC_FULL_INTENSITY, night);
	const twilightAdaptation = THREE.MathUtils.lerp(0.96, 1.035, blueHour);
	const airglowAdaptation = 1 + airglow * 0.018;
	fill.intensity = readability * twilightAdaptation * airglowAdaptation * terrainAdaptation * (1 + shoulder * 0.055 + moonlit * 0.035) * surfaceContrast;
	fill.userData.deepNightWeight = deepNight;
	fill.userData.transitionShoulder = shoulder;
	fill.userData.blueHourWeight = blueHour;
	fill.userData.moonlitPlateau = moonlit;
	fill.userData.airglowWeight = airglow;
	fill.userData.starlightWeight = starlight;
	fill.userData.horizonWarmthWeight = horizonWarmth;
	fill.userData.mesopicGroundAdaptation = mesopic;
	fill.userData.mesopicGroundChromaLoss = chromaLoss;
	fill.userData.mesopicSpectralShift = mesopicSpectralShift;
	fill.userData.zenithSpectralShift = zenithSpectralShift;
	fill.userData.surfaceContrast = surfaceContrast;
	fill.userData.terrainAdaptation = terrainAdaptation;
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
		airglowWeight: Number(fill?.userData?.airglowWeight || 0),
		starlightWeight: Number(fill?.userData?.starlightWeight || 0),
		horizonWarmthWeight: Number(fill?.userData?.horizonWarmthWeight || 0),
		mesopicGroundAdaptation: Number(fill?.userData?.mesopicGroundAdaptation || 0),
		mesopicGroundChromaLoss: Number(fill?.userData?.mesopicGroundChromaLoss || 0),
		mesopicSpectralShift: Number(fill?.userData?.mesopicSpectralShift || 0),
		zenithSpectralShift: Number(fill?.userData?.zenithSpectralShift || 0),
		surfaceContrast: Number(fill?.userData?.surfaceContrast ?? 1),
		terrainAdaptation: Number(fill?.userData?.terrainAdaptation ?? 1),
		phaseColorWeights: Object.freeze({ ...(fill?.userData?.phaseColorWeights || {}) }),
		phaseAdaptive: Boolean(fill?.userData?.phaseAdaptive),
	});
}
