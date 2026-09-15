/**
 * World-space lowland geomorphic fabric.
 *
 * Render-only. The canonical terrain mesh supplies the actual lowland relief; this layer only makes
 * that relief legible through subtle depositional ribbons, wet swales, dry benches, soil aggregates,
 * mineral lag and directional micro-normal response. The vegetation-edge hook is chained here because
 * this material is applied to all terrain chunks; its own masks naturally become negligible outside
 * the lowland regime without touching vegetation placement data.
 *
 * @module world/terrainSurfaceLowlandFabric
 */

import { TERRAIN_VEGETATION_EDGE_POLICY, installTerrainVegetationEdge } from './terrainSurfaceVegetationEdge.js';
import { TERRAIN_SEDIMENT_POLICY, installTerrainSediment } from './terrainSurfaceSediment.js';

const clamp01 = (value) => Math.max(0, Math.min(1, value));
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (a, b, value) => {
	const t = clamp01((value - a) / Math.max(1e-9, b - a));
	return t * t * (3 - 2 * t);
};

export const TERRAIN_LOWINLAND_FABRIC_POLICY = Object.freeze({
	id: 'terrain-surface-lowland-fabric-2026-09-14-v1',
	renderOnly: true,
	deterministic: true,
	canonicalHeightUnchanged: true,
	canonicalHydrologyUnchanged: true,
	canonicalCoastlineUnchanged: true,
	canonicalColliderUnchanged: true,
	newGeographyIntroduced: false,
	domainScalesMeters: Object.freeze([760, 410, 190, 104, 54, 18]),
	swaleScaleMeters: Object.freeze([138, 520]),
	benchScaleMeters: Object.freeze([410, 104]),
	aggregateScaleMeters: 18,
	mineralLagScaleMeters: Object.freeze([82, 246]),
	microNormalScaleMeters: Object.freeze([9, 18, 38]),
	lowlandHeightRangeMeters: Object.freeze([0, 140]),
	plainSlopeMaxDegrees: 16,
	wetnessGain: 0.16,
	drynessGain: 0.14,
	aggregateNormalEnergy: 0.075,
	aggregateRoughnessEnergy: 0.12,
	vegetationEdgePolicyId: TERRAIN_VEGETATION_EDGE_POLICY.id,
	sedimentPolicyId: TERRAIN_SEDIMENT_POLICY.id,
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
		total += valueNoise(x, z, seed + i * 89) * amp;
		weight += amp;
		x = x * 2.03 + 9.4;
		z = z * 2.03 - 6.8;
		amp *= 0.48;
	}
	return total / weight;
}

function ridge(x, z, seed) {
	return 1 - Math.abs(fbm(x, z, seed) * 2 - 1);
}

function rotate(x, z, radians) {
	const c = Math.cos(radians);
	const s = Math.sin(radians);
	return { x: x * c - z * s, z: x * s + z * c };
}

function lowlandDomain(worldX, worldZ) {
	const warpA = fbm(worldX / 760, worldZ / 760, 0x91ab) - 0.5;
	const warpB = fbm(worldX / 540, worldZ / 540, 0x51d2) - 0.5;
	const warped = { x: worldX + warpA * 220, z: worldZ + warpB * 180 };
	const r = rotate(warped.x, warped.z, 0.62);
	return {
		warped,
		r,
		regional: fbm(warped.x / 2400, warped.z / 2400, 0x47a3),
		broad: fbm(warped.x / 760, warped.z / 760, 0x2f19),
		macro: fbm(warped.x / 320, warped.z / 320, 0x9c41),
		meso: fbm(r.x / 128, r.z / 390, 0x6e22),
		bench: fbm(r.x / 410, r.z / 104, 0x73b1),
		swale: fbm(r.x / 138, r.z / 520, 0x14d7),
		aggregate: ridge(r.x / 18, r.z / 26, 0x7f31),
		lag: ridge(r.x / 82, r.z / 246, 0x4ab8),
		fine: valueNoise(r.x / 18, r.z / 18, 0x18c9),
	};
}

export function resolveTerrainLowlandFabric({ worldX, worldZ, heightMeters = 0, slopeDegrees = 0, moisture = 0.5 }) {
	const domain = lowlandDomain(worldX, worldZ);
	const lowland = (1 - smoothstep(80, 170, heightMeters)) * (1 - smoothstep(10, TERRAIN_LOWINLAND_FABRIC_POLICY.plainSlopeMaxDegrees, slopeDegrees));
	const moistureField = clamp01(moisture * 0.62 + (0.5 - domain.regional) * 0.18 + (0.5 - domain.broad) * 0.14 + (0.5 - domain.swale) * 0.06);
	const wetSwale = lowland * smoothstep(0.48, 0.80, moistureField) * smoothstep(0.44, 0.82, domain.swale);
	const dryBench = lowland * smoothstep(0.48, 0.80, 1 - moistureField) * smoothstep(0.46, 0.82, domain.bench);
	const alluvialRibbon = lowland * (0.35 + domain.macro * 0.65) * smoothstep(0.46, 0.82, moistureField) * smoothstep(0.44, 0.80, domain.swale);
	const soilAggregate = lowland * (0.34 + domain.aggregate * 0.66) * (0.55 + dryBench * 0.45);
	const mineralLag = lowland * domain.lag * (0.30 + domain.macro * 0.42 + (1 - moistureField) * 0.28);
	const ecologicalBreak = clamp01(domain.meso * 0.56 + domain.fine * 0.28 + domain.broad * 0.16);
	return Object.freeze({ lowland, moistureField, wetSwale, dryBench, alluvialRibbon, soilAggregate, mineralLag, ecologicalBreak, regional: domain.regional, broad: domain.broad, macro: domain.macro, meso: domain.meso, fine: domain.fine });
}

export function resolveTerrainLowlandMaterialResponse({ fabric, baseColor }) {
	const damp = fabric.wetSwale * TERRAIN_LOWINLAND_FABRIC_POLICY.wetnessGain;
	const dry = fabric.dryBench * TERRAIN_LOWINLAND_FABRIC_POLICY.drynessGain;
	const aggregate = fabric.soilAggregate * TERRAIN_LOWINLAND_FABRIC_POLICY.aggregateRoughnessEnergy;
	const lag = fabric.mineralLag * 0.085;
	const color = {
		r: clamp01(baseColor.r * (1 - damp + dry * 0.34 + lag * 0.25)),
		g: clamp01(baseColor.g * (1 - damp * 0.74 + dry * 0.22 + lag * 0.16)),
		b: clamp01(baseColor.b * (1 - damp * 0.42 + dry * 0.12 + lag * 0.08)),
	};
	const roughness = clamp01(0.74 + aggregate + fabric.mineralLag * 0.065 - fabric.wetSwale * 0.055);
	const normalStrength = clamp01(fabric.soilAggregate * 0.56 + fabric.mineralLag * 0.44) * TERRAIN_LOWINLAND_FABRIC_POLICY.aggregateNormalEnergy;
	return Object.freeze({ color: Object.freeze(color), roughness, normalStrength, damp, dry, aggregate, lag });
}

export const TERRAIN_LOWINLAND_GLSL = String.raw`
float terrainLowHash(vec2 p){vec3 q=fract(vec3(p.xyx)*vec3(.1031,.1030,.0973));q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}
float terrainLowNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);float a=terrainLowHash(i),b=terrainLowHash(i+vec2(1,0)),c=terrainLowHash(i+vec2(0,1)),d=terrainLowHash(i+vec2(1,1));return mix(mix(a,b,f.x),mix(c,d,f.x),f.y);}
float terrainLowFbm(vec2 p){float v=0.,w=0.,a=.55;for(int i=0;i<5;i++){v+=terrainLowNoise(p)*a;w+=a;p=p*2.03+vec2(9.4,-6.8);a*=.48;}return v/w;}
float terrainLowRidge(vec2 p){return 1.-abs(terrainLowFbm(p)*2.-1.);}
vec2 terrainLowRotate(vec2 p,float a){float c=cos(a),s=sin(a);return vec2(p.x*c-p.y*s,p.x*s+p.y*c);}
vec3 terrainLowState(vec3 position,vec3 worldNormal,vec3 base){vec2 p=position.xz;float h=position.y;float slope=1.-clamp(abs(normalize(worldNormal).y),0.,1.);vec2 wa=p+(vec2(terrainLowFbm(p/760.+vec2(4.1,-8.2)),terrainLowFbm(p/540.+vec2(-6.2,7.4)))-.5)*vec2(220.,180.);vec2 r=terrainLowRotate(wa,.62);float regional=terrainLowFbm(wa/2400.+vec2(7.2,-11.4));float broad=terrainLowFbm(wa/760.+vec2(-4.6,8.1));float macro=terrainLowFbm(wa/320.+vec2(12.2,4.7));float meso=terrainLowFbm(r/vec2(128.,390.)+vec2(8.7,-5.1));float bench=terrainLowFbm(r/vec2(410.,104.)+vec2(-12.3,19.4));float swale=terrainLowFbm(r/vec2(138.,520.)+vec2(6.9,-3.2));float aggregate=terrainLowRidge(r/vec2(18.,26.)+vec2(4.2,-11.7));float lag=terrainLowRidge(r/vec2(82.,246.)+vec2(21.6,-7.9));float fine=terrainLowNoise(r/18.+vec2(5.4,-18.2));float lowland=(1.-smoothstep(80.,170.,h))*(1.-smoothstep(.11,.28,slope));float moisture=clamp(.50+(.5-regional)*.18+(.5-broad)*.14+(.5-swale)*.06,0.,1.);float wetSwale=lowland*smoothstep(.48,.80,moisture)*smoothstep(.44,.82,swale);float dryBench=lowland*smoothstep(.48,.80,1.-moisture)*smoothstep(.46,.82,bench);float ribbon=lowland*(.35+macro*.65)*smoothstep(.46,.82,moisture)*smoothstep(.44,.80,swale);float mineral=lowland*lag*(.30+macro*.42+(1.-moisture)*.28);float snow=smoothstep(.58,.88,dot(base,vec3(.2126,.7152,.0722)))*(1.-smoothstep(.08,.24,max(base.r,max(base.g,base.b))-min(base.r,min(base.g,base.b))));float mask=(1.-snow);diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.065,.090,.052),wetSwale*.16*mask);diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.31,.26,.16),dryBench*.16*mask);diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.25,.23,.19),ribbon*.11*mask);diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.33,.32,.29),mineral*.10*mask);diffuseColor.rgb*=.94+(regional-.5)*.08+(broad-.5)*.07+(macro-.5)*.05+(meso-.5)*.025+(fine-.5)*.018;}
void terrainLowRoughness(){vec2 p=vTerrainLowWorldPosition.xz;float h=vTerrainLowWorldPosition.y;vec3 n=normalize(vTerrainLowWorldNormal);float slope=1.-clamp(abs(n.y),0.,1.);float meso=terrainLowFbm(p/128.+vec2(8.7,-5.1));float aggregate=terrainLowRidge(p/vec2(18.,26.)+vec2(4.2,-11.7));float lag=terrainLowRidge(p/vec2(82.,246.)+vec2(21.6,-7.9));float lowland=(1.-smoothstep(80.,170.,h))*(1.-smoothstep(.11,.28,slope));float wet=(1.-smoothstep(.45,.76,meso))*lowland;float dry=meso*lowland;roughnessFactor=clamp(roughnessFactor+aggregate*.055+lag*.065+dry*.035-wet*.048,0.42,1.0);}
void terrainLowNormal(){vec2 p=vTerrainLowWorldPosition.xz;float h=vTerrainLowWorldPosition.y;vec3 n=normalize(vTerrainLowWorldNormal);float slope=1.-clamp(abs(n.y),0.,1.);float lowland=(1.-smoothstep(80.,170.,h))*(1.-smoothstep(.11,.28,slope));float a=terrainLowNoise(p/9.+vec2(7.2,-4.6));float b=terrainLowNoise(p/9.+vec2(7.8,-4.1));float c=terrainLowRidge(p/38.+vec2(-12.7,8.4));vec2 g=vec2(b-a,c-.5);normal=normalize(normal+mat3(viewMatrix)*vec3(-g.x,0.,-g.y)*lowland*.075);}
`;

export function installTerrainLowlandFabric(material) {
	if (!material) throw new TypeError('terrain lowland fabric requires a material');
	const previousOnBeforeCompile = material.onBeforeCompile.bind(material);
	material.onBeforeCompile = (shader, renderer) => {
		previousOnBeforeCompile(shader, renderer);
		shader.vertexShader = shader.vertexShader
			.replace('#include <common>', '#include <common>\nvarying vec3 vTerrainLowWorldPosition;\nvarying vec3 vTerrainLowWorldNormal;')
			.replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nvTerrainLowWorldNormal=normalize(mat3(modelMatrix)*objectNormal);')
			.replace('#include <begin_vertex>', '#include <begin_vertex>\nvTerrainLowWorldPosition=(modelMatrix*vec4(transformed,1.0)).xyz;');
		shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\n${TERRAIN_LOWINLAND_GLSL}`);
		shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\nterrainLowState(vTerrainLowWorldPosition,vTerrainLowWorldNormal,diffuseColor.rgb);');
		shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nterrainLowRoughness();');
		shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nterrainLowNormal();');
	};
	const previousProgramKey = material.customProgramCacheKey?.bind(material);
	material.customProgramCacheKey = () => `${previousProgramKey ? previousProgramKey() : ''}|${TERRAIN_LOWINLAND_FABRIC_POLICY.id}`;
	material.userData = {
		...material.userData,
		terrainLowlandFabric: Object.freeze({
			policyId: TERRAIN_LOWINLAND_FABRIC_POLICY.id,
			canonicalHeightUnchanged: true,
			canonicalHydrologyUnchanged: true,
			canonicalColliderUnchanged: true,
			canonicalCoastlineUnchanged: true,
			newGeographyIntroduced: false,
			anisotropicSwales: true,
			depositionalRibbons: true,
			soilAggregateBreakup: true,
			mineralLagBreakup: true,
			lowlandMicroNormals: true,
			worldSpaceRoughnessVariation: true,
			vegetationEdgePolicyId: TERRAIN_VEGETATION_EDGE_POLICY.id,
			sedimentPolicyId: TERRAIN_SEDIMENT_POLICY.id,
		}),
	};
	installTerrainSediment(material);
	installTerrainVegetationEdge(material);
	return material;
}
