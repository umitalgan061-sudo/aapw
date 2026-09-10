/**
 * Rain — the project's first real environmental weather effect (target architecture's
 * `world/Weather`, previously unbuilt; see GOVERNANCE.md §18 item 14 "Yeni özellik", run 371).
 *
 * Ties into the existing FAZ 8 flavor-event pipeline (`gameplay/worldEvents.js`) rather than
 * inventing a second, competing schedule: when the deterministic `distant_storm` world event fires,
 * `game3d.js` calls `trigger()` on the object this module returns, and a short rain shower fades in,
 * holds, and fades out. This module itself draws no random numbers and keeps no timer beyond the one
 * `trigger()` starts, so it never perturbs `worldEvents.js`'s own seeded draw sequence or its
 * `checkWorldEventDeterminism.js` fixture — it is a passive `EventBus` listener, the same
 * relationship `ui/worldEventToast.js` already has to that emitter (see that module's own doc
 * comment / ADR-0056).
 *
 * Implementation: a fixed-size cloud of short vertical line segments (`THREE.LineSegments`), always
 * recentered under the active camera every frame (`update`'s `cameraPosition` argument) so it reads
 * as "it is raining around you" at any point in this world's ~150km² without needing a world-extent
 * particle system. Each drop's horizontal offset and fall-loop phase is fixed at construction time
 * from a seeded `mulberry32` draw (never `Math.random()`, per GOVERNANCE.md §5) — the same seed
 * always produces the same drop layout, satisfying this project's determinism rule even though the
 * *timing* of when rain happens is driven by the already-deterministic world-event stream, not by
 * this module. No texture/geometry asset is needed (plain `THREE.LineBasicMaterial`), so this
 * feature is not blocked by the git-lfs/proxy-auth asset gap documented in
 * `RCA_RUN370_LFS_PROXY_AUTH.md`.
 * @module world/weather
 */

import * as THREE from 'three';
import { mulberry32 } from './terrain.js';

/** Number of simultaneous raindrops. Each drop costs one draw call's worth of vertex data, not its
 * own draw call (all drops share one `LineSegments` geometry/material) — see module doc's perf note
 * in `createWeatherSystem`'s own comment below for the actual measured cost. */
export const RAIN_DROP_COUNT = 900;
/** Horizontal radius, in meters, of the cylindrical volume drops are seeded within around the
 * camera — tight enough that drops never visibly pop in/out at the fog line (`fog.js`'s own horizon
 * fade starts well past this), loose enough to fill the view during a chase-camera third-person
 * shot without an obvious "hollow center" directly under the player. */
const RAIN_RADIUS_METERS = 60;
/** Vertical span, in meters, drops fall through before looping back to the top. */
const RAIN_FALL_HEIGHT_METERS = 40;
/** Height, in meters, above the camera the fall volume's ceiling sits at — keeps drops falling
 * *through* the camera's typical view instead of only above or only below it. */
const RAIN_CEILING_OFFSET_METERS = 22;
/** Length of each individual drop's line segment, in meters — short enough to read as rain, not
 * hail or a laser, at this project's normal chase-camera distances (`camera.js`'s own defaults). */
const RAIN_DROP_LENGTH_METERS = 0.9;
/** Fall speed, in meters/second — roughly what a heavy shower looks like at this world's scale. */
const RAIN_FALL_SPEED_METERS_PER_SECOND = 24;
/** Seconds `intensity` takes to ramp 0→1 once `trigger()` starts a shower, and 1→0 once the
 * triggered duration elapses — a soft ramp instead of a hard on/off cut so the effect reads as
 * weather rolling in/out rather than a light switch. */
const INTENSITY_FADE_SECONDS = 4;

/**
 * Builds the rain system's fixed-size drop layout and returns the per-frame controller.
 * `RAIN_DROP_COUNT` drops always exist in the scene graph (one static `LineSegments`); only their
 * *opacity* (via `intensity`) and Y position change per frame, so there is no per-shower
 * geometry allocation — the perf-sensitive path (a shower firing mid-play, possibly while other
 * subsystems are also busy) never touches the GC. Measured cost (see 3D_GAME_PROGRESS.md Run 371's
 * own `collectPerfSnapshot.js` entry): one extra draw call, ~1,800 triangle-equivalent vertices —
 * negligible against this project's <2500 draw-call / <5M triangle desktop budget.
 * @param {object} options
 * @param {number} options.seed World seed — same seed always produces the same drop layout.
 * @returns {{
 *   group: import('three').LineSegments,
 *   update: (deltaSeconds: number, cameraPosition: import('three').Vector3) => void,
 *   trigger: (durationSeconds: number) => void,
 *   dispose: () => void,
 * }}
 */
export function createWeatherSystem({ seed }) {
	const random = mulberry32(seed ^ 0x77454154); // "wEAT"-ish tag — own draw stream, never shared.
	const positions = new Float32Array(RAIN_DROP_COUNT * 2 * 3);
	// Per-drop fixed horizontal offset (polar-distributed so density doesn't bunch at the center)
	// and fall-loop phase, so drops don't all reach the ground in lockstep.
	const offsetsX = new Float32Array(RAIN_DROP_COUNT);
	const offsetsZ = new Float32Array(RAIN_DROP_COUNT);
	const phases = new Float32Array(RAIN_DROP_COUNT);
	for (let index = 0; index < RAIN_DROP_COUNT; index += 1) {
		const angle = random() * Math.PI * 2;
		// sqrt() so the distribution is uniform *by area*, not bunched near the center — the same
		// standard polar-sampling correction `world/vegetation.js`'s own scatter already relies on.
		const radius = Math.sqrt(random()) * RAIN_RADIUS_METERS;
		offsetsX[index] = Math.cos(angle) * radius;
		offsetsZ[index] = Math.sin(angle) * radius;
		phases[index] = random() * RAIN_FALL_HEIGHT_METERS;
	}

	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
	const material = new THREE.LineBasicMaterial({
		color: 0xbccbe0,
		transparent: true,
		opacity: 0,
		depthWrite: false,
	});
	const group = new THREE.LineSegments(geometry, material);
	// Frustum culling uses the geometry's local bounding sphere, which BufferGeometry can only
	// compute from the position attribute *at construction time* — but this system re-centers the
	// whole group under the camera every frame (see `update` below) rather than moving individual
	// vertices in world space, so a sphere sized to the fixed fall volume stays valid forever and
	// never needs recomputing.
	geometry.boundingSphere = new THREE.Sphere(
		new THREE.Vector3(0, RAIN_CEILING_OFFSET_METERS - RAIN_FALL_HEIGHT_METERS / 2, 0),
		RAIN_RADIUS_METERS + RAIN_FALL_HEIGHT_METERS,
	);
	group.frustumCulled = true;
	group.renderOrder = 1; // after opaque terrain/water, same convention `water.js`'s mesh uses.

	let intensity = 0;
	let remainingSeconds = 0;

	function writeDropPosition(index, fallenY) {
		const base = index * 2 * 3;
		const x = offsetsX[index];
		const z = offsetsZ[index];
		const topY = RAIN_CEILING_OFFSET_METERS - fallenY;
		positions[base] = x;
		positions[base + 1] = topY;
		positions[base + 2] = z;
		positions[base + 3] = x;
		positions[base + 4] = topY - RAIN_DROP_LENGTH_METERS;
		positions[base + 5] = z;
	}

	// Initial layout (intensity 0, invisible) so the geometry's bounding data and GPU buffer are
	// valid immediately — `update()` below only ever *moves* drops, it never has to branch on
	// "first frame" separately.
	for (let index = 0; index < RAIN_DROP_COUNT; index += 1) writeDropPosition(index, phases[index]);

	/**
	 * Starts (or extends, if already raining) a shower. `durationSeconds` is the hold time at full
	 * intensity, in addition to `INTENSITY_FADE_SECONDS` on each side — callers pass a fixed
	 * constant (see `game3d.js`'s own call site), never a random duration, so this stays fully
	 * reproducible for a given world-event sequence without this module drawing its own randomness.
	 * @param {number} durationSeconds
	 */
	function trigger(durationSeconds) {
		remainingSeconds = Math.max(remainingSeconds, durationSeconds + INTENSITY_FADE_SECONDS);
	}

	/**
	 * @param {number} deltaSeconds Already clamped by the caller (see `game3d.js`'s `MAX_WORLD_EVENT_STEP_SECONDS`-style pattern for `worldEvents.js`) — this module applies no clamp of its own, matching every other per-frame `updateXxx` in `world/`.
	 * @param {import('three').Vector3} cameraPosition The *rendered* camera (free-cam aware — pass whichever camera `game3d.js`'s tick loop is about to render with, same as `updateAuroraSky`/`updateStarfield` already receive).
	 */
	function update(deltaSeconds, cameraPosition) {
		if (remainingSeconds > 0) {
			remainingSeconds = Math.max(0, remainingSeconds - deltaSeconds);
		}
		const target = remainingSeconds > 0 ? 1 : 0;
		const fadeStep = deltaSeconds / INTENSITY_FADE_SECONDS;
		intensity = target > intensity
			? Math.min(target, intensity + fadeStep)
			: Math.max(target, intensity - fadeStep);
		material.opacity = intensity * 0.55; // full-intensity opacity tuned to read as rain, not fog.
		group.visible = intensity > 0;
		if (!group.visible) return;

		group.position.set(cameraPosition.x, 0, cameraPosition.z);
		const fallDistance = deltaSeconds * RAIN_FALL_SPEED_METERS_PER_SECOND;
		for (let index = 0; index < RAIN_DROP_COUNT; index += 1) {
			phases[index] = (phases[index] + fallDistance) % RAIN_FALL_HEIGHT_METERS;
			writeDropPosition(index, phases[index]);
		}
		geometry.attributes.position.needsUpdate = true;
	}

	function dispose() {
		geometry.dispose();
		material.dispose();
	}

	return { group, update, trigger, dispose };
}
