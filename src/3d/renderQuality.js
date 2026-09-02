/**
 * Renderer realism baseline: filmic tone mapping and real sun shadows, driven by `config.js`'s
 * `QUALITY_PRESETS`.
 *
 * **Why this module exists.** `config.js` has shipped `QUALITY_PRESETS` since FAZ 0 with a
 * `shadowMapSize` per level (4096/2048/1024/512) and the explicit instruction "Systems should read
 * from here rather than hardcoding values" — and until now **nothing read it**. The game renderer
 * was constructed as `new THREE.WebGLRenderer({ canvas, antialias: true })` and nothing else: no
 * `shadowMap.enabled`, no `toneMapping`, no shadow flags anywhere in the live scene (only
 * `src/3d/editor/*` set `castShadow`/`receiveShadow`). The result is the flat, shadowless look the
 * project owner asked to make more realistic: every surface is lit purely by the sun's N·L term plus
 * two hemisphere fills, so nothing grounds an object to the terrain it stands on and highlights clip
 * instead of rolling off.
 *
 * Two changes carry almost all of the visual difference, and both are cheap to reason about:
 *   1. **ACES filmic tone mapping.** Three.js r160 defaults to `NoToneMapping`, which writes linear
 *      radiance straight to an sRGB buffer — bright areas clip flat and the midtones read washed out.
 *      ACES rolls highlights off on a filmic curve. Cost is one fragment-shader curve, no extra pass.
 *   2. **Sun shadow map.** A `DirectionalLight` shadow is what actually plants a character, animal or
 *      keep on the ground. This is the expensive one, hence the explicit budget handling below.
 *
 * **Mobile budget.** Shadows are off entirely on coarse-pointer devices. The project's mobile budget
 * (DrawCalls<500, Triangles<500K) is already the binding constraint that forced
 * `CHUNK_CONFIG.STREAM_RADIUS_CHUNKS` down (ADR-0010), and a shadow map re-renders shadow-casting
 * geometry from the light's point of view every frame — precisely the wrong cost to add there. Desktop
 * gets `HIGH`; this is deliberately not `ULTRA`, because a 4096² map is a large step in fill cost for
 * a difference that is hard to see at this world scale, and `QUALITY_PRESETS` exists so that choice
 * can move later without touching this module.
 *
 * @module renderQuality
 */

import * as THREE from './vendor/three/three.module.js';
import { QUALITY_LEVELS, QUALITY_PRESETS } from './config.js';

/**
 * Exposure multiplier applied with ACES tone mapping. Slightly above 1.0 because the existing
 * day/night rig was authored and tuned against `NoToneMapping`; ACES darkens midtones, so a flat 1.0
 * would make this world read dimmer than the lighting keyframes in `lighting.js` intend. This
 * compensates without touching those keyframes, so the day/night cycle, the aurora sky, the night
 * readability fill and every visual-contract check built against them stay valid.
 */
const TONE_MAPPING_EXPOSURE = 1.15;

/**
 * Half-extent, in meters, of the sun's orthographic shadow frustum around its focus point. 120m
 * covers the player's immediate surroundings — a kingdom seat's keep plus its corner towers reach
 * ~35m from center, animal patrol lines sit 26-62m out, and `SETTLEMENT_CONFIG`'s collider is well
 * inside that — while keeping shadow-map texel density usable: at `HIGH` (2048²) this is a 240m span
 * across 2048 texels, ~8.5cm per texel, fine enough that a character's shadow has recognizable shape
 * rather than a stair-stepped blob. Widening this trades that sharpness away linearly, which is why
 * the frustum follows the player (`focusSunShadow`) instead of trying to span the whole ~137.5 km²
 * world at once.
 */
const SHADOW_FRUSTUM_HALF_EXTENT_METERS = 120;

/**
 * Depth range of the shadow camera. Generous relative to the frustum's width because the sun orbits
 * high overhead at noon, so the light-space distance to the ground is much larger than the
 * horizontal extent it covers.
 */
const SHADOW_CAMERA_NEAR_METERS = 1;
const SHADOW_CAMERA_FAR_METERS = 2400;

/**
 * Depth-comparison bias. Both values are the standard remedy for the two artifacts a shadow map
 * produces: `bias` pushes the comparison back to stop a surface shadowing itself into moiré stripes
 * ("shadow acne"), and `normalBias` offsets along the surface normal to stop the thin gap ("peter
 * panning") that a plain `bias` large enough to fix acne would open between an object and its own
 * shadow. Kept small: at this frustum size and map resolution, larger values start detaching
 * character shadows from their feet, which reads worse than the artifact they fix.
 */
const SHADOW_BIAS = -0.0004;
const SHADOW_NORMAL_BIAS = 0.02;

/**
 * Picks the quality level for this device. Deliberately a pure function of its inputs rather than
 * reading `window`/`localStorage` itself, so callers (and tests) stay in control — `sceneManager.js`
 * already owns the `isCoarsePointerDevice()` probe every other budget decision in this project routes
 * through, and a second independent device check here could disagree with it.
 * @param {object} options
 * @param {boolean} options.coarsePointer `isCoarsePointerDevice()` — touch-primary hardware.
 * @param {string|null} [options.manualLevel] A `QUALITY_LEVELS` value read from
 *   `STORAGE_KEYS.QUALITY_SETTING` (`ui/pauseMenu.js`'s settings screen, run 341/ADR-0289) — the
 *   player's manual override, if any. Only ever applied on desktop: the mobile budget
 *   (DrawCalls<500, Triangles<500K, ADR-0010) is a fixed invariant this project already treats as
 *   non-negotiable, not something a settings screen should be able to loosen, so `coarsePointer`
 *   always wins regardless of what is stored. `QUALITY_LEVELS.AUTOMATIC`, `null`/`undefined`, and any
 *   value that is not a real `QUALITY_PRESETS` key (a hand-edited or stale-version localStorage value
 *   included) all mean "no override" and fall through to the existing per-device default below.
 * @returns {{level: string, preset: {shadowMapSize: number, drawDistance: number, pixelRatioCap: number, textureSize: number}, shadowsEnabled: boolean}}
 */
export function resolveRenderQuality({ coarsePointer, manualLevel = null }) {
	const overrideLevel = !coarsePointer && manualLevel && manualLevel !== QUALITY_LEVELS.AUTOMATIC
		&& QUALITY_PRESETS[manualLevel]
		? manualLevel
		: null;
	const level = overrideLevel ?? (coarsePointer ? QUALITY_LEVELS.LOW : QUALITY_LEVELS.HIGH);
	return {
		level,
		preset: QUALITY_PRESETS[level],
		// See the module doc: shadow maps are the one realism feature the mobile budget cannot absorb.
		// Unaffected by `manualLevel` — a manual override only ever picks among desktop presets, it
		// never re-enables shadows on a coarse-pointer device.
		shadowsEnabled: !coarsePointer,
	};
}

/**
 * Applies tone mapping and (when enabled) turns the shadow map on. Tone mapping is applied on every
 * device including mobile: it costs a shader curve, not geometry, and it is what makes the existing
 * PBR materials read as lit rather than flat.
 * @param {THREE.WebGLRenderer} renderer
 * @param {ReturnType<typeof resolveRenderQuality>} quality
 */
export function configureRendererRealism(renderer, quality) {
	renderer.toneMapping = THREE.ACESFilmicToneMapping;
	renderer.toneMappingExposure = TONE_MAPPING_EXPOSURE;
	renderer.shadowMap.enabled = quality.shadowsEnabled;
	if (quality.shadowsEnabled) {
		// PCF soft: the softest of the three map-based filters Three.js offers without moving to VSM,
		// which has its own light-leak tuning burden. A hard-edged shadow at this world scale reads as a
		// decal rather than a shadow.
		renderer.shadowMap.type = THREE.PCFSoftShadowMap;
	}
}

/**
 * Turns the day/night sun into a shadow caster and sizes its shadow camera. Safe to call when
 * shadows are disabled — it leaves `castShadow` false and touches nothing else, so the mobile path
 * allocates no shadow map at all.
 * @param {THREE.DirectionalLight} sun The `sun` from `createDayNightLighting`.
 * @param {ReturnType<typeof resolveRenderQuality>} quality
 */
export function configureSunShadow(sun, quality) {
	if (!quality.shadowsEnabled) {
		sun.castShadow = false;
		return;
	}
	sun.castShadow = true;
	sun.shadow.mapSize.set(quality.preset.shadowMapSize, quality.preset.shadowMapSize);

	const camera = sun.shadow.camera;
	camera.left = -SHADOW_FRUSTUM_HALF_EXTENT_METERS;
	camera.right = SHADOW_FRUSTUM_HALF_EXTENT_METERS;
	camera.top = SHADOW_FRUSTUM_HALF_EXTENT_METERS;
	camera.bottom = -SHADOW_FRUSTUM_HALF_EXTENT_METERS;
	camera.near = SHADOW_CAMERA_NEAR_METERS;
	camera.far = SHADOW_CAMERA_FAR_METERS;
	camera.updateProjectionMatrix();

	sun.shadow.bias = SHADOW_BIAS;
	sun.shadow.normalBias = SHADOW_NORMAL_BIAS;
}

/**
 * Re-anchors the sun's shadow frustum onto a focus point (normally the player) **without changing the
 * light's direction**, so the day/night cycle looks exactly as it did before.
 *
 * `updateDayNightLighting` sets `sun.position` absolutely each frame to `direction * orbitRadius`
 * around the world origin, and a `DirectionalLight`'s default target is the origin too. Since the
 * player spawns next to the `umit` seat — thousands of meters from the origin — the shadow camera
 * would otherwise be pointed at empty terrain on the far side of the world and nothing near the
 * player would ever be shadowed. Translating *both* the position and the target by the same focus
 * offset preserves the position→target vector, which is the only thing a directional light's shading
 * depends on, while moving the frustum to where the player actually is.
 *
 * Must be called **after** `updateDayNightLighting` in the same frame, since that function
 * overwrites `sun.position` outright.
 * @param {THREE.DirectionalLight} sun
 * @param {number} focusX World-space X to center the shadow frustum on.
 * @param {number} focusY World-space Y (ground height at the focus).
 * @param {number} focusZ World-space Z.
 */
export function focusSunShadow(sun, focusX, focusY, focusZ) {
	if (!sun.castShadow) return;
	sun.position.x += focusX;
	sun.position.y += focusY;
	sun.position.z += focusZ;
	sun.target.position.set(focusX, focusY, focusZ);
	// A DirectionalLight's `target` is not in the scene graph by default, so nothing else updates its
	// world matrix — without this the light keeps aiming at the target's stale position.
	sun.target.updateMatrixWorld();
}

/**
 * Marks a subtree as shadow-casting and/or shadow-receiving. A no-op when `shadowsEnabled` is false,
 * so callers do not need to branch. A mesh may set `userData.preserveShadowRole = true` when its
 * deliberately assigned role must survive a broad subtree pass (for example transparent terrain
 * contact dressing that should receive light/shadow but must never cast a decal-shaped shadow).
 *
 * `InstancedMesh` is included deliberately: `world/settlements.js` draws all 14 castles as three
 * shared instanced meshes, and Three.js supports shadows on instanced geometry, so skipping them
 * would leave every keep in the world floating shadowless while the characters beside them are
 * grounded — the single most obvious tell that shadows are only half-wired.
 * @param {THREE.Object3D | null | undefined} root
 * @param {object} options
 * @param {ReturnType<typeof resolveRenderQuality>} options.quality
 * @param {boolean} [options.cast=true] Whether meshes in this subtree cast shadows.
 * @param {boolean} [options.receive=true] Whether they receive them.
 */
export function applyShadowRoles(root, { quality, cast = true, receive = true }) {
	if (!root || !quality.shadowsEnabled) return;
	root.traverse((object) => {
		if (!object.isMesh && !object.isInstancedMesh && !object.isSkinnedMesh) return;
		if (object.userData?.preserveShadowRole === true) return;
		object.castShadow = cast;
		object.receiveShadow = receive;
	});
}