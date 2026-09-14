/**
 * Deterministic terrain transition field for water, cryosphere and ecological material boundaries.
 *
 * This module is a render-space companion to terrainSurfaceFacies. It deliberately does not create
 * water or ice geometry. It only exposes bounded masks that let existing canonical geometry render
 * with the expected physical transition: fine shoreline stain, alluvial wash, damp rock, snow
 * accumulation/scour, exposed substrate and vegetation edge stress.
 *
 * @module world/terrainSurfaceTransitionField
 */

const clamp01 = (value) => Math.max(0, Math.min(1, value));
const smoothstep = (a, b, value) => {
	const t = clamp01((value - a) / Math.max(1e-9, b - a));
	return t * t * (3 - 2 * t);
};
const lerp = (a, b, t) => a + (b - a) * t;

export const TERRAIN_TRANSITION_POLICY = Object.freeze({
	id: 'terrain-surface-transition-field-2026-09-14-v1',
	renderOnly: true,
	deterministic: true,
	canonicalHeightUnchanged: true,
	canonicalHydrologyUnchanged: true,
	canonicalWaterGeometryUnchanged: true,
	canonicalIceGeometryUnchanged: true,
	worldBandsMeters: Object.freeze([1.0, 2.5, 5.2, 9, 18, 34, 74, 155, 390]),
	shorelineStainMeters: 2.5,
	intertidalMeters: 5.2,
	saltSprayMeters: 18,
	alluvialWashMeters: 155,
	bankStressMeters: 74,
	snowScourMeters: 34,
	snowCrustMeters: 4,
	iceTransitionMeters: 12,
	dampRockRoughnessDelta: -0.075,
	saltRoughnessDelta: 0.055,
	snowRoughnessDelta: 0.085,
	vegetationEdgeFade: 0.28,
	directionalSlopeGain: 0.18,
});

function hashCell(ix, iz, seed) {
	let value = Math.imul((ix | 0) ^ seed, 0x45d9f3b) ^ Math.imul((iz | 0) + seed, 0x119de1f3);
	value ^= value >>> 16;
	value = Math.imul(value, 0x45d9f3b);
	value ^= value >>> 16;
	return (value >>> 0) / 4294967296;
}

export function transitionNoise(x, z, scale, seed = 0x31a9) {
	const gx = x / scale;
	const gz = z / scale;
	const ix = Math.floor(gx);
	const iz = Math.floor(gz);
	const fx = gx - ix;
	const fz = gz - iz;
	const ux = fx * fx * (3 - 2 * fx);
	const uz = fz * fz * (3 - 2 * fz);
	const a = hashCell(ix, iz, seed);
	const b = hashCell(ix + 1, iz, seed);
	const c = hashCell(ix, iz + 1, seed);
	const d = hashCell(ix + 1, iz + 1, seed);
	return lerp(lerp(a, b, ux), lerp(c, d, ux), uz);
}

export function transitionFbm(x, z, scales = [640, 220, 74, 22], seed = 0x51cf) {
	let total = 0;
	let totalWeight = 0;
	for (let i = 0; i < scales.length; i += 1) {
		const weight = 0.52 / (1 + i * 0.32);
		total += transitionNoise(x, z, scales[i], seed + i * 97) * weight;
		totalWeight += weight;
	}
	return total / totalWeight;
}

export function resolveShoreTransition({ worldX, worldZ, coastHeightMeters, slopeDegrees = 0 }) {
	const macro = transitionFbm(worldX, worldZ, [520, 190, 62], 0x1f39);
	const fine = transitionNoise(worldX, worldZ, 11, 0x8b22);
	const stain = (1 - smoothstep(0.25, TERRAIN_TRANSITION_POLICY.shorelineStainMeters, coastHeightMeters))
		* (0.64 + macro * 0.36);
	const intertidal = 1 - smoothstep(0.25, TERRAIN_TRANSITION_POLICY.intertidalMeters, coastHeightMeters);
	const saltSpray = (1 - smoothstep(1.2, TERRAIN_TRANSITION_POLICY.saltSprayMeters, coastHeightMeters))
		* (1 - intertidal * 0.70)
		* smoothstep(0.48, 0.84, fine);
	const bankStress = (1 - smoothstep(1, TERRAIN_TRANSITION_POLICY.bankStressMeters, coastHeightMeters))
		* smoothstep(0.10, 0.58, slopeDegrees / 90);
	const alluvialWash = (1 - smoothstep(1.5, TERRAIN_TRANSITION_POLICY.alluvialWashMeters, coastHeightMeters))
		* (0.30 + macro * 0.70);
	return Object.freeze({
		macro,
		fine,
		stain,
		intertidal,
		saltSpray,
		bankStress,
		alluvialWash,
		wetness: clamp01(stain * 0.60 + bankStress * 0.18 + alluvialWash * 0.22),
	});
}

export function resolveCryosphereTransition({
	worldX,
	worldZ,
	heightMeters,
	slopeDegrees,
	northness = 0,
	baseSnow = 0,
}) {
	const broad = transitionFbm(worldX, worldZ, [820, 310, 94], 0x9921);
	const fine = transitionNoise(worldX, worldZ, 2.8, 0x72ab);
	const sastrugi = transitionNoise(worldX + worldZ * 0.37, worldZ - worldX * 0.21, 11, 0xa72d);
	const elevationSnow = smoothstep(170, 580, heightMeters);
	const aspectBias = clamp01(0.50 + northness * 0.34);
	const snow = clamp01(Math.max(baseSnow, elevationSnow * (0.56 + broad * 0.25 + aspectBias * 0.19)));
	const scour = snow * smoothstep(16, 42, slopeDegrees) * smoothstep(0.44, 0.82, broad);
	const deposition = snow * (1 - smoothstep(10, 28, slopeDegrees)) * (0.44 + (1 - broad) * 0.56);
	const crust = snow * (0.52 + fine * 0.28 + sastrugi * 0.20);
	const exposedSubstrate = clamp01(scour * 0.68 + smoothstep(0.52, 0.86, sastrugi) * 0.22);
	return Object.freeze({
		broad,
		fine,
		sastrugi,
		snow,
		scour,
		deposition,
		crust,
		exposedSubstrate,
	});
}

export function resolveVegetationEdgeTransition({
	worldX,
	worldZ,
	heightMeters,
	slopeDegrees,
	moisture = 0.5,
	vegetationSignal = 0,
}) {
	const broad = transitionFbm(worldX, worldZ, [680, 240, 68], 0x46d7);
	const fine = transitionNoise(worldX, worldZ, 17, 0x8c44);
	const treeLine = 1 - smoothstep(170, 330, heightMeters);
	const slopeStress = smoothstep(0.22, 0.62, slopeDegrees / 90);
	const droughtStress = smoothstep(0.56, 0.84, 1 - moisture);
	const edgeNoise = smoothstep(0.30, 0.72, fine * 0.64 + broad * 0.36);
	const meadow = vegetationSignal * smoothstep(0.48, 0.82, moisture) * treeLine * (1 - slopeStress * 0.56);
	const heath = vegetationSignal * smoothstep(20, 90, heightMeters) * smoothstep(0.42, 0.80, broad) * (0.45 + slopeStress * 0.55);
	const stress = clamp01(slopeStress * 0.42 + droughtStress * 0.30 + edgeNoise * 0.18 + (1 - treeLine) * 0.10);
	return Object.freeze({
		broad,
		fine,
		meadow,
		heath,
		stress,
		edgeNoise,
	});
}

export function resolveFullTransitionSample(input) {
	const shore = resolveShoreTransition(input);
	const cryosphere = resolveCryosphereTransition(input);
	const vegetation = resolveVegetationEdgeTransition({
		...input,
		moisture: input.moisture ?? shore.wetness,
		vegetationSignal: input.vegetationSignal ?? 0,
	});
	return Object.freeze({ shore, cryosphere, vegetation });
}

export const TERRAIN_TRANSITION_GLSL = String.raw`
float terrainTransitionHash(vec2 p) {
	vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
	q += dot(q, q.yzx + 33.33);
	return fract((q.x + q.y) * q.z);
}

float terrainTransitionNoise(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	float a = terrainTransitionHash(i);
	float b = terrainTransitionHash(i + vec2(1.0, 0.0));
	float c = terrainTransitionHash(i + vec2(0.0, 1.0));
	float d = terrainTransitionHash(i + vec2(1.0, 1.0));
	return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float terrainTransitionFbm(vec2 p) {
	float value = 0.0;
	float weight = 0.0;
	float amp = 0.54;
	for (int i = 0; i < 4; i++) {
		value += terrainTransitionNoise(p) * amp;
		weight += amp;
		p = p * 2.03 + vec2(13.2, -7.7);
		amp *= 0.48;
	}
	return value / max(weight, 0.0001);
}

float terrainTransitionRidge(vec2 p) {
	return 1.0 - abs(terrainTransitionFbm(p) * 2.0 - 1.0);
}

vec3 terrainTransitionState(vec3 position, vec3 worldNormal, vec3 base) {
	vec2 p = position.xz;
	float coastHeight = position.y - 6.0;
	float slope = 1.0 - clamp(abs(normalize(worldNormal).y), 0.0, 1.0);
	float snow = smoothstep(0.58, 0.88, dot(base, vec3(0.2126, 0.7152, 0.0722))) * (1.0 - smoothstep(0.08, 0.24, max(base.r, max(base.g, base.b)) - min(base.r, min(base.g, base.b))));
	float broad = terrainTransitionFbm(p / 520.0 + vec2(9.4, -4.1));
	float meso = terrainTransitionFbm(p / 118.0 + vec2(-12.7, 7.3));
	float fine = terrainTransitionNoise(p / 18.0 + vec2(3.7, 19.1));
	float stain = (1.0 - smoothstep(0.25, 2.5, coastHeight)) * (0.58 + broad * 0.42);
	float intertidal = 1.0 - smoothstep(0.25, 5.2, coastHeight);
	float salt = (1.0 - smoothstep(1.2, 18.0, coastHeight)) * (1.0 - intertidal * 0.70) * smoothstep(0.48, 0.84, fine);
	float alluvial = (1.0 - smoothstep(1.5, 155.0, coastHeight)) * (0.35 + broad * 0.65) * (1.0 - slope * 0.50);
	float bank = (1.0 - smoothstep(1.0, 74.0, coastHeight)) * smoothstep(0.12, 0.56, slope);
	float scour = snow * smoothstep(0.22, 0.70, slope) * smoothstep(0.44, 0.82, broad);
	float deposition = snow * (1.0 - smoothstep(0.16, 0.48, slope)) * (0.44 + (1.0 - broad) * 0.56);
	float vegetation = smoothstep(0.004, 0.085, base.g - max(base.r, base.b));
	float moisture = clamp(0.50 + (0.5 - broad) * 0.34 + (0.5 - meso) * 0.16 + stain * 0.12 + alluvial * 0.11, 0.0, 1.0);
	return vec3(
		clamp(stain * 0.58 + alluvial * 0.22 + bank * 0.20, 0.0, 1.0),
		clamp(salt * 0.58 + intertidal * 0.24 + vegetation * 0.18, 0.0, 1.0),
		clamp(scour * 0.56 + deposition * 0.44 + moisture * 0.05, 0.0, 1.0)
	);
}
`;

export function installTerrainTransitionField(material) {
	if (!material) throw new TypeError('terrain transition field requires a material');
	const previousOnBeforeCompile = material.onBeforeCompile.bind(material);
	material.onBeforeCompile = (shader, renderer) => {
		previousOnBeforeCompile(shader, renderer);
		shader.vertexShader = shader.vertexShader
			.replace('#include <common>', '#include <common>\nvarying vec3 vTerrainTransitionWorldPosition;\nvarying vec3 vTerrainTransitionWorldNormal;')
			.replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nvTerrainTransitionWorldNormal = normalize(mat3(modelMatrix) * objectNormal);')
			.replace('#include <begin_vertex>', '#include <begin_vertex>\nvTerrainTransitionWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;');
		shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\n${TERRAIN_TRANSITION_GLSL}`);
		shader.fragmentShader = shader.fragmentShader.replace(
			'#include <color_fragment>',
			`#include <color_fragment>
vec3 terrainTransitionStateValue=terrainTransitionState(vTerrainTransitionWorldPosition,vTerrainTransitionWorldNormal,diffuseColor.rgb);
float terrainTransitionShore=terrainTransitionStateValue.x;
float terrainTransitionSalt=terrainTransitionStateValue.y;
float terrainTransitionCryo=terrainTransitionStateValue.z;
float terrainTransitionLuma=dot(diffuseColor.rgb,vec3(0.2126,0.7152,0.0722));
diffuseColor.rgb=mix(diffuseColor.rgb,vec3(0.12,0.13,0.12),terrainTransitionShore*0.13);
diffuseColor.rgb=mix(diffuseColor.rgb,vec3(0.33,0.33,0.31),terrainTransitionSalt*0.07);
diffuseColor.rgb=mix(diffuseColor.rgb,vec3(0.68,0.73,0.75),terrainTransitionCryo*0.19);
diffuseColor.rgb=mix(diffuseColor.rgb,vec3(terrainTransitionLuma),0.025+terrainTransitionCryo*0.035);`,
		);
		shader.fragmentShader = shader.fragmentShader.replace(
			'#include <roughnessmap_fragment>',
			`#include <roughnessmap_fragment>
float terrainTransitionRoughnessDelta=-terrainTransitionShore*0.075+terrainTransitionSalt*0.055+terrainTransitionCryo*0.085;
roughnessFactor=clamp(roughnessFactor+terrainTransitionRoughnessDelta,0.42,1.0);`,
		);
		shader.fragmentShader = shader.fragmentShader.replace(
			'#include <normal_fragment_maps>',
			`#include <normal_fragment_maps>
float terrainTransitionGradientA=terrainTransitionNoise(vTerrainTransitionWorldPosition.xz/12.0+vec2(7.2,-4.6));
float terrainTransitionGradientB=terrainTransitionNoise(vTerrainTransitionWorldPosition.xz/12.0+vec2(7.7,-4.1));
vec2 terrainTransitionGradient=vec2(terrainTransitionGradientB-terrainTransitionGradientA,terrainTransitionGradientA-0.5);
normal=normalize(normal+mat3(viewMatrix)*vec3(-terrainTransitionGradient.x,0.0,-terrainTransitionGradient.y)*0.055);`,
		);
	};
	const previousProgramKey = material.customProgramCacheKey?.bind(material);
	material.customProgramCacheKey = () => `${previousProgramKey ? previousProgramKey() : ''}|${TERRAIN_TRANSITION_POLICY.id}`;
	material.userData = {
		...material.userData,
		terrainSurfaceTransition: Object.freeze({
			policyId: TERRAIN_TRANSITION_POLICY.id,
			worldBandsMeters: TERRAIN_TRANSITION_POLICY.worldBandsMeters,
			canonicalHeightUnchanged: true,
			canonicalHydrologyUnchanged: true,
			canonicalWaterGeometryUnchanged: true,
			canonicalIceGeometryUnchanged: true,
			shorelineStain: true,
			alluvialWash: true,
			saltSpray: true,
			snowScour: true,
			snowDeposition: true,
			vegetationEdgeStress: true,
		}),
	};
	return material;
}
