/**
 * Sea-level water: one large plane, fixed at `WORLD_DEFAULTS.WATER_LEVEL_METERS` and re-centered
 * on the camera's XZ position every frame (same technique `sky.js` uses for its skybox sphere) so
 * it always extends to the horizon without needing per-chunk geometry or a load/unload lifecycle.
 * See DECISIONS.md ADR-0005 for why this is one plane, not per-chunk water, and why `terrain.js`
 * needed no changes for lakes/coastline to appear.
 *
 * The surface never moves vertically — see DECISIONS.md ADR-0048. An earlier version displaced
 * vertices with real Gerstner waves (up to ~1m), which read fine over the deep sea but flickered
 * over shallow lakes (some only centimeters below `WORLD_DEFAULTS.WATER_LEVEL_METERS`): the wave
 * trough would dip below the lake bed and the crest would rise above it, so the shoreline's
 * terrain popped in and out of view every frame. Wave *motion* is now faked entirely in the
 * fragment shader (a shifting analytic bump normal drives the fresnel/specular look) — the plane's
 * geometry stays flat, so water can never geometrically part from the lake bed beneath it,
 * regardless of how shallow that lake is.
 *
 * Participates in `scene.fog` (`fog.js`) via three.js's `fog_pars_vertex`/`fog_vertex`/
 * `fog_pars_fragment`/`fog_fragment` chunks (`material.fog: true` alone does nothing for a custom
 * `ShaderMaterial` without these — see DECISIONS.md ADR-0007), so distant water now fades into the
 * horizon the same as terrain, instead of staying fully saturated.
 * @module world/water
 */

import * as THREE from 'three';

const WATER_VERTEX_SHADER = /* glsl */ `
	varying vec3 vWorldPosition;
	#include <fog_pars_vertex>

	void main() {
		vec3 worldPos = (modelMatrix * vec4(position, 1.0)).xyz;
		vWorldPosition = worldPos;
		vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
		gl_Position = projectionMatrix * mvPosition;
		#include <fog_vertex>
	}
`;

const WATER_FRAGMENT_SHADER = /* glsl */ `
	uniform float uTime;
	uniform vec3 uShallowColor;
	uniform vec3 uDeepColor;
	uniform vec3 uSunDirection;
	uniform vec3 uCameraPosition;
	varying vec3 vWorldPosition;
	#include <fog_pars_fragment>

	// Fakes moving-water shading without ever displacing the (flat) vertex grid: three sine ripples
	// at different direction/frequency/speed perturb an otherwise-flat-up normal, the same "tuned by
	// eye" spirit the old Gerstner waves used, just fragment-only so shallow water can never part
	// from the ground under it (DECISIONS.md ADR-0048).
	vec3 rippleNormal(vec2 worldXZ, float time) {
		float r1 = sin(dot(worldXZ, vec2(0.85, 0.51)) + time * 1.3);
		float r2 = sin(dot(worldXZ, vec2(-0.6, 0.9)) * 1.6 - time * 0.9);
		float r3 = sin(dot(worldXZ, vec2(0.25, -0.7)) * 2.4 + time * 1.8);
		vec2 slope = vec2(r1 + r2 * 0.6, r3 + r2 * 0.4) * 0.05;
		return normalize(vec3(slope.x, 1.0, slope.y));
	}

	void main() {
		vec3 normal = rippleNormal(vWorldPosition.xz, uTime);
		vec3 viewDir = normalize(uCameraPosition - vWorldPosition);

		// Fresnel-ish: nearer grazing angles read lighter/more reflective, straight-down reads deep.
		float fresnel = pow(1.0 - clamp(dot(normal, viewDir), 0.0, 1.0), 3.0);
		vec3 baseColor = mix(uDeepColor, uShallowColor, fresnel);

		vec3 halfVector = normalize(uSunDirection + viewDir);
		float specular = pow(clamp(dot(normal, halfVector), 0.0, 1.0), 80.0);

		gl_FragColor = vec4(baseColor + specular * 0.6, 0.9);
		#include <fog_fragment>
	}
`;

/** World-space extent of the water plane. Large enough that its edge never appears before the
 * camera's far clip plane/horizon does (`WORLD_DEFAULTS.FAR_PLANE`, camera.js `maxDistance`), but
 * far smaller than the full world size — see DECISIONS.md ADR-0005 for why a world-sized plane
 * would be wasted triangle budget. */
const WATER_PLANE_EXTENT_METERS = 4000;
/** Geometry resolution. Coarser than terrain (64/chunk) since Gerstner displacement reads fine
 * even at lower density — kept mobile-budget-conscious (see module doc / ADR-0005). */
const WATER_PLANE_SEGMENTS = 128;

const DEFAULT_SHALLOW_COLOR = new THREE.Color(0x6fd6c9);
const DEFAULT_DEEP_COLOR = new THREE.Color(0x0a3a4a);
/** Matches `game3d.js`'s directional "sun" light position, normalized — kept as a local constant
 * here (not `config.js`) since only this shader's specular highlight reads it today; promote it if
 * a second system needs the same direction. */
const SUN_DIRECTION = new THREE.Vector3(300, 400, 200).normalize();

/**
 * Builds the sea-level water plane. Caller must reposition it onto the camera every frame (via
 * `updateWater`) so it always extends toward the horizon regardless of where the viewer orbits to.
 * @param {number} waterLevelMeters World-space Y the plane sits at (`WORLD_DEFAULTS.WATER_LEVEL_METERS`).
 * @returns {THREE.Mesh}
 */
export function createWater(waterLevelMeters) {
	const geometry = new THREE.PlaneGeometry(
		WATER_PLANE_EXTENT_METERS,
		WATER_PLANE_EXTENT_METERS,
		WATER_PLANE_SEGMENTS,
		WATER_PLANE_SEGMENTS,
	);
	geometry.rotateX(-Math.PI / 2);

	const material = new THREE.ShaderMaterial({
		vertexShader: WATER_VERTEX_SHADER,
		fragmentShader: WATER_FRAGMENT_SHADER,
		// ShaderMaterial (unlike built-in materials) does not auto-merge UniformsLib.fog into its
		// uniforms — WebGLRenderer's refreshFogUniforms() would throw reading `.value` off a
		// missing `fogColor`/`fogDensity` uniform without this explicit merge.
		uniforms: THREE.UniformsUtils.merge([
			THREE.UniformsLib.fog,
			{
				uTime: { value: 0 },
				uShallowColor: { value: DEFAULT_SHALLOW_COLOR },
				uDeepColor: { value: DEFAULT_DEEP_COLOR },
				uSunDirection: { value: SUN_DIRECTION },
				uCameraPosition: { value: new THREE.Vector3() },
			},
		]),
		transparent: true,
		depthWrite: true,
		fog: true, // consumes scene.fog (fog.js) via the fog_* chunks included in both shaders above.
	});

	const mesh = new THREE.Mesh(geometry, material);
	mesh.position.y = waterLevelMeters;
	mesh.frustumCulled = false; // recentered on the camera every frame — always meant to be in view.
	return mesh;
}

/**
 * Re-centers the water plane's XZ on the camera (keeping its fixed sea-level Y), advances the
 * fragment-only ripple animation time, and updates the specular-highlight camera-position uniform.
 * Call once per frame.
 * @param {THREE.Mesh} waterMesh
 * @param {THREE.Vector3} cameraPosition
 * @param {number} elapsedSeconds
 */
export function updateWater(waterMesh, cameraPosition, elapsedSeconds) {
	waterMesh.position.x = cameraPosition.x;
	waterMesh.position.z = cameraPosition.z;
	waterMesh.material.uniforms.uTime.value = elapsedSeconds;
	waterMesh.material.uniforms.uCameraPosition.value.copy(cameraPosition);
}

/**
 * Disposes the water plane's geometry/material. Call on teardown — memory-leak checklist.
 * @param {THREE.Mesh} waterMesh
 */
export function disposeWater(waterMesh) {
	waterMesh.geometry.dispose();
	waterMesh.material.dispose();
}
