/**
 * World-space surface grain for every walkable surface: terrain chunks and the road network.
 *
 * **The defect this closes.** The ground already carried two detail layers — the owner's aerial
 * `overlay.png` stretched over the whole 9000x7000 map as a luminance multiplier, and
 * `world/terrainMicroSurface.js`'s procedural normal/roughness atlas repeating every 22 m. Neither is
 * visible from standing height. The overlay is one texel per few hundred metres at that scale, and a
 * 22 m period puts its smallest feature at roughly five metres across. So a close render of the ground
 * came back as flat, untextured colour, and that is what the owner has now called artificial three
 * times running ("Yine yapay kalmış").
 *
 * What was missing is the layer between them: grain you can read at 1-8 m, the scale a person walking
 * actually sees. This module adds it, and adds it from the owner's own asset rather than from noise —
 * `assets/models/fbx/dirt_road_test.glb` ships a 1024x1024 baked **normal** map whose verge region is
 * dense grass-clump relief, which is exactly the signal procedural value noise cannot fake. Two 128x128
 * tiles are cropped out of it (see `scripts/checkGroundSurfaceGrain.mjs` for the provenance assertions)
 * and sampled here in world XZ at two periods.
 *
 * **Why world XZ and not a UV channel.** Terrain already spends uv0 on the owner map and uv1 on the
 * 22 m micro atlas, and the road ribbon writes no `uv` at all — `scripts/checkRoadVisualContract.js`
 * pins that vertex layout. World XZ needs no attribute, is continuous across chunk and edge boundaries
 * by construction, and means 1.6 m is 1.6 m everywhere in the world.
 *
 * **Render-only.** Canonical height, coastline, hydrology, placement and collision are untouched; this
 * is a fragment-stage perturbation of the normal and a unit-mean multiply on the colour. Nothing here
 * is sampled by gameplay, and nothing here is random — the tiles are files and the periods are
 * constants, so two runs of the same frame are identical.
 *
 * @module world/groundSurfaceGrain
 */

import * as THREE from 'three';

/**
 * The one place the grain's scale and strength are decided. Consumers pass overrides for strength only:
 * a road is packed earth and takes less relief than pasture, but it must take it at the *same* period,
 * or the grain would visibly change size where a road crosses the ground it sits on.
 */
export const GROUND_SURFACE_GRAIN_POLICY = Object.freeze({
	id: 'ground-surface-grain-world-xz-v1',
	normalMapPath: 'assets/textures/ground/ground_grain_normal.png',
	albedoMapPath: 'assets/textures/ground/ground_grain_albedo.png',
	/** Close grain — the scale of clumps and clods underfoot. */
	finePeriodMeters: 1.6,
	/**
	 * Broad grain. Not a round multiple of the fine period: at 4x or 8x the two mirrored tilings line
	 * up and the eye reads a grid, which is the failure mode a single-period detail map always has.
	 */
	coarsePeriodMeters: 7.3,
	/**
	 * Gains, not blend weights, and sized from the tiles' measured contrast rather than guessed.
	 *
	 * Both tiles are high-pass crops, so what they carry is small: the normal tile's tangent channels
	 * have a standard deviation of about 18/255, which is +/-0.14 once decoded to a direction, and the
	 * albedo tile's is about 6/255, which is +/-0.05 around its unit mean. Applied at a weight of one
	 * that is a four-degree tilt and a two per cent colour swing — measurably present, visually nothing,
	 * which is exactly what the first render of this module showed. These gains put the fine grain at
	 * roughly a fifteen-degree tilt and the colour break-up at about +/-20 per cent, which is what real
	 * ground does between a dry clod and the damp soil beside it.
	 */
	fineNormalStrength: 1.8,
	coarseNormalStrength: 1.1,
	albedoStrength: 4.0,
	maxAnisotropy: 8,
	renderOnly: true,
});

let sharedGroundGrainTextures = null;

function configureGrainTexture(texture) {
	// Mirrored, not repeated. A crop out of a photograph has no matching opposite edges, and mirroring
	// makes any crop tile exactly — at this grain size the mirror line is not resolvable, whereas the
	// seam of a plain repeat is the first thing the eye finds.
	texture.wrapS = THREE.MirroredRepeatWrapping;
	texture.wrapT = THREE.MirroredRepeatWrapping;
	// Both tiles are data, not pictures: the normal map encodes a direction and the albedo tile encodes
	// a multiplier around a mid-grey pivot. An sRGB decode would bend both away from their neutral mean.
	texture.colorSpace = THREE.NoColorSpace;
	texture.anisotropy = GROUND_SURFACE_GRAIN_POLICY.maxAnisotropy;
	texture.needsUpdate = true;
	return texture;
}

/** Two app-lifetime tiles shared by every terrain chunk and by the road network. */
export function getGroundSurfaceGrainTextures() {
	if (sharedGroundGrainTextures) return sharedGroundGrainTextures;
	const loader = new THREE.TextureLoader();
	sharedGroundGrainTextures = Object.freeze({
		normalMap: configureGrainTexture(loader.load(GROUND_SURFACE_GRAIN_POLICY.normalMapPath)),
		albedoMap: configureGrainTexture(loader.load(GROUND_SURFACE_GRAIN_POLICY.albedoMapPath)),
	});
	return sharedGroundGrainTextures;
}

/** The uniform block both consumers merge into their shader. Strength is per-surface; scale is not. */
export function groundSurfaceGrainUniforms({
	fineNormalStrength = GROUND_SURFACE_GRAIN_POLICY.fineNormalStrength,
	coarseNormalStrength = GROUND_SURFACE_GRAIN_POLICY.coarseNormalStrength,
	albedoStrength = GROUND_SURFACE_GRAIN_POLICY.albedoStrength,
} = {}) {
	const { normalMap, albedoMap } = getGroundSurfaceGrainTextures();
	return {
		groundGrainNormalMap: { value: normalMap },
		groundGrainAlbedoMap: { value: albedoMap },
		groundGrainFinePeriod: { value: GROUND_SURFACE_GRAIN_POLICY.finePeriodMeters },
		groundGrainCoarsePeriod: { value: GROUND_SURFACE_GRAIN_POLICY.coarsePeriodMeters },
		groundGrainFineStrength: { value: fineNormalStrength },
		groundGrainCoarseStrength: { value: coarseNormalStrength },
		groundGrainAlbedoStrength: { value: albedoStrength },
	};
}

/** Fragment-stage declarations. Both consumers splice this in ahead of the two bodies below. */
export const GROUND_SURFACE_GRAIN_FRAGMENT_PARS = `
uniform sampler2D groundGrainNormalMap;
uniform sampler2D groundGrainAlbedoMap;
uniform float groundGrainFinePeriod;
uniform float groundGrainCoarsePeriod;
uniform float groundGrainFineStrength;
uniform float groundGrainCoarseStrength;
uniform float groundGrainAlbedoStrength;`;

/**
 * Perturbs the view-space `normal` by the grain, in a frame built from the world axes.
 *
 * Goes **after** `#include <normal_fragment_maps>`, so it layers on top of whatever normal map the
 * surface already has rather than replacing it — on terrain that is the 22 m macro atlas, and the two
 * together are the point: macro undulation with real grain sitting in it.
 *
 * The frame is world X and world Z brought into view space and Gram-Schmidt'd against the current
 * normal. Ground is near-horizontal, so the obvious choice — `cross(worldUp, normal)` — is exactly the
 * degenerate one; world X and Z stay well-conditioned for every slope terrain can produce, and the
 * length guard covers the vertical faces they would fail on.
 *
 * @param {string} worldXZ GLSL expression for this fragment's world XZ, in metres.
 * @returns {string} GLSL.
 */
export function groundSurfaceGrainNormalChunk(worldXZ) {
	return `
{
	vec2 grainXZ = ${worldXZ};
	vec3 grainFine = texture2D(groundGrainNormalMap, grainXZ / groundGrainFinePeriod).xyz * 2.0 - 1.0;
	vec3 grainCoarse = texture2D(groundGrainNormalMap, grainXZ / groundGrainCoarsePeriod).xyz * 2.0 - 1.0;
	vec2 grainSlope = grainFine.xy * groundGrainFineStrength + grainCoarse.xy * groundGrainCoarseStrength;
	vec3 grainAxisX = normalize((viewMatrix * vec4(1.0, 0.0, 0.0, 0.0)).xyz);
	vec3 grainAxisZ = normalize((viewMatrix * vec4(0.0, 0.0, 1.0, 0.0)).xyz);
	vec3 grainTangent = grainAxisX - normal * dot(normal, grainAxisX);
	float grainTangentLength = length(grainTangent);
	vec3 grainTangentUnit = grainTangent / max(grainTangentLength, 1e-4);
	vec3 grainBitangent = grainAxisZ - normal * dot(normal, grainAxisZ) - grainTangentUnit * dot(grainTangentUnit, grainAxisZ);
	float grainBitangentLength = length(grainBitangent);
	if (grainTangentLength > 1e-3 && grainBitangentLength > 1e-3) {
		vec3 grainBitangentUnit = grainBitangent / grainBitangentLength;
		normal = normalize(normal + grainTangentUnit * grainSlope.x + grainBitangentUnit * grainSlope.y);
	}
}`;
}

/**
 * Multiplies the grain's colour break-up into `diffuseColor`.
 *
 * The tile's mean is a mid-grey pivot, so `sample * 2` has a mean of one, and the gain is applied to
 * the *deviation* from that mean. However large the gain, the average multiplier stays one: this
 * **cannot** shift the ground's hue or overall brightness, so the biome pass keeps colour authority
 * exactly as `world/terrainBiomeShading.js` requires and all this adds is variation around it. The
 * clamp only catches a gain large enough to drive a dark texel negative.
 *
 * Sampled at the coarse period alone. Colour mottling on real ground is metres across; putting it at
 * the fine period would read as noise on the texture rather than as damp and dry patches in the soil.
 *
 * @param {string} worldXZ GLSL expression for this fragment's world XZ, in metres.
 * @returns {string} GLSL.
 */
export function groundSurfaceGrainColorChunk(worldXZ) {
	return `
{
	vec3 grainTint = texture2D(groundGrainAlbedoMap, (${worldXZ}) / groundGrainCoarsePeriod).rgb * 2.0;
	diffuseColor.rgb *= max(vec3(0.0), vec3(1.0) + (grainTint - vec3(1.0)) * groundGrainAlbedoStrength);
}`;
}

/**
 * Installs the grain on a material that has no `onBeforeCompile` of its own, deriving world XZ from a
 * varying this adds. Terrain uses this; the road network splices the chunks by hand instead, because it
 * already carries an `onBeforeCompile` chain and already has a world-position varying to reuse.
 *
 * @param {THREE.MeshStandardMaterial} material
 * @param {{fineNormalStrength?: number, coarseNormalStrength?: number, albedoStrength?: number}} [options]
 */
export function applyGroundSurfaceGrain(material, options = {}) {
	if (!material?.isMeshStandardMaterial) throw new TypeError('ground surface grain requires MeshStandardMaterial');
	const uniforms = groundSurfaceGrainUniforms(options);
	const previousOnBeforeCompile = material.onBeforeCompile?.bind(material);
	material.onBeforeCompile = (shader, renderer) => {
		if (previousOnBeforeCompile) previousOnBeforeCompile(shader, renderer);
		if (shader.uniforms) Object.assign(shader.uniforms, uniforms);
		shader.vertexShader = `varying vec3 vGroundGrainWorld;\n${shader.vertexShader}`.replace(
			'#include <begin_vertex>',
			`#include <begin_vertex>
	vGroundGrainWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
		);
		shader.fragmentShader = `varying vec3 vGroundGrainWorld;${GROUND_SURFACE_GRAIN_FRAGMENT_PARS}\n${shader.fragmentShader}`
			.replace(
				'#include <color_fragment>',
				`#include <color_fragment>${groundSurfaceGrainColorChunk('vGroundGrainWorld.xz')}`,
			)
			.replace(
				'#include <normal_fragment_maps>',
				`#include <normal_fragment_maps>${groundSurfaceGrainNormalChunk('vGroundGrainWorld.xz')}`,
			);
	};
	// A material whose program is patched must say so, or three.js hands every patched and unpatched
	// material the same compiled program from its cache and one of them renders as the other.
	const previousCacheKey = material.customProgramCacheKey?.bind(material);
	material.customProgramCacheKey = () => `${previousCacheKey ? previousCacheKey() : ''}|${GROUND_SURFACE_GRAIN_POLICY.id}`;
	material.userData.groundSurfaceGrain = Object.freeze({
		policyId: GROUND_SURFACE_GRAIN_POLICY.id,
		finePeriodMeters: GROUND_SURFACE_GRAIN_POLICY.finePeriodMeters,
		coarsePeriodMeters: GROUND_SURFACE_GRAIN_POLICY.coarsePeriodMeters,
		renderOnly: true,
	});
	material.needsUpdate = true;
	return material;
}
