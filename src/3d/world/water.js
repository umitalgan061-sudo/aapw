/**
 * Sea-level water: one large Gerstner-wave-shaded plane, fixed at `WORLD_DEFAULTS.WATER_LEVEL_METERS`
 * and re-centered on the camera's XZ position every frame (same technique `sky.js` uses for its
 * skybox sphere) so it always extends to the horizon without needing per-chunk geometry or a
 * load/unload lifecycle. See DECISIONS.md ADR-0005 for why this is one plane, not per-chunk water,
 * and why `terrain.js` needed no changes for lakes/coastline to appear.
 *
 * Participates in `scene.fog` (`fog.js`) via three.js's `fog_pars_vertex`/`fog_vertex`/
 * `fog_pars_fragment`/`fog_fragment` chunks (`material.fog: true` alone does nothing for a custom
 * `ShaderMaterial` without these — see DECISIONS.md ADR-0007), so distant water now fades into the
 * horizon the same as terrain, instead of staying fully saturated.
 * @module world/water
 */

import * as THREE from 'three';

const WATER_VERTEX_SHADER = /* glsl */ `
	uniform float uTime;
	varying vec3 vWorldPosition;
	varying vec3 vNormal;
	#include <fog_pars_vertex>

	// Classic Gerstner (trochoidal) wave: displaces position and accumulates tangent/binormal so a
	// real per-vertex normal can be derived, instead of faking it with a flat plane normal.
	vec3 gerstnerWave(vec4 wave, vec3 p, inout vec3 tangent, inout vec3 binormal) {
		float steepness = wave.z;
		float wavelength = wave.w;
		float k = 6.28318530718 / wavelength;
		float c = sqrt(9.8 / k);
		vec2 d = normalize(wave.xy);
		float f = k * (dot(d, p.xz) - c * uTime);
		float a = steepness / k;

		tangent += vec3(
			-d.x * d.x * steepness * sin(f),
			d.x * steepness * cos(f),
			-d.x * d.y * steepness * sin(f)
		);
		binormal += vec3(
			-d.x * d.y * steepness * sin(f),
			d.y * steepness * cos(f),
			-d.y * d.y * steepness * sin(f)
		);
		return vec3(d.x * a * cos(f), a * sin(f), d.y * a * cos(f));
	}

	void main() {
		vec3 gridPoint = position;
		vec3 tangent = vec3(1.0, 0.0, 0.0);
		vec3 binormal = vec3(0.0, 0.0, 1.0);
		vec3 displaced = gridPoint;
		// Three waves at different direction/wavelength/steepness — enough to read as "water", not
		// a single repeating ripple. Tuned by eye, not physically derived.
		displaced += gerstnerWave(vec4(1.0, 0.6, 0.18, 22.0), gridPoint, tangent, binormal);
		displaced += gerstnerWave(vec4(-0.7, 1.0, 0.12, 14.0), gridPoint, tangent, binormal);
		displaced += gerstnerWave(vec4(0.3, -0.8, 0.08, 9.0), gridPoint, tangent, binormal);

		vec3 worldPos = (modelMatrix * vec4(displaced, 1.0)).xyz;
		vWorldPosition = worldPos;
		vNormal = normalize(cross(binormal, tangent));

		vec4 mvPosition = modelViewMatrix * vec4(displaced, 1.0);
		gl_Position = projectionMatrix * mvPosition;
		#include <fog_vertex>
	}
`;

const WATER_FRAGMENT_SHADER = /* glsl */ `
	uniform vec3 uShallowColor;
	uniform vec3 uDeepColor;
	uniform vec3 uSunDirection;
	uniform vec3 uCameraPosition;
	varying vec3 vWorldPosition;
	varying vec3 vNormal;
	#include <fog_pars_fragment>

	void main() {
		vec3 normal = normalize(vNormal);
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
 * Re-centers the water plane's XZ on the camera (keeping its fixed sea-level Y), advances its
 * Gerstner animation time, and updates the specular-highlight camera-position uniform. Call once
 * per frame.
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
