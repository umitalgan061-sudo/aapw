/**
 * Sea-level water: one large plane, fixed at `WORLD_DEFAULTS.WATER_LEVEL_METERS` and re-centered
 * on the camera's XZ position every frame (same technique `sky.js` uses for its skybox sphere) so
 * it always extends to the horizon without needing per-chunk geometry or a load/unload lifecycle.
 * See DECISIONS.md ADR-0005 for why this is one plane, not per-chunk water, and why `terrain.js`
 * needed no changes for lakes/coastline to appear.
 *
 * **Wave history — read this before touching the displacement.** The first version displaced
 * vertices with real Gerstner waves at a *constant* ~1m amplitude. That read fine over deep sea but
 * flickered over shallow lakes (some only centimetres below `WORLD_DEFAULTS.WATER_LEVEL_METERS`):
 * the trough dipped below the lake bed and the crest rose above it, so the shoreline's terrain
 * popped in and out every frame. DECISIONS.md ADR-0048 responded by deleting the displacement
 * outright and faking all wave motion in the fragment shader — no flicker, but also a dead-flat
 * surface with no actual undulation.
 *
 * This module now displaces geometry again, but with the amplitude **scaled by local water depth**
 * (`world/waterDepthField.js`). Because `WAVE_TOTAL_AMPLITUDE_METERS < FULL_WAVE_DEPTH_METERS` and
 * the scale factor is `min(1, depth / FULL_WAVE_DEPTH_METERS)`, the trough is provably always
 * shallower than the water column itself — the surface can never part from the bed at any depth,
 * which is the property ADR-0048 could not get from a constant amplitude. See
 * `world/waterDepthField.js`'s doc comment for the inequality and
 * `scripts/checkRun325WaterSwell.js` for the assertion that guards it.
 *
 * Fine chop is still fragment-only (`rippleSlope`) — it is far below the geometry's resolution, so
 * there is nothing to gain from vertices there. Geometry carries the long swell, the shader carries
 * the detail. The depth texture's green channel is also consumed as canonical water coverage so
 * the full-world plane cannot tint dry terrain cyan; the mask comes from the exact same terrain
 * sampler as bathymetry rather than a second coastline approximation.
 *
 * Participates in `scene.fog` (`fog.js`) via three.js's `fog_pars_vertex`/`fog_vertex`/
 * `fog_pars_fragment`/`fog_fragment` chunks (`material.fog: true` alone does nothing for a custom
 * `ShaderMaterial` without these — see DECISIONS.md ADR-0007), so distant water now fades into the
 * horizon the same as terrain, instead of staying fully saturated.
 * @module world/water
 */

import * as THREE from 'three';
import { FULL_OPTICAL_DEPTH_METERS } from './waterDepthField.js';

/**
 * The three swell components, longest first: `[wavelengthMeters, amplitudeMeters, dirX, dirZ]`.
 * Directions need not be unit length — the shader normalizes them.
 *
 * Wavelengths are chosen against the plane's own quad size so the displaced surface stays smooth
 * instead of aliasing into a sawtooth: the shortest component (75m) spans 6 quads at the desktop
 * segment count and ~3.6 at the mobile one (see `createWater`'s `segments` parameter) — and it is
 * also the smallest-amplitude of the three, so the mobile grid's coarser rendition of it is the
 * least visible part of the sea. Combined crest-to-trough height is ~4.3m over a ~200m dominant
 * wavelength, i.e. a steepness around 1/90 — a real, legible ocean swell rather than either a dead
 * flat sheet or an implausibly choppy one.
 *
 * Phase speeds are deliberately **not** listed here — they are derived in-shader from the
 * deep-water gravity-wave dispersion relation, so the three components drift apart at physically
 * plausible rates instead of marching in lockstep at three hand-picked speeds.
 *
 * Exported so `scripts/checkRun325WaterSwell.js` can run its analytic bed-clearance proof against
 * the real numbers instead of a hand-copied duplicate that could silently drift out of sync.
 */
export const SWELL_COMPONENTS = Object.freeze([
	Object.freeze([200, 1.05, 1.0, 0.28]),
	Object.freeze([165, 0.5, -0.85, -0.5]),
	Object.freeze([115, 0.7, -0.42, 1.0]),
	Object.freeze([75, 0.4, 0.8, -0.6]),
	Object.freeze([48, 0.22, 0.35, 0.94]),
]);

/**
 * Crest meander (run 389). A sum of pure sinusoids is exactly periodic, so three fixed-direction
 * trains tile the plane with an interference lattice. That lattice was always there; it only became
 * visible when run 388's extinction model stopped rendering the sea as a near-black sheet, and it
 * reads as a repeating field of pale blobs because `fresnel` at grazing angles turns small normal
 * tilts into the pale shallow colour.
 *
 * A real swell train is not one direction but a narrow spread of them, so its crests wander sideways
 * over hundreds of metres instead of running dead straight to the horizon. This warps each train's
 * phase along its own crest axis, at a different offset per train, which destroys the lattice for the
 * same reason the real ocean does not have one.
 *
 * `amplitudeRadians` is a phase shift, not a height, so it cannot affect the
 * `WAVE_TOTAL_AMPLITUDE_METERS < FULL_WAVE_DEPTH_METERS` bed-clearance guarantee. Exported so
 * `scripts/checkRun325WaterSwell.js` mirrors the real numbers rather than a hand-copied duplicate.
 */
export const SWELL_CREST_WARP = Object.freeze({
	amplitudeRadians: 0.9,
	frequencyPerMeter: 0.0026,
	phasePerComponent: 2.399963,
});

/**
 * Worst-case (all three crests aligned) vertical displacement, in meters. Must stay strictly below
 * `waterDepthField.js`'s `FULL_WAVE_DEPTH_METERS` — that inequality is the whole reason geometric
 * waves are safe here where ADR-0048's constant-amplitude ones were not. Exported so
 * `scripts/checkRun325WaterSwell.js` can assert it rather than trusting a comment.
 */
export const WAVE_TOTAL_AMPLITUDE_METERS = SWELL_COMPONENTS.reduce((sum, [, amplitude]) => sum + amplitude, 0);

/**
 * The swell maths, shared verbatim by both shader stages (run 389).
 *
 * The vertex stage needs the height to displace the surface; the fragment stage needs the slope to
 * shade it. Before this was shared, the slope was computed per-vertex and handed over as a varying,
 * which is where the faceting came from: the slope was exact *at each vertex* and then linearly
 * interpolated across a 12.5 m quad, so the shading normal was piecewise-linear and the sea broke
 * into flat polygonal patches with visibly straight edges. (The old comment claimed the analytic
 * slope "keeps the shading exact even where the geometry is coarse" — exact at the vertices, yes,
 * but that is not where most pixels are.) Evaluating the same closed form per fragment costs a
 * handful of sin/cos and removes the faceting outright, because there is nothing left to interpolate.
 */
const SWELL_GLSL = /* glsl */ `
	// Deep-water gravity wave: phase speed c = sqrt(g * lambda / 2pi), hence omega = sqrt(g * k).
	const float GRAVITY = 9.81;
	const float TAU = 6.28318530718;

	/** Accumulates one sinusoidal swell component's height and its analytic XZ slope. */
	void addSwell(vec2 direction, float wavelength, float amplitude, float warpPhase, vec2 worldXZ, float time, inout float height, inout vec2 slope) {
		vec2 dir = normalize(direction);
		float k = TAU / wavelength;
		float omega = sqrt(GRAVITY * k);
		// Crest meander. The warp varies along the crest axis (perpendicular to travel), which is what
		// bends a crest sideways rather than just sliding it forwards. Its exact gradient is added to
		// the slope: for phase = k*dot(dir,p) - wt + W(p), dh/dp = A*cos(phase) * (k*dir + grad W). Take
		// the gradient analytically or the shading normal silently stops matching the geometry it is
		// shading -- the displaced surface would say one thing and the lighting another.
		vec2 crestAxis = vec2(-dir.y, dir.x) * ${SWELL_CREST_WARP.frequencyPerMeter};
		float warpArgument = dot(crestAxis, worldXZ) + warpPhase;
		float warp = ${SWELL_CREST_WARP.amplitudeRadians} * sin(warpArgument);
		vec2 warpGradient = crestAxis * (${SWELL_CREST_WARP.amplitudeRadians} * cos(warpArgument));
		float phase = k * dot(dir, worldXZ) - omega * time + warp;
		height += amplitude * sin(phase);
		slope += (dir * k + warpGradient) * (amplitude * cos(phase));
	}

	/** The full swell train at one world-space XZ: height in .x, slope in .yz. */
	vec3 swellAt(vec2 worldXZ, float time) {
		float height = 0.0;
		vec2 slope = vec2(0.0);
${SWELL_COMPONENTS.map(([wavelength, amplitude, dirX, dirZ], index) =>
	`\t\taddSwell(vec2(${dirX}, ${dirZ}), ${wavelength}.0, ${amplitude}, ${(index * SWELL_CREST_WARP.phasePerComponent).toFixed(6)}, worldXZ, time, height, slope);`
).join('\n')}
		return vec3(height, slope);
	}
`;

const WATER_VERTEX_SHADER = /* glsl */ `
	uniform float uTime;
	uniform sampler2D uDepthMap;
	uniform float uDepthFieldExtentMeters;
	uniform float uSwellStrength;
	varying vec3 vWorldPosition;
	varying float vDepthFactor;
	varying float vAmplitudeScale;
	#include <fog_pars_vertex>

	/**
	 * Normalized water depth at a world-space XZ, from the baked field (see world/waterDepthField.js).
	 * Outside the baked square there is no streamed terrain at all, so "fully deep open ocean" is the
	 * correct answer rather than a clamped edge sample.
	 */
	float sampleDepthFactor(vec2 worldXZ) {
		vec2 uv = worldXZ / uDepthFieldExtentMeters + 0.5;
		if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return 1.0;
		return texture2D(uDepthMap, uv).r;
	}
${SWELL_GLSL}
	void main() {
		vec3 worldPos = (modelMatrix * vec4(position, 1.0)).xyz;
		float depthFactor = sampleDepthFactor(worldPos.xz);

		// Keep the high-density 4km swell surface, but taper its displacement to zero before its edge
		// so it blends invisibly into the two-triangle full-world water coverage mesh underneath.
		float localEdgeDistance = max(abs(position.x), abs(position.z));
		float nearCoverageFade = 1.0 - smoothstep(1500.0, 1950.0, localEdgeDistance);
		float amplitudeScale = depthFactor * uSwellStrength * nearCoverageFade;
		worldPos.y += swellAt(worldPos.xz, uTime).x * amplitudeScale;

		vWorldPosition = worldPos;
		vDepthFactor = depthFactor;
		// Only the scalar envelope is interpolated now. It varies over hundreds of metres (depth field,
		// edge taper), not over a wavelength, so linear interpolation across a quad is faithful to it
		// in a way it never was for the slope.
		vAmplitudeScale = amplitudeScale;

		vec4 mvPosition = viewMatrix * vec4(worldPos, 1.0);
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
	uniform sampler2D uDepthMap;
	uniform float uDepthFieldExtentMeters;
	uniform vec3 uExtinctionPerMeter;
	uniform float uFullOpticalDepthMeters;
	uniform float uMinSurfaceAlpha;
	uniform float uMaxSurfaceAlpha;
	uniform float uFarPlaneCutoffMeters;
	varying vec3 vWorldPosition;
	varying float vDepthFactor;
	varying float vAmplitudeScale;
	#include <fog_pars_fragment>
${SWELL_GLSL}

	vec3 sampleWaterField(vec2 worldXZ) {
		vec2 uv = worldXZ / uDepthFieldExtentMeters + 0.5;
		// Outside the baked owner-world terrain there is no ground mesh, so this is open ocean.
		if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return vec3(1.0, 1.0, 1.0);
		vec4 field = texture2D(uDepthMap, uv);
		// r = swell depth (10 m range), g = wet coverage, b = optical depth (60 m range).
		return field.rgb;
	}

	float sampleFragmentDepth(vec2 worldXZ) {
		return sampleWaterField(worldXZ).x;
	}

	float shorelineGradientMask(vec2 worldXZ) {
		const float STEP_METERS = 68.0;
		float eastWest = abs(sampleFragmentDepth(worldXZ + vec2(STEP_METERS, 0.0)) - sampleFragmentDepth(worldXZ - vec2(STEP_METERS, 0.0)));
		float northSouth = abs(sampleFragmentDepth(worldXZ + vec2(0.0, STEP_METERS)) - sampleFragmentDepth(worldXZ - vec2(0.0, STEP_METERS)));
		return smoothstep(0.018, 0.11, max(eastWest, northSouth));
	}

	// Fine chop remains world-space, but uses longer incommensurate wavelengths plus a slow warp.
	// The old ~3-8m sinusoidal periods were smaller than many screen pixels in far/orthographic views
	// and collapsed into obvious repeated stripes/moiré. These 30-70m components remain readable near
	// the player while the warp breaks long straight phase bands before they can align into a grid.
	vec2 rippleSlope(vec2 worldXZ, float time) {
		float warp = sin(dot(worldXZ, vec2(0.014, -0.011)) + time * 0.07);
		float r1 = sin(dot(worldXZ, vec2(0.095, 0.061)) + warp * 0.75 + time * 0.55);
		float r2 = sin(dot(worldXZ, vec2(-0.052, 0.083)) - warp * 0.42 - time * 0.41);
		float r3 = sin(dot(worldXZ, vec2(0.031, -0.044)) + warp * 0.58 + time * 0.29);
		return vec2(r1 + r2 * 0.55, r3 + r2 * 0.36) * 0.035;
	}

	void main() {
		vec3 waterField = sampleWaterField(vWorldPosition.xz);
		float fragmentDepth = waterField.x;
		// Green is the terrain-authoritative wet/dry classification baked alongside depth. Bilinear
		// filtering turns its binary texels into a narrow shoreline transition. Discarding the dry
		// interior prevents the full-world coverage mesh from drawing translucent cyan rectangles over
		// land while preserving tiny/shallow water bodies whose red depth can legitimately be near 0.
		float waterCoverage = smoothstep(0.08, 0.72, waterField.y);
		if (waterCoverage <= 0.01) discard;

		// The far plane must not draw underneath the near mesh (run 389).
		//
		// Both are water surfaces at the same level, 6 cm apart — but the near mesh displaces its
		// vertices by up to WAVE_TOTAL_AMPLITUDE_METERS, so every trough sank metres *below* the flat
		// far plane and every crest rose above it. The two surfaces therefore interpenetrated across
		// the whole overlap, and the depth test cut a hard silhouette along each intersection contour.
		// That is what the "repeating pale blobs" on the sea were: not shading, not noise, not the
		// bathymetry — the outline of one water surface poking through another. They were invisible
		// only while both planes rendered near-black, which is why this survived until run 388 gave
		// the water real colour.
		//
		// The near mesh already fades its displacement to zero before its own edge, so the two agree
		// exactly at the seam; the missing half of that design was for the far plane to stop there.
		// The footprint is Chebyshev, not Euclidean, because the near mesh is a square centred on the
		// camera and its fade is written in max(|x|, |z|).
		if (uFarPlaneCutoffMeters > 0.0) {
			vec2 nearFootprint = abs(vWorldPosition.xz - uCameraPosition.xz);
			if (max(nearFootprint.x, nearFootprint.y) < uFarPlaneCutoffMeters) discard;
		}

		// Fine chop is intentionally near-field only. Beyond a few hundred metres its wavelength
		// undersamples into repetitive screen-space bands, so the analytic long swell owns distance.
		float rippleFade = 1.0 - smoothstep(90.0, 360.0, distance(uCameraPosition, vWorldPosition));
		// Long swell remains geometric at distance, but its analytic normal must also become near-field:
		// otherwise a 90-degree/full-world camera resolves the 75-200m phases as a striped rectangle.
		float swellShadingFade = 1.0 - smoothstep(700.0, 1800.0, distance(uCameraPosition, vWorldPosition));
		// For a height field y = h(x, z) the surface normal is normalize(vec3(-dh/dx, 1.0, -dh/dz)).
		// Evaluated per fragment, not interpolated from the vertices: see SWELL_GLSL. This is what
		// removes the flat polygonal facets the sea used to break into.
		vec2 swellSlope = swellAt(vWorldPosition.xz, uTime).yz * vAmplitudeScale;
		vec2 slope = swellSlope * swellShadingFade + rippleSlope(vWorldPosition.xz, uTime) * rippleFade;
		vec3 normal = normalize(vec3(-slope.x, 1.0, -slope.y));
		vec3 viewDir = normalize(uCameraPosition - vWorldPosition);

		// **Colour and clarity come from Beer-Lambert extinction, not from a two-colour ramp.**
		//
		// The old line mixed one shallow colour into one deep colour across a smoothstep, which gives a
		// flat two-tone sea: every shallow is the same turquoise and every deep is the same navy, with a
		// visible band where the ramp sits. Real water does something specific and simple — it absorbs
		// long wavelengths far faster than short ones, so red dies within a couple of metres, green
		// survives to ten or so, and blue carries furthest. That single fact is what makes a shore read
		// clear over its own sand, then green, then blue, then black, with no bands anywhere: the
		// progression is a continuous exponential per channel.
		//
		// uExtinctionPerMeter is that absorption, in inverse metres, and the optical depth channel
		// carries a 60 m range so deep water keeps darkening long after swell has stopped changing.
		float opticalDepthMeters = waterField.z * uFullOpticalDepthMeters;
		vec3 transmittance = exp(-uExtinctionPerMeter * opticalDepthMeters);
		// What is left of the light that went down, hit something, and came back up.
		vec3 bodyColor = mix(uDeepColor, uShallowColor, transmittance);

		// Fresnel-ish: nearer grazing angles read lighter/more reflective, straight-down reads deep.
		float fresnel = pow(1.0 - clamp(dot(normal, viewDir), 0.0, 1.0), 3.0);
		vec3 baseColor = mix(bodyColor, uShallowColor, fresnel * 0.48);

		vec3 halfVector = normalize(uSunDirection + viewDir);
		float specular = pow(clamp(dot(normal, halfVector), 0.0, 1.0), 80.0);

		// Surf remains depth-bounded, but now also requires a real bathymetry transition. Uniformly
		// shallow lake interiors therefore stay calm instead of turning the whole polygon into foam.
		float surfA = sin(dot(vWorldPosition.xz, vec2(0.018, -0.013)) + uTime * 0.55);
		float surfB = sin(dot(vWorldPosition.xz, vec2(-0.009, 0.021)) - uTime * 0.37);
		float surge = clamp(0.62 + 0.22 * surfA + 0.16 * surfB, 0.18, 1.0);
		float shallowMask = 1.0 - smoothstep(0.0, 0.22, fragmentDepth);
		shallowMask *= shorelineGradientMask(vWorldPosition.xz) * waterCoverage;
		float foam = clamp(shallowMask * surge, 0.0, 1.0);

		vec3 color = mix(baseColor + specular * 0.48, vec3(0.90, 0.95, 0.96), foam * 0.76);
		// Shallow water is more see-through, so a lake bed or beach shelf shows through instead of
		// every depth rendering as the same opaque sheet. Coverage then fades the canonical shoreline
		// itself rather than tinting the dry side of it.
		// Opacity is the same extinction, seen from above: whatever light still gets through is exactly
		// how much of the bottom the player can see. A hand's depth of water over a rock shelf is nearly
		// invisible, a metre of it is a green tint you can still read the stones through, and past ten
		// metres nothing returns. Weighted toward green because that is where the eye is most sensitive
		// and where water transmits longest — a luminance-weighted average of what survives.
		float clarity = dot(transmittance, vec3(0.28, 0.52, 0.20));
		float alpha = clamp(1.0 - clarity, uMinSurfaceAlpha, uMaxSurfaceAlpha);
		alpha *= waterCoverage;

		gl_FragColor = vec4(color, max(alpha, foam * 0.78));
		#include <fog_fragment>
	}
`;

/** Near-field water retains the established dense swell geometry and physical quad spacing. */
const WATER_PLANE_EXTENT_METERS = 4000;
/** Full-owner-world diagonal coverage for orthographic acceptance and distant canonical water. */
export const WATER_FULL_WORLD_EXTENT_METERS = 17000;
/**
 * Default geometry resolution — unchanged from the pre-swell version (32,768 triangles) so every
 * existing caller and `scripts/checkWaterVisualContract.js` see exactly the mesh they did before.
 * `sceneManager.js` passes a higher count on desktop-class devices; see `createWater`'s `segments`
 * parameter and `WATER_PLANE_SEGMENTS_DESKTOP`.
 */
const WATER_PLANE_SEGMENTS = 128;

/**
 * Desktop-class segment count. 4000/320 = 12.5 m per quad, ~7.6 quads across the shortest swell
 * component — enough for the displaced surface to read as a smooth swell rather than a faceted one.
 * Costs 204,800 triangles against the desktop budget of 5M (`GOVERNANCE.md` §4); touch devices keep
 * `WATER_PLANE_SEGMENTS` so the 500K mobile triangle budget is untouched.
 */
export const WATER_PLANE_SEGMENTS_DESKTOP = 320;

/**
 * Touch-device segment count. 4000/192 = 20.8 m per quad — coarser than desktop, but enough for the
 * two dominant swell components to read as a smooth undulation. Costs 73,728 triangles where the
 * pre-swell plane cost 32,768; `scripts/checkMobilePerfBudget.js` holds the whole scene to the 500K
 * mobile triangle budget and is the check to re-run if this is ever raised.
 */
export const WATER_PLANE_SEGMENTS_MOBILE = 192;

/**
 * Depth-graded ocean palette, retuned 2026-08-19 against the owner-supplied aerial reference, in
 * which open water is a deep saturated navy grading to a lighter blue-teal over the shallows.
 *
 * The previous pair (`0x527f79` / `0x0a3a4a`) was itself a correction, away from an earlier neon
 * cyan, and landed on a low-saturation green-teal that read as swamp rather than sea — with water
 * covering about two thirds of any aerial framing, that dominated the whole world's colour. These
 * values keep the anti-neon intent (the shallow tone stays well under half saturation) while moving
 * the hue from green-teal to blue and deepening the far tone, so bathymetry actually reads from the
 * air. Pinned by `scripts/checkWaterVisualContract.js` and `scripts/checkWorldWaterCoverageP0.mjs`.
 */
const DEFAULT_SHALLOW_COLOR = new THREE.Color(0x7fc9c4);
const DEFAULT_DEEP_COLOR = new THREE.Color(0x05182e);

/**
 * Per-metre absorption of water, per colour channel, in inverse metres.
 *
 * These are the numbers that make water look like water rather than like tinted glass. Clear natural
 * water absorbs red roughly an order of magnitude faster than blue, which is why a shallow pool over
 * pale rock reads almost colourless, a metre or two of it turns green, and depth goes blue and then
 * black — all as one continuous exponential, with no band anywhere. Roughly following measured clear
 * coastal water, warmed slightly in green so lakes and shelves read the turquoise the owner's
 * reference images show rather than a colder open-ocean blue.
 *
 * Red at 0.46/m means half the red is gone by 1.5 m and 99% by 10 m. Blue at 0.052/m still has a
 * third of its light left at 20 m, which is what keeps deep water blue instead of grey.
 */
const EXTINCTION_PER_METER = new THREE.Vector3(0.46, 0.115, 0.052);

/**
 * Clamps on how transparent or opaque the surface may get.
 *
 * The floor is not zero: even water you can see straight through still shows sky and a specular
 * highlight, and at exactly zero the shore would vanish into the sand rather than reading as a wet
 * edge. The ceiling is under one so deep water keeps a trace of the sky it reflects.
 */
const MIN_SURFACE_ALPHA = 0.06;
const MAX_SURFACE_ALPHA = 0.94;
/** Matches `game3d.js`'s directional "sun" light position, normalized — kept as a local constant
 * here (not `config.js`) since only this shader's specular highlight reads it today; promote it if
 * a second system needs the same direction. */
const SUN_DIRECTION = new THREE.Vector3(300, 400, 200).normalize();

/**
 * Placeholder bound to `uDepthMap` before a real field is attached: one fully-deep/fully-covered
 * texel. Nothing is displaced against it — `uSwellStrength` is 0 until `setWaterDepthField` runs —
 * it exists only so the sampler is never left unbound. Module-level and intentionally never
 * disposed (see `disposeWater`, which skips it).
 */
const PLACEHOLDER_DEPTH_TEXTURE = new THREE.DataTexture(
	new Uint8Array([255, 255, 255, 255]),
	1,
	1,
	THREE.RGBAFormat,
	THREE.UnsignedByteType,
);
PLACEHOLDER_DEPTH_TEXTURE.needsUpdate = true;

/**
 * Builds the sea-level water plane. Caller must reposition it onto the camera every frame (via
 * `updateWater`) so it always extends toward the horizon regardless of where the viewer orbits to,
 * and should attach a baked depth field (via `setWaterDepthField`) to enable geometric swell.
 * @param {number} waterLevelMeters World-space Y the plane sits at (`WORLD_DEFAULTS.WATER_LEVEL_METERS`).
 * @param {number} [segments] Geometry subdivisions per edge. Defaults to the historical mobile-safe
 *   `WATER_PLANE_SEGMENTS`; pass `WATER_PLANE_SEGMENTS_DESKTOP` on desktop-class hardware.
 * @returns {THREE.Mesh}
 */
export function createWater(waterLevelMeters, segments = WATER_PLANE_SEGMENTS) {
	const geometry = new THREE.PlaneGeometry(
		WATER_PLANE_EXTENT_METERS,
		WATER_PLANE_EXTENT_METERS,
		segments,
		segments,
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
				uExtinctionPerMeter: { value: EXTINCTION_PER_METER },
				uFullOpticalDepthMeters: { value: FULL_OPTICAL_DEPTH_METERS },
				uMinSurfaceAlpha: { value: MIN_SURFACE_ALPHA },
				uMaxSurfaceAlpha: { value: MAX_SURFACE_ALPHA },
				// 0 on the near mesh: it is the one doing the covering, so it never discards for this.
				uFarPlaneCutoffMeters: { value: 0 },
				uSunDirection: { value: SUN_DIRECTION },
				uCameraPosition: { value: new THREE.Vector3() },
				uDepthMap: { value: PLACEHOLDER_DEPTH_TEXTURE },
				uDepthFieldExtentMeters: { value: 1 },
				uSwellStrength: { value: 0 },
			},
		]),
		transparent: true,
		depthWrite: true,
		fog: true, // consumes scene.fog (fog.js) via the fog_* chunks included in both shaders above.
	});

	const mesh = new THREE.Mesh(geometry, material);
	mesh.position.y = waterLevelMeters;
	mesh.frustumCulled = false; // recentered on the camera every frame — always meant to be in view.

	// Two triangles cover the complete owner world underneath the dense near mesh. The shared shader
	// samples bathymetry/coverage per fragment, while vertex swell is edge-faded to zero on this large
	// plane. Dry owner-world fragments are discarded by the canonical coverage mask.
	const farGeometry = new THREE.PlaneGeometry(WATER_FULL_WORLD_EXTENT_METERS, WATER_FULL_WORLD_EXTENT_METERS, 1, 1);
	farGeometry.rotateX(-Math.PI / 2);
	const farMaterial = material.clone();
	// Stop a few metres inside the near mesh's own edge rather than exactly at it: a small overlap
	// where both planes are flat and agree is invisible, whereas a gap from float error would show
	// the sea bed through a seam two kilometres long.
	farMaterial.uniforms.uFarPlaneCutoffMeters.value = WATER_PLANE_EXTENT_METERS / 2 - 4;
	const farWater = new THREE.Mesh(farGeometry, farMaterial);
	farWater.position.y = -0.06;
	farWater.renderOrder = -1;
	farWater.frustumCulled = false;
	mesh.add(farWater);

	mesh.userData.farWater = farWater;
	mesh.userData.waterCoverage = Object.freeze({
		nearExtentMeters: WATER_PLANE_EXTENT_METERS,
		fullWorldExtentMeters: WATER_FULL_WORLD_EXTENT_METERS,
		fullWorld: true,
	});
	return mesh;
}

/**
 * Attaches a baked depth field (`world/waterDepthField.js`) and switches geometric swell on. Until
 * this is called the surface stays exactly as flat as the ADR-0048 version — displacing water
 * against unknown bathymetry is precisely the bug that ADR removed, so "no field" means "no waves"
 * rather than "assume deep".
 * @param {THREE.Mesh} waterMesh
 * @param {{texture: THREE.DataTexture, extentMeters: number}} depthField
 * @param {number} [swellStrength=1] 0..1 multiplier over the whole swell — a hook for a future
 *   quality preset to soften or disable waves without rebaking the field.
 */
export function setWaterDepthField(waterMesh, depthField, swellStrength = 1) {
	for (const material of [waterMesh.material, waterMesh.userData.farWater?.material].filter(Boolean)) {
		const { uniforms } = material;
		uniforms.uDepthMap.value = depthField.texture;
		uniforms.uDepthFieldExtentMeters.value = depthField.extentMeters;
		uniforms.uSwellStrength.value = swellStrength;
	}
	// Remembered so `disposeWater` can release the baked texture with the mesh that owns it.
	waterMesh.userData.depthField = depthField;
}

/**
 * Re-centers the water plane's XZ on the camera (keeping its fixed sea-level Y), advances the
 * wave animation time, and updates the specular-highlight camera-position uniform.
 * Call once per frame.
 * @param {THREE.Mesh} waterMesh
 * @param {THREE.Vector3} cameraPosition
 * @param {number} elapsedSeconds
 */
export function updateWater(waterMesh, cameraPosition, elapsedSeconds) {
	waterMesh.position.x = cameraPosition.x;
	waterMesh.position.z = cameraPosition.z;
	for (const material of [waterMesh.material, waterMesh.userData.farWater?.material].filter(Boolean)) {
		material.uniforms.uTime.value = elapsedSeconds;
		material.uniforms.uCameraPosition.value.copy(cameraPosition);
	}
}

/**
 * Disposes the water plane's geometry/material, plus any depth field attached via
 * `setWaterDepthField`. Call on teardown — memory-leak checklist.
 * @param {THREE.Mesh} waterMesh
 */
export function disposeWater(waterMesh) {
	const farWater = waterMesh.userData.farWater;
	if (farWater) {
		farWater.geometry.dispose();
		farWater.material.dispose();
		waterMesh.remove(farWater);
		waterMesh.userData.farWater = null;
	}
	waterMesh.geometry.dispose();
	waterMesh.material.dispose();
	const depthField = waterMesh.userData.depthField;
	// The shared placeholder is never owned by a mesh and must outlive every one of them.
	if (depthField && depthField.texture !== PLACEHOLDER_DEPTH_TEXTURE) {
		depthField.texture.dispose();
		waterMesh.userData.depthField = null;
	}
}