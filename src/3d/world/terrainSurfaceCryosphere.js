/**
 * Deterministic cryosphere surface response for high terrain and permanent-ice zones.
 *
 * Material-only pass. It does not create The Wall, glaciers, ice caves, snowbanks or any new
 * geometry; it only makes already-authored snow/ice surfaces read as wind-packed, crusted,
 * scoured or substrate-exposed rather than uniformly bright white.
 *
 * @module world/terrainSurfaceCryosphere
 */

const clamp01 = (value) => Math.max(0, Math.min(1, value));
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (a, b, value) => {
	const t = clamp01((value - a) / Math.max(1e-9, b - a));
	return t * t * (3 - 2 * t);
};

export const TERRAIN_CRYOSPHERE_POLICY = Object.freeze({
	id: 'terrain-surface-cryosphere-2026-09-14-v1-wind-crust-scour',
	renderOnly: true,
	deterministic: true,
	canonicalHeightUnchanged: true,
	canonicalHydrologyUnchanged: true,
	canonicalIceGeometryUnchanged: true,
	canonicalColliderUnchanged: true,
	newGeographyIntroduced: false,
	windBearingRadians: -0.58,
	broadScaleMeters: 820,
	sastrugiScaleMeters: 34,
	crustScaleMeters: 11,	grainScaleMeters: 2.6,
	scourSlopeDegrees: Object.freeze([18, 44]),
	depositionSlopeDegrees: Object.freeze([2, 16]),
	freezeLineMeters: Object.freeze([150, 390, 580]),
	northExposureBias: 0.18,
	albedoEnergy: 0.12,
	normalEnergy: 0.10,
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

function fbm(x, z, seed) {
	let total = 0;
	let weight = 0;
	let amp = 0.54;
	for (let i = 0; i < 4; i += 1) {
		total += noise2D(x, z, seed + i * 73) * amp;
		weight += amp;
		x = x * 2.03 + 11.2;
		z = z * 2.03 - 7.9;
		amp *= 0.48;
	}
	return total / weight;
}

function rotate(x, z, radians) {
	const c = Math.cos(radians);
	const s = Math.sin(radians);
	return { x: x * c - z * s, z: x * s + z * c };
}

export function resolveTerrainCryosphere({
	worldX,
	worldZ,
	heightMeters,
	slopeDegrees = 0,
	northness = 0,
	snowSignal = 0,
}) {
	const broad = fbm(worldX / TERRAIN_CRYOSPHERE_POLICY.broadScaleMeters, worldZ / TERRAIN_CRYOSPHERE_POLICY.broadScaleMeters, 0x4f19);
	const wind = rotate(worldX, worldZ, TERRAIN_CRYOSPHERE_POLICY.windBearingRadians);
	const sastrugi = fbm(wind.x / TERRAIN_CRYOSPHERE_POLICY.sastrugiScaleMeters, wind.z / TERRAIN_CRYOSPHERE_POLICY.sastrugiScaleMeters, 0x71b2);
	const crust = noise2D(worldX / TERRAIN_CRYOSPHERE_POLICY.crustScaleMeters, worldZ / TERRAIN_CRYOSPHERE_POLICY.crustScaleMeters, 0x18a4);
	const grain = noise2D(worldX / TERRAIN_CRYOSPHERE_POLICY.grainScaleMeters, worldZ / TERRAIN_CRYOSPHERE_POLICY.grainScaleMeters, 0x29c7);
	const elevationSnow = smoothstep(150, 580, heightMeters);
	const northBias = clamp01(0.50 + northness * TERRAIN_CRYOSPHERE_POLICY.northExposureBias);
	const snow = clamp01(Math.max(snowSignal, elevationSnow * (0.58 + broad * 0.24 + northBias * 0.18)));
	const scour = snow * smoothstep(TERRAIN_CRYOSPHERE_POLICY.scourSlopeDegrees[0], TERRAIN_CRYOSPHERE_POLICY.scourSlopeDegrees[1], slopeDegrees) * smoothstep(0.42, 0.82, sastrugi);
	const deposition = snow * (1 - smoothstep(TERRAIN_CRYOSPHERE_POLICY.depositionSlopeDegrees[0], TERRAIN_CRYOSPHERE_POLICY.depositionSlopeDegrees[1], slopeDegrees)) * (0.34 + (1 - broad) * 0.66);
	const crustMask = snow * (0.46 + crust * 0.34 + sastrugi * 0.20);
	const granular = snow * (0.48 + grain * 0.52);
	const exposedSubstrate = clamp01(scour * 0.72 + (1 - snow) * 0.05);
	const shadowCold = clamp01((1 - northness) * 0.42 + (1 - broad) * 0.18);
	return Object.freeze({
		broad,
		sastrugi,
		crust,
		grain,
		snow,
		scour,
		deposition,
		crustMask,
		granular,
		exposedSubstrate,
		shadowCold,
	});
}

export function resolveCryosphereMaterialResponse({ state, baseColor }) {
	const warmth = state.broad * 0.07 + state.grain * 0.035;
	const cold = state.shadowCold * 0.06;
	const scourLift = state.scour * 0.055;
	const depositionSoft = state.deposition * 0.04;
	const color = {
		r: clamp01(baseColor.r + warmth * 0.12 - cold - scourLift * 0.16),
		g: clamp01(baseColor.g + warmth * 0.10 - cold * 0.62 - scourLift * 0.10),
		b: clamp01(baseColor.b + warmth * 0.06 + cold * 0.18 - depositionSoft * 0.08),
	};
	const roughness = clamp01(0.72 + state.crustMask * 0.12 + state.scour * 0.07 + state.granular * 0.04 - state.deposition * 0.045);
	const normalStrength = clamp01(state.sastrugi * 0.46 + state.crustMask * 0.32 + state.granular * 0.22) * TERRAIN_CRYOSPHERE_POLICY.normalEnergy;
	return Object.freeze({ color: Object.freeze(color), roughness, normalStrength });
}

export const TERRAIN_CRYOSPHERE_GLSL = String.raw`
float terrainCryoHash(vec2 p){vec3 q=fract(vec3(p.xyx)*vec3(.1031,.1030,.0973));q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}
float terrainCryoNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);float a=terrainCryoHash(i),b=terrainCryoHash(i+vec2(1,0)),c=terrainCryoHash(i+vec2(0,1)),d=terrainCryoHash(i+vec2(1,1));return mix(mix(a,b,f.x),mix(c,d,f.x),f.y);}
float terrainCryoFbm(vec2 p){float v=0.,w=0.,a=.54;for(int i=0;i<4;i++){v+=terrainCryoNoise(p)*a;w+=a;p=p*2.03+vec2(11.2,-7.9);a*=.48;}return v/w;}
vec2 terrainCryoRotate(vec2 p,float a){float c=cos(a),s=sin(a);return vec2(p.x*c-p.y*s,p.x*s+p.y*c);}
vec3 terrainCryoState(vec3 position,vec3 worldNormal,vec3 base){vec2 p=position.xz;float h=position.y;float slope=1.-clamp(abs(normalize(worldNormal).y),0.,1.);vec2 wind=terrainCryoRotate(p,-.58);float broad=terrainCryoFbm(p/820.+vec2(4.7,-3.1));float sastrugi=terrainCryoFbm(wind/34.+vec2(7.1,2.8));float crust=terrainCryoNoise(p/11.+vec2(-12.4,6.9));float grain=terrainCryoNoise(p/2.6+vec2(37.4,-12.8));float luma=dot(base,vec3(.2126,.7152,.0722));float chroma=max(base.r,max(base.g,base.b))-min(base.r,min(base.g,base.b));float snow=smoothstep(.58,.88,luma)*(1.-smoothstep(.08,.24,chroma));float elevationSnow=smoothstep(150.,580.,h);snow=max(snow,elevationSnow*(.58+broad*.24+.18));float scour=snow*smoothstep(.20,.49,slope)*smoothstep(.42,.82,sastrugi);float deposition=snow*(1.-smoothstep(.035,.18,slope))*(.34+(1.-broad)*.66);float crustMask=snow*(.46+crust*.34+sastrugi*.20);float granular=snow*(.48+grain*.52);float shadowCold=(1.-normalize(worldNormal).y)*.18+(1.-broad)*.18;return vec3(clamp(scour,0.,1.),clamp(deposition,0.,1.),clamp(crustMask+granular*.22,0.,1.));}
void terrainCryoApplyColor(){vec2 p=vTerrainCryoWorldPosition.xz;vec3 n=normalize(vTerrainCryoWorldNormal);float h=vTerrainCryoWorldPosition.y;vec3 base=diffuseColor.rgb;float luma=dot(base,vec3(.2126,.7152,.0722));float chroma=max(base.r,max(base.g,base.b))-min(base.r,min(base.g,base.b));float snow=smoothstep(.58,.88,luma)*(1.-smoothstep(.08,.24,chroma));vec3 state=terrainCryoState(vTerrainCryoWorldPosition,vTerrainCryoWorldNormal,base);float broad=terrainCryoFbm(p/820.+vec2(4.7,-3.1));float grain=terrainCryoNoise(p/2.6+vec2(37.4,-12.8));vec3 cold=vec3(.64,.69,.72);vec3 sun=vec3(.79,.80,.80);vec3 tone=mix(cold,sun,broad*.62+grain*.38);float snowTone=snow*clamp(.32+state.z*.44+state.y*.24,0.,1.);diffuseColor.rgb=mix(diffuseColor.rgb,tone,snowTone*.18);float exposed=state.x*(1.-snow);diffuseColor.rgb=mix(diffuseColor.rgb,base,exposed*.35);}
void terrainCryoApplyRoughness(){vec2 p=vTerrainCryoWorldPosition.xz;vec3 n=normalize(vTerrainCryoWorldNormal);float h=vTerrainCryoWorldPosition.y;vec3 state=terrainCryoState(vTerrainCryoWorldPosition,vTerrainCryoWorldNormal,diffuseColor.rgb);float grain=terrainCryoNoise(p/2.6+vec2(37.4,-12.8));float relief=terrainCryoFbm(p/34.+vec2(7.1,2.8));roughnessFactor=clamp(roughnessFactor+state.z*.09+grain*.035+relief*.04-state.y*.045+smoothstep(160.,560.,h)*.025,0.42,1.0);}
void terrainCryoApplyNormal(){vec2 p=vTerrainCryoWorldPosition.xz;vec3 state=terrainCryoState(vTerrainCryoWorldPosition,vTerrainCryoWorldNormal,diffuseColor.rgb);float a=terrainCryoNoise(p/2.6+vec2(37.4,-12.8));float b=terrainCryoNoise(p/2.6+vec2(38.2,-12.2));float c=terrainCryoFbm(p/34.+vec2(7.1,2.8));vec2 g=vec2(b-a,c-.5);normal=normalize(normal+mat3(viewMatrix)*vec3(-g.x,0.,-g.y)*(.045+state.x*.055+state.z*.035));}
`;

export function installTerrainCryosphere(material) {
	if (!material) throw new TypeError('terrain cryosphere requires a material');
	const previousOnBeforeCompile = material.onBeforeCompile.bind(material);
	material.onBeforeCompile = (shader, renderer) => {
		previousOnBeforeCompile(shader, renderer);
		shader.vertexShader = shader.vertexShader
			.replace('#include <common>', '#include <common>\nvarying vec3 vTerrainCryoWorldPosition;\nvarying vec3 vTerrainCryoWorldNormal;')
			.replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nvTerrainCryoWorldNormal=normalize(mat3(modelMatrix)*objectNormal);')
			.replace('#include <begin_vertex>', '#include <begin_vertex>\nvTerrainCryoWorldPosition=(modelMatrix*vec4(transformed,1.0)).xyz;');
		shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\n${TERRAIN_CRYOSPHERE_GLSL}`);
		shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\nterrainCryoApplyColor();');
		shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nterrainCryoApplyRoughness();');
		shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nterrainCryoApplyNormal();');
	};
	const previousProgramKey = material.customProgramCacheKey?.bind(material);
	material.customProgramCacheKey = () => `${previousProgramKey ? previousProgramKey() : ''}|${TERRAIN_CRYOSPHERE_POLICY.id}`;
	material.userData = {
		...material.userData,
		terrainCryosphere: Object.freeze({
			policyId: TERRAIN_CRYOSPHERE_POLICY.id,
			canonicalHeightUnchanged: true,
			canonicalHydrologyUnchanged: true,
			canonicalIceGeometryUnchanged: true,
			canonicalColliderUnchanged: true,
			newGeographyIntroduced: false,
			windPackedSnow: true,
			sastrugi: true,
			snowCrust: true,
			granularSnowAlbedo: true,
			snowMicroNormal: true,
			snowRoughnessVariation: true,
			scouredSubstrate: true,
			depositionVsScour: true,
		}),
	};
	return material;
}
