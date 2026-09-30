/**
 * Deterministic world-space erosion/weathering field for canonical terrain materials.
 *
 * This layer models the visual fingerprints of runoff, rills, depositional fans, soil sealing and
 * aspect-driven weathering without ever modifying the canonical height field, river/lake geometry,
 * shoreline masks, roads or colliders. It is deliberately directional and multi-scale so it reads
 * as geomorphology rather than as circular procedural texture repetition.
 *
 * @module world/terrainSurfaceErosionField
 */

const clamp01 = (value) => Math.max(0, Math.min(1, value));
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (a, b, value) => {
	const t = clamp01((value - a) / Math.max(1e-9, b - a));
	return t * t * (3 - 2 * t);
};

export const TERRAIN_EROSION_FIELD_POLICY = Object.freeze({
	id: 'terrain-surface-erosion-field-2026-09-14-v1-runoff-rill-deposition',
	renderOnly: true,
	deterministic: true,
	canonicalHeightUnchanged: true,
	canonicalHydrologyUnchanged: true,
	canonicalCoastlineUnchanged: true,
	canonicalColliderUnchanged: true,
	canonicalRoadsUnchanged: true,
	newGeographyIntroduced: false,
	regionalScaleMeters: 2400,
	catchmentScaleMeters: 760,
	runnelScaleMeters: 260,
	rillScaleMeters: 74,
	grainScaleMeters: 19,
	depositionFanScaleMeters: 155,
	aspectBearingRadians: 0.72,
	soilSealingHeightMeters: 110,
	exposedRockSlopeDegrees: Object.freeze([22, 46]),
	rillSlopeDegrees: Object.freeze([7, 28]),	depositionSlopeDegrees: Object.freeze([1, 12]),
	albedoEnergy: 0.085,
	normalEnergy: 0.075,
	roughnessEnergy: 0.11,
});

function hash2D(ix, iz, seed) {
	let value = Math.imul((ix | 0) ^ seed, 0x45d9f3b) ^ Math.imul((iz | 0) + seed, 0x119de1f3);
	value ^= value >>> 16;
	value = Math.imul(value, 0x45d9f3b);
	value ^= value >>> 16;
	return (value >>> 0) / 4294967296;
}

function noise2D(x, z, seed) {
	const ix = Math.floor(x);
	const iz = Math.floor(z);
	const fx = x - ix;
	const fz = z - iz;
	const ux = fx * fx * (3 - 2 * fx);
	const uz = fz * fz * (3 - 2 * fz);
	const a = hash2D(ix, iz, seed);
	const b = hash2D(ix + 1, iz, seed);
	const c = hash2D(ix, iz + 1, seed);
	const d = hash2D(ix + 1, iz + 1, seed);
	return lerp(lerp(a, b, ux), lerp(c, d, ux), uz);
}

function fbm2D(x, z, seed, octaves = 4) {
	let total = 0;
	let weight = 0;
	let amplitude = 0.54;
	for (let octave = 0; octave < octaves; octave += 1) {
		total += noise2D(x, z, seed + octave * 97) * amplitude;
		weight += amplitude;
		x = x * 2.03 + 7.4;
		z = z * 2.03 - 5.2;
		amplitude *= 0.49;
	}
	return total / weight;
}

function ridge2D(x, z, seed) {
	return 1 - Math.abs(fbm2D(x, z, seed) * 2 - 1);
}

function rotate(x, z, radians) {
	const c = Math.cos(radians);
	const s = Math.sin(radians);
	return { x: x * c - z * s, z: x * s + z * c };
}

export function resolveTerrainErosionField({
	worldX,
	worldZ,
	heightMeters = 0,
	slopeDegrees = 0,
	moisture = 0.5,
	vegetationSignal = 0,
	aspect = 0,
}) {
	const regional = fbm2D(worldX / TERRAIN_EROSION_FIELD_POLICY.regionalScaleMeters, worldZ / TERRAIN_EROSION_FIELD_POLICY.regionalScaleMeters, 0x17ac, 5);
	const catchment = fbm2D(worldX / TERRAIN_EROSION_FIELD_POLICY.catchmentScaleMeters, worldZ / TERRAIN_EROSION_FIELD_POLICY.catchmentScaleMeters, 0x2f83, 5);
	const runoffDomain = rotate(worldX, worldZ, TERRAIN_EROSION_FIELD_POLICY.aspectBearingRadians);
	const runoff = fbm2D(runoffDomain.x / TERRAIN_EROSION_FIELD_POLICY.tunnelScaleMeters, runoffDomain.z / TERRAIN_EROSION_FIELD_POLICY.tunnelScaleMeters, 0x8a19, 4);
	const rill = ridge2D(runoffDomain.x / TERRAIN_EROSION_FIELD_POLICY.rillScaleMeters, runoffDomain.z / TERRAIN_EROSION_FIELD_POLICY.rillScaleMeters, 0x44bc);
	const grain = noise2D(worldX / TERRAIN_EROSION_FIELD_POLICY.grainScaleMeters, worldZ / TERRAIN_EROSION_FIELD_POLICY.grainScaleMeters, 0x7a31);
	const depositionFan = ridge2D(worldX / TERRAIN_EROSION_FIELD_POLICY.depositionFanScaleMeters, worldZ / 86, 0x9c21);
	const slopeRunoff = smoothstep(TERRAIN_EROSION_FIELD_POLICY.rillSlopeDegrees[0], TERRAIN_EROSION_FIELD_POLICY.rillSlopeDegrees[1], slopeDegrees);
	const steepExposure = smoothstep(TERRAIN_EROSION_FIELD_POLICY.exposedRockSlopeDegrees[0], TERRAIN_EROSION_FIELD_POLICY.exposedRockSlopeDegrees[1], slopeDegrees);
	const depositionalSlope = 1 - smoothstep(TERRAIN_EROSION_FIELD_POLICY.depositionSlopeDegrees[0], TERRAIN_EROSION_FIELD_POLICY.depositionSlopeDegrees[1], slopeDegrees);
	const aspectExposure = clamp01(0.5 + Math.cos(aspect - TERRAIN_EROSION_FIELD_POLICY.aspectBearingRadians) * 0.5);
	const vegetationShield = clamp01(vegetationSignal * (0.48 + moisture * 0.52));
	const runoffEnergy = clamp01((0.36 + regional * 0.20 + catchment * 0.24 + runoff * 0.20) * (0.54 + moisture * 0.46));
	const rillEnergy = clamp01(slopeRunoff * runoffEnergy * rill * (1 - vegetationShield * 0.42));
	const channelStain = clamp01(rillEnergy * (0.36 + catchment * 0.40 + grain * 0.24));
	const deposition = clamp01(depositionalSlope * (1 - vegetationShield * 0.24) * (0.34 + (1 - runoffEnergy) * 0.36 + depositionFan * 0.30));
	const soilSealing = clamp01((1 - steepExposure) * (1 - vegetationSignal * 0.62) * smoothstep(18, TERRAIN_EROSION_FIELD_POLICY.soilSealingHeightMeters, heightMeters) * (0.34 + grain * 0.66));
	const weathering = clamp01(steepExposure * (0.42 + aspectExposure * 0.26 + Math.max(0, heightMeters - 80) / 620 * 0.32));
	const aeolianDust = clamp01((1 - moisture) * (1 - vegetationSignal * 0.45) * (0.40 + regional * 0.36 + grain * 0.24));
	return Object.freeze({
		regional,
		catchment,
		runoff,
		rill,
		grain,
		depositionFan,
		slopeRunoff,
		steepExposure,
		depositionalSlope,
		aspectExposure,
		vegetationShield,
		runoffEnergy,
		rillEnergy,
		channelStain,
		deposition,
		soilSealing,
		weathering,
		aeolianDust,
	});
}

export function resolveTerrainErosionResponse({ field, baseColor }) {
	const stain = field.channelStain * 0.055;
	const dust = field.aeolianDust * 0.045;
	const deposit = field.deposition * 0.065;
	const weather = field.weathering * 0.04;
	const color = {
		r: clamp01(baseColor.r * (1 - stain * 0.72 + dust + deposit * 0.54 - weather * 0.44)),
		g: clamp01(baseColor.g * (1 - stain * 0.55 + dust * 0.64 + deposit * 0.42 - weather * 0.31)),
		b: clamp01(baseColor.b * (1 - stain * 0.40 + dust * 0.48 + deposit * 0.24 - weather * 0.20)),
	};
	const roughness = clamp01(0.73 + field.rillEnergy * 0.08 + field.weathering * 0.09 + field.grain * 0.04 - field.channelStain * 0.05 + field.deposition * 0.04);
	const normalStrength = clamp01(field.rillEnergy * 0.54 + field.weathering * 0.30 + field.deposition * 0.16) * TERRAIN_EROSION_FIELD_POLICY.normalEnergy;
	return Object.freeze({ color: Object.freeze(color), roughness, normalStrength, stain, dust, deposit, weather });
}

export const TERRAIN_EROSION_GLSL = String.raw`
float terrainErosionHash(vec2 p){vec3 q=fract(vec3(p.xyx)*vec3(.1031,.1030,.0973));q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}
float terrainErosionNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);float a=terrainErosionHash(i),b=terrainErosionHash(i+vec2(1,0)),c=terrainErosionHash(i+vec2(0,1)),d=terrainErosionHash(i+vec2(1,1));return mix(mix(a,b,f.x),mix(c,d,f.x),f.y);}
float terrainErosionFbm(vec2 p){float v=0.,w=0.,a=.54;for(int i=0;i<4;i++){v+=terrainErosionNoise(p)*a;w+=a;p=p*2.03+vec2(7.4,-5.2);a*=.49;}return v/w;}
float terrainErosionRidge(vec2 p){return 1.-abs(terrainErosionFbm(p)*2.-1.);}
vec2 terrainErosionRotate(vec2 p,float a){float c=cos(a),s=sin(a);return vec2(p.x*c-p.y*s,p.x*s+p.y*c);}
vec3 terrainErosionState(vec3 position,vec3 worldNormal,vec3 base){vec2 p=position.xz;float h=position.y;vec3 n=normalize(worldNormal);float slope=1.-clamp(abs(n.y),0.,1.);float regional=terrainErosionFbm(p/2400.+vec2(4.2,-8.7));float catchment=terrainErosionFbm(p/760.+vec2(-6.4,9.1));vec2 runoffP=terrainErosionRotate(p,.72);float runoff=terrainErosionFbm(runoffP/260.+vec2(7.1,3.2));float rill=terrainErosionRidge(runoffP/74.+vec2(-3.7,11.4));float grain=terrainErosionNoise(p/19.+vec2(12.4,-4.8));float fan=terrainErosionRidge(vec2(p.x/155.,p.y/86.)+vec2(8.7,-6.2));float vegetation=smoothstep(.004,.085,base.g-max(base.r,base.b));float moisture=clamp(.5+(.5-regional)*.18+(.5-catchment)*.16,0.,1.);float steep=smoothstep(.37,.73,slope);float slopeRunoff=smoothstep(.12,.47,slope);float depositionalSlope=1.-smoothstep(.018,.18,slope);float shield=clamp(vegetation*(.48+moisture*.52),0.,1.);float energy=clamp((.36+regional*.20+catchment*.24+runoff*.20)*(.54+moisture*.46),0.,1.);float rillEnergy=clamp(slopeRunoff*energy*rill*(1.-shield*.42),0.,1.);float channel=clamp(rillEnergy*(.36+catchment*.40+grain*.24),0.,1.);float deposition=clamp(depositionalSlope*(1.-shield*.24)*(.34+(1.-energy)*.36+fan*.30),0.,1.);float sealing=clamp((1.-steep)*(1.-vegetation*.62)*smoothstep(18.,110.,h)*(.34+grain*.66),0.,1.);float weather=clamp(steep*(.42+.30+max(0.,h-80.)/620.*.32),0.,1.);float dust=clamp((1.-moisture)*(1.-vegetation*.45)*(.40+regional*.36+grain*.24),0.,1.);return vec3(channel,deposition,clamp(weather+rillEnergy*.25+sealing*.15,0.,1.));}
void terrainErosionApplyColor(){vec3 state=terrainErosionState(vTerrainErosionWorldPosition,vTerrainErosionWorldNormal,diffuseColor.rgb);float stain=state.x*.055;float deposit=state.y*.065;float weather=state.z*.04;float dust=max(0.,state.y-.5)*.045;diffuseColor.rgb*=vec3(1.-stain*.72+dust+deposit*.54-weather*.44,1.-stain*.55+dust*.64+deposit*.42-weather*.31,1.-stain*.40+dust*.48+deposit*.24-weather*.20);diffuseColor.rgb=clamp(diffuseColor.rgb,vec3(.01),vec3(.88));}
void terrainErosionApplyRoughness(){vec3 state=terrainErosionState(vTerrainErosionWorldPosition,vTerrainErosionWorldNormal,diffuseColor.rgb);float grain=terrainErosionNoise(vTerrainErosionWorldPosition.xz/19.+vec2(12.4,-4.8));roughnessFactor=clamp(roughnessFactor+state.x*.08+state.z*.09+grain*.04-state.x*.05+state.y*.04,0.42,1.0);}
void terrainErosionApplyNormal(){vec2 p=vTerrainErosionWorldPosition.xz;float a=terrainErosionNoise(p/19.+vec2(12.4,-4.8));float b=terrainErosionNoise(p/19.+vec2(13.1,-4.2));float r=terrainErosionRidge(p/74.+vec2(-3.7,11.4));vec3 state=terrainErosionState(vTerrainErosionWorldPosition,vTerrainErosionWorldNormal,diffuseColor.rgb);normal=normalize(normal+mat3(viewMatrix)*vec3(-(b-a),0.,-(r-.5))*(state.x*.035+state.z*.028+state.y*.018));}
`;

export function installTerrainErosionField(material) {
	if (!material) throw new TypeError('terrain erosion field requires a material');
	const previousOnBeforeCompile = material.onBeforeCompile.bind(material);
	material.onBeforeCompile = (shader, renderer) => {
		previousOnBeforeCompile(shader, renderer);
		shader.vertexShader = shader.vertexShader
			.replace('#include <common>', '#include <common>\nvarying vec3 vTerrainErosionWorldPosition;\nvarying vec3 vTerrainErosionWorldNormal;')
			.replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nvTerrainErosionWorldNormal=normalize(mat3(modelMatrix)*objectNormal);')
			.replace('#include <begin_vertex>', '#include <begin_vertex>\nvTerrainErosionWorldPosition=(modelMatrix*vec4(transformed,1.0)).xyz;');
		shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\n${TERRAIN_EROSION_GLSL}`);
		shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\nterrainErosionApplyColor();');
		shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nterrainErosionApplyRoughness();');
		shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nterrainErosionApplyNormal();');
	};
	const previousProgramKey = material.customProgramCacheKey?.bind(material);
	material.customProgramCacheKey = () => `${previousProgramKey ? previousProgramKey() : ''}|${TERRAIN_EROSION_FIELD_POLICY.id}`;
	material.userData = {
		...material.userData,
		terrainErosionField: Object.freeze({
			policyId: TERRAIN_EROSION_FIELD_POLICY.id,
			canonicalHeightUnchanged: true,
			canonicalHydrologyUnchanged: true,
			canonicalColliderUnchanged: true,
			canonicalRoadsUnchanged: true,
			canonicalCoastlineUnchanged: true,
			newGeographyIntroduced: false,
			worldSpaceRills: true,
			depositionalFans: true,
			soilSealing: true,
			aeolianDust: true,
			aspectWeathering: true,
			worldSpaceAlbedo: true,
			worldSpaceNormal: true,
			worldSpaceRoughness: true,
		}),
	};
	return material;
}
