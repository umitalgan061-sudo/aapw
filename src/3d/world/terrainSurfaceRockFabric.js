/**
 * World-space lithic fabric for ridges, cliffs and scree aprons.
 *
 * Render-only material detail. No vertex position, owner-map height, hydrology, coastline, route or
 * collider is modified. The field follows the already-rendered surface normal and elevation, then
 * overlays sparse bedding, fracture, mineral-lag and runoff stains at several physical scales.
 *
 * @module world/terrainSurfaceRockFabric
 */

const clamp01 = (value) => Math.max(0, Math.min(1, value));
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (a, b, value) => {
	const t = clamp01((value - a) / Math.max(1e-9, b - a));
	return t * t * (3 - 2 * t);
};

export const TERRAIN_ROCK_FABRIC_POLICY = Object.freeze({
	id: 'terrain-surface-rock-fabric-2026-09-14-v1',
	renderOnly: true,
	deterministic: true,
	canonicalHeightUnchanged: true,
	canonicalHydrologyUnchanged: true,
	canonicalCoastlineUnchanged: true,
	canonicalColliderUnchanged: true,
	newGeographyIntroduced: false,
	macroScaleMeters: 620,
	beddingScaleMeters: 185,
	fractureScaleMeters: 74,
	chipScaleMeters: 21,
	runoffScaleMeters: 112,
	screeScaleMeters: 58,
	cliffThresholdDegrees: 26,
	rockThresholdDegrees: 18,
	screeThresholdDegrees: 31,
	weatheringHeightMeters: 180,
	albedoVariation: 0.17,
	normalEnergy: 0.115,
	roughnessEnergy: 0.095,
});

function hash2D(ix, iy, seed) {
	let value = Math.imul((ix | 0) ^ seed, 0x27d4eb2d) ^ Math.imul((iy | 0) + seed, 0x165667b1);
	value ^= value >>> 15;
	value = Math.imul(value, 0x85ebca6b);
	value ^= value >>> 13;
	return (value >>> 0) / 4294967296;
}

function noise2D(x, y, seed) {
	const ix = Math.floor(x);
	const iy = Math.floor(y);
	const fx = x - ix;
	const fy = y - iy;
	const ux = fx * fx * (3 - 2 * fx);
	const uy = fy * fy * (3 - 2 * fy);
	const a = hash2D(ix, iy, seed);
	const b = hash2D(ix + 1, iy, seed);
	const c = hash2D(ix, iy + 1, seed);
	const d = hash2D(ix + 1, iy + 1, seed);
	return lerp(lerp(a, b, ux), lerp(c, d, ux), uy);
}

function fbm2D(x, y, seed, octaves = 4) {
	let total = 0;
	let weight = 0;
	let amplitude = 0.55;
	for (let octave = 0; octave < octaves; octave += 1) {
		total += noise2D(x, y, seed + octave * 113) * amplitude;
		weight += amplitude;
		x = x * 2.03 + 13.7;
		y = y * 2.03 - 8.4;
		amplitude *= 0.48;
	}
	return total / weight;
}

function ridge2D(x, y, seed) {
	return 1 - Math.abs(fbm2D(x, y, seed) * 2 - 1);
}

function rotated(x, y, radians) {
	const c = Math.cos(radians);
	const s = Math.sin(radians);
	return { x: x * c - y * s, y: x * s + y * c };
}

function fractureField(worldX, worldZ) {
	const p = rotated(worldX, worldZ, 0.49);
	const macro = fbm2D(worldX / 740, worldZ / 740, 0x4aa2, 4) - 0.5;
	const u = p.x / 92 + macro * 0.64;
	const v = p.y / 210 - macro * 0.43;
	const primary = Math.abs(fbm2D(u, v, 0x91bc, 4) - fbm2D(u + 0.13, v - 0.07, 0x91bc, 4));
	const cross = Math.abs(fbm2D(v, u, 0x1d72, 3) - fbm2D(v - 0.09, u + 0.17, 0x1d72, 3));
	return clamp01(smoothstep(0.035, 0.125, primary) * 0.80 + smoothstep(0.052, 0.155, cross) * 0.20);
}

function beddingField(worldX, worldZ, elevation) {
	const p = rotated(worldX, worldZ, -0.31);
	const carrier = fbm2D(worldX / 560, worldZ / 560, 0x72d4, 4) - 0.5;
	const strata = 0.5 + 0.5 * Math.sin(p.y / 185 + carrier * 3.4 + elevation * 0.0018);
	const breakup = fbm2D(p.x / 92, p.y / 72, 0x5ab3, 3);
	return clamp01(strata * 0.72 + breakup * 0.28);
}

function runoffField(worldX, worldZ) {
	const p = rotated(worldX, worldZ, 0.81);
	const macro = fbm2D(worldX / 430, worldZ / 430, 0xa103, 4);
	const gully = ridge2D(p.x / 112 + macro * 0.42, p.y / 34 - macro * 0.18, 0x87b1);
	return clamp01(gully * 0.72 + macro * 0.28);
}

function screeField(worldX, worldZ) {
	const p = rotated(worldX, worldZ, 0.21);
	const broad = fbm2D(worldX / 320, worldZ / 320, 0x417c, 4);
	const chips = ridge2D(p.x / 58, p.y / 34, 0x5c29);
	const grain = noise2D(p.x / 21, p.y / 21, 0x92a7);
	return clamp01(broad * 0.38 + chips * 0.44 + grain * 0.18);
}

export function resolveTerrainRockFabric({ worldX, worldZ, heightMeters = 0, slopeDegrees = 0, moisture = 0.5, northness = 0 }) {
	const slope = clamp01(slopeDegrees / 60);
	const rockExposure = smoothstep(TERRAIN_ROCK_FABRIC_POLICY.rockThresholdDegrees, 44, slopeDegrees);
	const cliff = smoothstep(TERRAIN_ROCK_FABRIC_POLICY.cliffThresholdDegrees, 52, slopeDegrees);
	const scree = smoothstep(TERRAIN_ROCK_FABRIC_POLICY.screeThresholdDegrees, 55, slopeDegrees) * (1 - cliff * 0.34);
	const heightWeathering = smoothstep(110, TERRAIN_ROCK_FABRIC_POLICY.weatheringHeightMeters + 260, heightMeters);
	const fractures = fractureField(worldX, worldZ);
	const bedding = beddingField(worldX, worldZ, heightMeters);
	const runoff = runoffField(worldX, worldZ);
	const screeNoise = screeField(worldX, worldZ);
	const damp = clamp01(moisture * 0.82 + (1 - northness) * 0.05);
	const exposed = clamp01(rockExposure * (1 - damp * 0.10));
	const runoffStain = clamp01(cliff * runoff * (0.45 + damp * 0.55));
	const fractureExposure = clamp01(fractures * exposed * (0.42 + heightWeathering * 0.58));
	const screeCoverage = clamp01(scree * screeNoise * (0.42 + (1 - damp) * 0.58));
	return Object.freeze({
		slope,
		rockExposure,
		cliff,
		scree,
		heightWeathering,
		fractures,
		bedding,
		runoff,
		screeNoise,
		damp,
		exposed,
		runoffStain,
		fractureExposure,
		screeCoverage,
	});
}

export function resolveRockMaterialResponse({ fabric, baseColor }) {
	const darkening = fabric.runoffStain * 0.075 + fabric.fractureExposure * 0.028 + fabric.damp * fabric.exposed * 0.018;
	const mineralLift = (fabric.bedding - 0.5) * 0.065 + (fabric.screeNoise - 0.5) * 0.045;
	const chip = fabric.screeCoverage * 0.11;
	const color = {
		r: clamp01(baseColor.r * (1 - darkening + mineralLift + chip * 0.22)),
		g: clamp01(baseColor.g * (1 - darkening * 0.92 + mineralLift * 0.62 + chip * 0.17)),
		b: clamp01(baseColor.b * (1 - darkening * 0.72 + mineralLift * 0.54 + chip * 0.12)),
	};
	const roughness = clamp01(0.70 + fabric.fractureExposure * 0.12 + fabric.screeCoverage * 0.15 + fabric.heightWeathering * 0.035 - fabric.damp * fabric.runoffStain * 0.075);
	const normalStrength = clamp01(fabric.fractureExposure * 0.50 + fabric.cliff * 0.24 + fabric.screeCoverage * 0.42) * TERRAIN_ROCK_FABRIC_POLICY.normalEnergy;
	return Object.freeze({ color: Object.freeze(color), roughness, normalStrength });
}

export const TERRAIN_ROCK_FABRIC_GLSL = String.raw`
float terrainRockHash(vec2 p){vec3 q=fract(vec3(p.xyx)*vec3(.1031,.1030,.0973));q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}
float terrainRockNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);float a=terrainRockHash(i),b=terrainRockHash(i+vec2(1,0)),c=terrainRockHash(i+vec2(0,1)),d=terrainRockHash(i+vec2(1,1));return mix(mix(a,b,f.x),mix(c,d,f.x),f.y);}
float terrainRockFbm(vec2 p){float v=0.,w=0.,a=.55;for(int i=0;i<4;i++){v+=terrainRockNoise(p)*a;w+=a;p=p*2.03+vec2(13.7,-8.4);a*=.48;}return v/w;}
float terrainRockRidge(vec2 p){return 1.-abs(terrainRockFbm(p)*2.-1.);}
vec2 terrainRockRotate(vec2 p,float a){float c=cos(a),s=sin(a);return vec2(p.x*c-p.y*s,p.x*s+p.y*c);}
float terrainRockFracture(vec2 p){vec2 r=terrainRockRotate(p,.49);float macro=terrainRockFbm(p/740.+vec2(4.4,-3.7))-.5;vec2 q=r/vec2(92.,210.)+vec2(macro*.64,-macro*.43);float primary=abs(terrainRockFbm(q+vec2(.13,-.07))-terrainRockFbm(q));float cross=abs(terrainRockFbm(q.yx+vec2(-.09,.17))-terrainRockFbm(q.yx));return clamp(smoothstep(.035,.125,primary)*.80+smoothstep(.052,.155,cross)*.20,0.,1.);}
float terrainRockBedding(vec2 p,float height){vec2 r=terrainRockRotate(p,-.31);float carrier=terrainRockFbm(p/560.+vec2(7.2,-11.4))-.5;float strata=.5+.5*sin(r.y/185.+carrier*3.4+height*.0018);float breakup=terrainRockFbm(r/vec2(92.,72.)+vec2(5.2,-4.6));return clamp(strata*.72+breakup*.28,0.,1.);}
float terrainRockRunoff(vec2 p){vec2 r=terrainRockRotate(p,.81);float macro=terrainRockFbm(p/430.+vec2(8.1,-2.2));float gully=terrainRockRidge(vec2(r.x/112.+macro*.42,r.y/34.-macro*.18)+vec2(-3.2,9.1));return clamp(gully*.72+macro*.28,0.,1.);}
float terrainRockScree(vec2 p){vec2 r=terrainRockRotate(p,.21);float broad=terrainRockFbm(p/320.+vec2(4.6,8.1));float chips=terrainRockRidge(vec2(r.x/58.,r.y/34.)+vec2(5.1,-6.3));float grain=terrainRockNoise(r/21.+vec2(-3.2,12.6));return clamp(broad*.38+chips*.44+grain*.18,0.,1.);}
void terrainRockApplyColor(){vec2 p=vTerrainRockWorldPosition.xz;float h=vTerrainRockWorldPosition.y;vec3 n=normalize(vTerrainRockWorldNormal);float slope=1.-clamp(abs(n.y),0.,1.);float rockExposure=smoothstep(.30,.73,slope);float cliff=smoothstep(.43,.79,slope);float scree=smoothstep(.48,.86,slope)*(1.-cliff*.34);float heightWeathering=smoothstep(110.,440.,h);float fractures=terrainRockFracture(p);float bedding=terrainRockBedding(p,h);float runoff=terrainRockRunoff(p);float screeNoise=terrainRockScree(p);float baseLuma=dot(diffuseColor.rgb,vec3(.2126,.7152,.0722));float chroma=max(diffuseColor.r,max(diffuseColor.g,diffuseColor.b))-min(diffuseColor.r,min(diffuseColor.g,diffuseColor.b));float vegetation=smoothstep(.004,.085,diffuseColor.g-max(diffuseColor.r,diffuseColor.b));float snow=smoothstep(.58,.88,baseLuma)*(1.-smoothstep(.08,.24,chroma));float rockMask=(1.-vegetation*.62)*(1.-snow);float damp=.52+(0.5-terrainRockFbm(p/780.+vec2(3.1,-7.7)))*.34;float runoffStain=clamp(cliff*runoff*(.45+damp*.55),0.,1.);float fractureExposure=clamp(fractures*rockExposure*(.42+heightWeathering*.58),0.,1.);float screeCoverage=clamp(scree*screeNoise*(.42+(1.-damp)*.58),0.,1.);float darkening=runoffStain*.075+fractureExposure*.028+damp*rockExposure*.018;float mineralLift=(bedding-.5)*.065+(screeNoise-.5)*.045;float chip=screeCoverage*.11;diffuseColor.rgb*=1.-darkening*rockMask;diffuseColor.rgb+=vec3(.012,.010,.008)*mineralLift*rockMask;diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.36,.36,.34),chip*.12*rockMask);diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.115,.125,.120),runoffStain*.11*rockMask);diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.31,.30,.27),fractureExposure*.075*rockMask);}
void terrainRockApplyRoughness(){vec2 p=vTerrainRockWorldPosition.xz;float h=vTerrainRockWorldPosition.y;vec3 n=normalize(vTerrainRockWorldNormal);float slope=1.-clamp(abs(n.y),0.,1.);float snow=smoothstep(.58,.88,dot(diffuseColor.rgb,vec3(.2126,.7152,.0722)));float damp=.52+(0.5-terrainRockFbm(p/780.+vec2(3.1,-7.7)))*.34;float fractures=terrainRockFracture(p);float runoff=terrainRockRunoff(p);float scree=terrainRockScree(p);float rough=fractures*.055+scree*.075+smoothstep(110.,440.,h)*.035+smoothstep(.35,.78,slope)*.045;roughnessFactor=clamp(roughnessFactor+rough-runoff*.065*damp+snow*.035,0.42,1.0);}
void terrainRockApplyNormal(){vec2 p=vTerrainRockWorldPosition.xz;float h=vTerrainRockWorldPosition.y;vec3 n=normalize(vTerrainRockWorldNormal);float slope=1.-clamp(abs(n.y),0.,1.);float fractures=terrainRockFracture(p);float bedding=terrainRockBedding(p,h);float runoff=terrainRockRunoff(p);float scree=terrainRockScree(p);float gx=terrainRockNoise(p/20.+vec2(4.3,-2.7));float gy=terrainRockNoise(p/20.+vec2(4.9,-2.1));vec2 gradient=vec2(gy-gx,bedding-.5+runoff*.22);float mask=(fractures*.62+scree*.34+bedding*.18+smoothstep(.38,.78,slope)*.22);normal=normalize(normal+mat3(viewMatrix)*vec3(-gradient.x,0.,-gradient.y)*mask*.11);}
`;

export function installTerrainRockFabric(material) {
	if (!material) throw new TypeError('terrain rock fabric requires a material');
	const previousOnBeforeCompile = material.onBeforeCompile.bind(material);
	material.onBeforeCompile = (shader, renderer) => {
		previousOnBeforeCompile(shader, renderer);
		shader.vertexShader = shader.vertexShader
			.replace('#include <common>', '#include <common>\nvarying vec3 vTerrainRockWorldPosition;\nvarying vec3 vTerrainRockWorldNormal;')
			.replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nvTerrainRockWorldNormal=normalize(mat3(modelMatrix)*objectNormal);')
			.replace('#include <begin_vertex>', '#include <begin_vertex>\nvTerrainRockWorldPosition=(modelMatrix*vec4(transformed,1.0)).xyz;');
		shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\n${TERRAIN_ROCK_FABRIC_GLSL}`);
		shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\nterrainRockApplyColor();');
		shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nterrainRockApplyRoughness();');
		shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nterrainRockApplyNormal();');
	};
	const previousProgramKey = material.customProgramCacheKey?.bind(material);
	material.customProgramCacheKey = () => `${previousProgramKey ? previousProgramKey() : ''}|${TERRAIN_ROCK_FABRIC_POLICY.id}`;
	material.userData = {
		...material.userData,
		terrainRockFabric: Object.freeze({
			policyId: TERRAIN_ROCK_FABRIC_POLICY.id,
			canonicalHeightUnchanged: true,
			canonicalHydrologyUnchanged: true,
			canonicalColliderUnchanged: true,
			canonicalCoastlineUnchanged: true,
			newGeographyIntroduced: false,
			bedding: true,
			fractures: true,
			runoffStains: true,
			screeAprons: true,
			worldSpaceAlbedo: true,
			worldSpaceNormal: true,
			worldSpaceRoughness: true,
		}),
	};
	return material;
}
