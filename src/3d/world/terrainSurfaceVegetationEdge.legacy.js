/**
 * Deterministic world-space vegetation edge response for terrain materials.
 *
 * This is a render-only ecological transition pass. It does not spawn trees, move vegetation, alter
 * the canonical biome map or create new geography. Existing terrain/vegetation systems continue to
 * own placement. This layer only gives their ground footprint a natural edge: wet meadow, grass,
 * heath, leaf-litter floor, trampling/bare patches, drought stress and tree-line breakup.
 *
 * @module world/terrainSurfaceVegetationEdge
 */

const clamp01 = (value) => Math.max(0, Math.min(1, value));
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (a, b, value) => {
	const t = clamp01((value - a) / Math.max(1e-9, b - a));
	return t * t * (3 - 2 * t);
};

export const TERRAIN_VEGETATION_EDGE_POLICY = Object.freeze({
	id: 'terrain-surface-vegetation-edge-2026-09-14-v1',
	renderOnly: true,
	deterministic: true,
	canonicalHeightUnchanged: true,
	canonicalHydrologyUnchanged: true,
	canonicalBiomeUnchanged: true,
	canonicalVegetationPlacementUnchanged: true,
	canonicalColliderUnchanged: true,
	newGeographyIntroduced: false,
	regionalScaleMeters: 920,
	patchScaleMeters: 240,
	meadowScaleMeters: 86,
	heathScaleMeters: 54,
	litterScaleMeters: 18,
	barePatchScaleMeters: 31,
	treeLineMeters: Object.freeze([170, 330]),
	meadowHeightMeters: Object.freeze([0, 95]),
	heathHeightMeters: Object.freeze([24, 210]),
	slopeBreakDegrees: Object.freeze([12, 34]),
	moistureGain: 0.24,
	droughtGain: 0.19,	albedoEnergy: 0.12,
	roughnessEnergy: 0.09,
	normalEnergy: 0.065,
});

function hash2D(ix, iz, seed) {
	let value = Math.imul((ix | 0) ^ seed, 0x45d9f3b) ^ Math.imul((iz | 0) + seed, 0x119de1f3);
	value ^= value >>> 16;
	value = Math.imul(value, 0x45d9f3b);
	value ^= value >>> 16;
	return (value >>> 0) / 4294967296;
}

function valueNoise(x, z, seed) {
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

function fbm(x, z, seed) {
	let total = 0;
	let weight = 0;
	let amp = 0.55;
	for (let i = 0; i < 5; i += 1) {
		total += valueNoise(x, z, seed + i * 83) * amp;
		weight += amp;
		x = x * 2.03 + 8.9;
		z = z * 2.03 - 5.7;
		amp *= 0.48;
	}
	return total / weight;
}

function ridge(x, z, seed) {
	return 1 - Math.abs(fbm(x, z, seed) * 2 - 1);
}

export function resolveTerrainVegetationEdge({
	worldX,
	worldZ,
	heightMeters = 0,
	slopeDegrees = 0,
	moisture = 0.5,
	vegetationSignal = 0,
	canopyDensity = 0,
}) {
	const regional = fbm(worldX / TERRAIN_VEGETATION_EDGE_POLICY.regionalScaleMeters, worldZ / TERRAIN_VEGETATION_EDGE_POLICY.regionalScaleMeters, 0x19ab);
	const patch = fbm(worldX / TERRAIN_VEGETATION_EDGE_POLICY.patchScaleMeters, worldZ / TERRAIN_VEGETATION_EDGE_POLICY.patchScaleMeters, 0x71c2);
	const meadowField = ridge(worldX / TERRAIN_VEGETATION_EDGE_POLICY.meadowScaleMeters, worldZ / 116, 0x52d7);
	const heathField = ridge(worldX / TERRAIN_VEGETATION_EDGE_POLICY.heathScaleMeters, worldZ / 91, 0x2ca1);
	const litter = valueNoise(worldX / TERRAIN_VEGETATION_EDGE_POLICY.litterScaleMeters, worldZ / TERRAIN_VEGETATION_EDGE_POLICY.litterScaleMeters, 0x8a44);
	const barePatch = ridge(worldX / TERRAIN_VEGETATION_EDGE_POLICY.barePatchScaleMeters, worldZ / 47, 0xa113);
	const lowland = 1 - smoothstep(70, 165, heightMeters);
	const meadowElevation = 1 - smoothstep(TERRAIN_VEGETATION_EDGE_POLICY.meadowHeightMeters[0], TERRAIN_VEGETATION_EDGE_POLICY.meadowHeightMeters[1], Math.max(0, heightMeters));
	const heathElevation = smoothstep(TERRAIN_VEGETATION_EDGE_POLICY.heathHeightMeters[0], TERRAIN_VEGETATION_EDGE_POLICY.heathHeightMeters[1], heightMeters);
	const slopeStress = smoothstep(TERRAIN_VEGETATION_EDGE_POLICY.slopeBreakDegrees[0], TERRAIN_VEGETATION_EDGE_POLICY.slopeBreakDegrees[1], slopeDegrees);
	const treeLine = 1 - smoothstep(TERRAIN_VEGETATION_EDGE_POLICY.treeLineMeters[0], TERRAIN_VEGETATION_EDGE_POLICY.treeLineMeters[1], heightMeters);
	const wetness = clamp01(moisture * 0.66 + (1 - regional) * 0.18 + (1 - patch) * 0.16);
	const drought = clamp01((1 - moisture) * 0.62 + regional * 0.18 + patch * 0.20);
	const ecologicalBreak = clamp01(patch * 0.56 + meadowField * 0.24 + heathField * 0.20);
	const grass = clamp01(vegetationSignal * (0.40 + meadowElevation * 0.30 + wetness * 0.30) * (1 - slopeStress * 0.34));
	const wetMeadow = clamp01(grass * lowland * smoothstep(0.56, 0.82, wetness) * meadowField);
	const dryGrass = clamp01(grass * smoothstep(0.48, 0.80, drought) * (1 - wetMeadow * 0.64) * (0.48 + meadowElevation * 0.52));
	const heath = clamp01(vegetationSignal * heathElevation * smoothstep(0.42, 0.80, ecologicalBreak) * (0.48 + slopeStress * 0.52));
	const forestFloor = clamp01(canopyDensity * treeLine * smoothstep(0.54, 0.82, wetness) * (0.58 + litter * 0.42));
	const bare = clamp01((1 - vegetationSignal * 0.72) * barePatch * (0.32 + slopeStress * 0.38 + drought * 0.30));
	const stress = clamp01(slopeStress * 0.38 + drought * 0.28 + bare * 0.22 + (1 - treeLine) * 0.12);
	return Object.freeze({
		regional,
		patch,
		meadowField,
		heathField,
		litter,
		barePatch,
		lowland,
		meadowElevation,
		heathElevation,
		slopeStress,
		treeLine,
		wetness,
		drought,
		ecologicalBreak,
		grass,
		wetMeadow,
		dryGrass,
		heath,
		forestFloor,
		bare,
		stress,
	});
}

export function resolveVegetationMaterialResponse({ state, baseColor }) {
	const wet = state.wetMeadow * TERRAIN_VEGETATION_EDGE_POLICY.moistureGain;
	const dry = state.dryGrass * TERRAIN_VEGETATION_EDGE_POLICY.droughtGain;
	const heath = state.heath * 0.105;
	const litter = state.forestFloor * 0.095;
	const bare = state.bare * 0.12;
	const color = {
		r: clamp01(baseColor.r * (1 - wet * 0.70 + dry * 0.24 + heath * 0.12 + litter * 0.16 + bare)),
		g: clamp01(baseColor.g * (1 - wet * 0.34 - dry * 0.10 + heath * 0.06 + litter * 0.08 + bare * 0.12)),
		b: clamp01(baseColor.b * (1 - wet * 0.46 - dry * 0.14 + heath * 0.08 + litter * 0.04 + bare * 0.08)),
	};
	const roughness = clamp01(0.72 + state.bare * 0.10 + state.stress * 0.06 - state.wetMeadow * 0.045 + state.forestFloor * 0.025);
	const normalStrength = clamp01(state.bare * 0.46 + state.heath * 0.30 + state.forestFloor * 0.20 + state.wetMeadow * 0.10) * TERRAIN_VEGETATION_EDGE_POLICY.normalEnergy;
	return Object.freeze({ color: Object.freeze(color), roughness, normalStrength });
}

export const TERRAIN_VEGETATION_GLSL = String.raw`
float terrainVegHash(vec2 p){vec3 q=fract(vec3(p.xyx)*vec3(.1031,.1030,.0973));q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}
float terrainVegNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);float a=terrainVegHash(i),b=terrainVegHash(i+vec2(1,0)),c=terrainVegHash(i+vec2(0,1)),d=terrainVegHash(i+vec2(1,1));return mix(mix(a,b,f.x),mix(c,d,f.x),f.y);}
float terrainVegFbm(vec2 p){float v=0.,w=0.,a=.55;for(int i=0;i<4;i++){v+=terrainVegNoise(p)*a;w+=a;p=p*2.03+vec2(8.9,-5.7);a*=.48;}return v/w;}
float terrainVegRidge(vec2 p){return 1.-abs(terrainVegFbm(p)*2.-1.);}
vec3 terrainVegetationState(vec3 position,vec3 worldNormal,vec3 base){vec2 p=position.xz;float h=position.y;float slope=1.-clamp(abs(normalize(worldNormal).y),0.,1.);float regional=terrainVegFbm(p/920.+vec2(7.1,-4.7));float patch=terrainVegFbm(p/240.+vec2(-5.4,8.1));float meadow=terrainVegRidge(vec2(p.x/86.,p.y/116.)+vec2(4.7,-3.2));float heath=terrainVegRidge(vec2(p.x/54.,p.y/91.)+vec2(-9.2,5.4));float litter=terrainVegNoise(p/18.+vec2(12.4,-4.8));float barePatch=terrainVegRidge(vec2(p.x/31.,p.y/47.)+vec2(-3.1,11.2));float vegetation=smoothstep(.004,.085,base.g-max(base.r,base.b));float canopy=clamp(vegetation*(.60+patch*.40),0.,1.);float lowland=1.-smoothstep(70.,165.,h);float meadowElev=1.-smoothstep(0.,95.,max(0.,h));float heathElev=smoothstep(24.,210.,h);float slopeStress=smoothstep(.13,.38,slope);float treeLine=1.-smoothstep(170.,330.,h);float wet=clamp(.55+(.5-regional)*.25+(.5-patch)*.20+(.5-litter)*.05,0.,1.);float drought=clamp((1.-wet)*.70+regional*.16+patch*.14,0.,1.);float ecological=clamp(patch*.56+meadow*.24+heath*.20,0.,1.);float grass=clamp(vegetation*(.40+meadowElev*.30+wet*.30)*(1.-slopeStress*.34),0.,1.);float wetMeadow=clamp(grass*lowland*smoothstep(.56,.82,wet)*meadow,0.,1.);float dryGrass=clamp(grass*smoothstep(.48,.80,drought)*(1.-wetMeadow*.64)*(.48+meadowElev*.52),0.,1.);float heathMask=clamp(vegetation*heathElev*smoothstep(.42,.80,ecological)*(.48+slopeStress*.52),0.,1.);float forestFloor=clamp(canopy*treeLine*smoothstep(.54,.82,wet)*(.58+litter*.42),0.,1.);float bare=clamp((1.-vegetation*.72)*barePatch*(.32+slopeStress*.38+drought*.30),0.,1.);float stress=clamp(slopeStress*.38+drought*.28+bare*.22+(1.-treeLine)*.12,0.,1.);return vec3(wetMeadow,dryGrass+heathMask*.5,clamp(forestFloor+bare,0.,1.)+stress*.12);}
void terrainVegApplyColor(){vec3 state=terrainVegetationState(vTerrainVegWorldPosition,vTerrainVegWorldNormal,diffuseColor.rgb);float wet=state.x*.24;float dry=state.y*.19;float edge=state.z*.10;float bare=max(0.,state.z-.45)*.10;diffuseColor.rgb*=vec3(1.-wet*.70+dry*.24+edge*.08+bare,1.-wet*.34-dry*.10+edge*.04+bare*.12,1.-wet*.46-dry*.14+edge*.05+bare*.08);diffuseColor.rgb=clamp(diffuseColor.rgb,vec3(.01),vec3(.88));}
void terrainVegApplyRoughness(){vec3 state=terrainVegetationState(vTerrainVegWorldPosition,vTerrainVegWorldNormal,diffuseColor.rgb);float fine=terrainVegNoise(vTerrainVegWorldPosition.xz/18.+vec2(12.4,-4.8));roughnessFactor=clamp(roughnessFactor+state.z*.06+fine*.025-state.x*.045,0.42,1.0);}
void terrainVegApplyNormal(){vec2 p=vTerrainVegWorldPosition.xz;float a=terrainVegNoise(p/18.+vec2(12.4,-4.8));float b=terrainVegNoise(p/18.+vec2(13.1,-4.2));float r=terrainVegRidge(vec2(p.x/54.,p.y/91.)+vec2(-9.2,5.4));vec3 state=terrainVegetationState(vTerrainVegWorldPosition,vTerrainVegWorldNormal,diffuseColor.rgb);normal=normalize(normal+mat3(viewMatrix)*vec3(-(b-a),0.,-(r-.5))*(state.x*.018+state.y*.022+state.z*.026));}
`;

export function installTerrainVegetationEdge(material) {
	if (!material) throw new TypeError('terrain vegetation edge requires a material');
	const previousOnBeforeCompile = material.onBeforeCompile.bind(material);
	material.onBeforeCompile = (shader, renderer) => {
		previousOnBeforeCompile(shader, renderer);
		shader.vertexShader = shader.vertexShader
			.replace('#include <common>', '#include <common>\nvarying vec3 vTerrainVegWorldPosition;\nvarying vec3 vTerrainVegWorldNormal;')
			.replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nvTerrainVegWorldNormal=normalize(mat3(modelMatrix)*objectNormal);')
			.replace('#include <begin_vertex>', '#include <begin_vertex>\nvTerrainVegWorldPosition=(modelMatrix*vec4(transformed,1.0)).xyz;');
		shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\n${TERRAIN_VEGETATION_GLSL}`);
		shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\nterrainVegApplyColor();');
		shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nterrainVegApplyRoughness();');
		shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nterrainVegApplyNormal();');
	};
	const previousProgramKey = material.customProgramCacheKey?.bind(material);
	material.customProgramCacheKey = () => `${previousProgramKey ? previousProgramKey() : ''}|${TERRAIN_VEGETATION_EDGE_POLICY.id}`;
	material.userData = {
		...material.userData,
		terrainVegetationEdge: Object.freeze({
			policyId: TERRAIN_VEGETATION_EDGE_POLICY.id,
			canonicalHeightUnchanged: true,
			canonicalHydrologyUnchanged: true,
			canonicalBiomeUnchanged: true,
			canonicalVegetationPlacementUnchanged: true,
			canonicalColliderUnchanged: true,
			newGeographyIntroduced: false,
			wetMeadowEdges: true,
			dryGrassStress: true,
			heathTransition: true,
			forestFloorLitter: true,
			barePatchBreakup: true,
			treeLineStress: true,
			worldSpaceAlbedo: true,
			worldSpaceNormal: true,
			worldSpaceRoughness: true,
		}),
	};
	return material;
}
