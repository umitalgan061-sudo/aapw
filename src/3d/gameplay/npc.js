/**
 * NPCs (FAZ 5): reuses `gameplay/player.js`'s FBX-loading and Mixamo-scale-correction pattern for a
 * non-player character. Two modes, both driven by the same `update`/`dispose` shape as
 * `gameplay/player.js`'s `createPlayer`:
 *  - **Static** (no `patrolWaypoints` passed, the default — run 20): stands at a fixed world
 *    position, plays a looping idle animation. No AI, pathing, or interaction.
 *  - **Patrolling** (`patrolWaypoints` passed — run 22, pilot on 2 of 6 NPCs): walks a straight
 *    line between 2+ world-space points in order (wrapping via modulo, so 2 points ping-pong and
 *    3+ points loop), pausing to idle at each one, reusing `player.js`'s per-frame ground-height
 *    resampling and shortest-path yaw-turn pattern. No pathfinding/collision avoidance — a straight
 *    line between caller-supplied points, same "don't build a full behavior tree in one run" scope
 *    `3D_GAME_PROGRESS.md`'s FAZ 5 roadmap and DECISIONS.md ADR-0019/ADR-0021 call for.
 *
 * `spawnConfiguredNPCs` (run 29, DECISIONS.md ADR-0028) resolves `gameplayConfig.js`'s `NPC_CONFIG.SPAWNS`
 * against kingdom seats and loads every NPC in parallel — moved here from `game3d.js` to keep that
 * file under the project's 600-line cap.
 * @module gameplay/npc
 */

import * as THREE from 'three';
import { AssetLoader } from '../assetLoader.js';

/**
 * Builds a billboard name-tag sprite from canvas-rendered text. A `THREE.Sprite` always faces the
 * camera in view space — it only inherits its parent's *position*, not rotation — so this stays
 * legible even while a patrolling NPC turns. Real-world-space `scale` (meters, not pixels) means it
 * shrinks with distance like any other object, needing no separate LOD/culling at this NPC count.
 * See DECISIONS.md ADR-0022.
 * @param {string} text
 * @param {number} widthMeters
 * @param {number} heightMeters
 * @returns {THREE.Sprite}
 */
function createNameTagSprite(text, widthMeters, heightMeters) {
	const canvas = document.createElement('canvas');
	canvas.width = 512;
	canvas.height = 128;
	const ctx = canvas.getContext('2d');
	ctx.fillStyle = 'rgba(12, 9, 6, 0.6)';
	ctx.fillRect(0, 0, canvas.width, canvas.height);
	ctx.font = 'bold 52px Georgia, serif';
	ctx.fillStyle = '#f0d9a0';
	ctx.textAlign = 'center';
	ctx.textBaseline = 'middle';
	ctx.fillText(text, canvas.width / 2, canvas.height / 2);

	const texture = new THREE.CanvasTexture(canvas);
	texture.colorSpace = THREE.SRGBColorSpace;
	// depthWrite: false — a flat label shouldn't occlude geometry behind it in the depth buffer;
	// depthTest stays on (the default) so the tag still hides correctly behind real terrain/walls.
	const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
	const sprite = new THREE.Sprite(material);
	sprite.scale.set(widthMeters, heightMeters, 1);
	return sprite;
}

/**
 * Loads one NPC's model (+ idle, and optionally walk, clips), places it, and returns a small
 * controller object.
 * @param {object} options
 * @param {import('../assetLoader.js').AssetLoader} options.assetLoader
 * @param {string} options.modelUrl Mixamo T-pose character FBX (must share `peasant_girl`'s skeleton).
 * @param {string} options.idleAnimationUrl Skin-less idle clip FBX (retargets onto any shared-skeleton model).
 * @param {number} options.worldX World-space spawn X, in meters.
 * @param {number} options.worldZ World-space spawn Z, in meters.
 * @param {number} options.groundY World-space Y the NPC's feet rest at — caller-sampled via the
 *   same `physics.js` ground collider (+ sea-level clamp) every other placement system uses.
 * @param {number} [options.rotationYRadians]
 * @param {string} [options.name] Assigned to the loaded `Object3D` (useful for debugging/tests).
 * @param {string} [options.displayName] If set, a billboard name-tag sprite is added above the
 *   NPC's head (see `createNameTagSprite`). Omit for no tag.
 * @param {number} [options.nameTagWidthMeters]
 * @param {number} [options.nameTagHeightMeters]
 * @param {number} [options.nameTagVerticalOffsetMeters] Height, in meters above the model's local
 *   origin (its feet), the tag is centered at.
 * @param {{getGroundHeight: (x: number, z: number) => number}} [options.groundCollider] Required
 *   only when `patrolWaypoints` is passed — resamples ground height every frame while walking, same
 *   as `player.js`'s own movement.
 * @param {string} [options.walkAnimationUrl] Skin-less walk clip; required only for patrolling NPCs.
 * @param {{x: number, z: number}[]} [options.patrolWaypoints] World-space points to walk between, in
 *   order (index wraps via modulo — 2 points ping-pong, 3+ loop). Omit for a static, idle-only NPC.
 * @param {number} [options.speedMps]
 * @param {number} [options.pauseSeconds] Idle dwell time at each waypoint before moving to the next.
 * @param {number} [options.turnRateRadiansPerSecond]
 * @returns {Promise<{object3D: THREE.Object3D, displayName: (string|null), update: (delta: number) => void, dispose: () => void}>}
 */
export async function createNPC({
	assetLoader,
	modelUrl,
	idleAnimationUrl,
	worldX,
	worldZ,
	groundY,
	rotationYRadians = 0,
	name,
	displayName,
	nameTagWidthMeters = 2.4,
	nameTagHeightMeters = 0.6,
	nameTagVerticalOffsetMeters = 2.1,
	groundCollider,
	walkAnimationUrl,
	patrolWaypoints,
	speedMps = 1.4,
	pauseSeconds = 3,
	turnRateRadiansPerSecond = 4,
}) {
	const model = await assetLoader.loadFBXModel(modelUrl, { fallbackColor: 0x9c6b30, fallbackSize: 1.8 });
	AssetLoader.correctMixamoFbxScale(model);
	if (name) model.name = name;
	model.position.set(worldX, groundY, worldZ);
	model.rotation.y = rotationYRadians;

	if (displayName) {
		// The tag is parented under `model`, which carries the Mixamo cm->m scale correction just
		// applied above (`AssetLoader.correctMixamoFbxScale`, typically ~0.01) — a child's local
		// position/size gets multiplied by that same parent scale in the render matrix (confirmed
		// against the vendored sprite vertex shader, which derives both from modelMatrix). Dividing
		// by it here cancels that out so the tag's real-world size/height stay in actual meters
		// regardless of the model's own FBX unit scale. See DECISIONS.md ADR-0022.
		const inverseParentScale = model.scale.x !== 0 ? 1 / model.scale.x : 1;
		const nameTag = createNameTagSprite(
			displayName,
			nameTagWidthMeters * inverseParentScale,
			nameTagHeightMeters * inverseParentScale,
		);
		nameTag.position.set(0, nameTagVerticalOffsetMeters * inverseParentScale, 0);
		model.add(nameTag);
	}

	const mixer = new THREE.AnimationMixer(model);
	const idleSource = await assetLoader.loadFBXModel(idleAnimationUrl);
	const idleAction = idleSource.animations[0] ? mixer.clipAction(idleSource.animations[0]) : null;

	const isPatrolling = Boolean(patrolWaypoints && patrolWaypoints.length > 0 && groundCollider && walkAnimationUrl);
	let walkAction = null;
	if (isPatrolling) {
		const walkSource = await assetLoader.loadFBXModel(walkAnimationUrl);
		if (walkSource.animations[0]) walkAction = mixer.clipAction(walkSource.animations[0]);
	}

	let currentAction = null;
	/** Crossfades to `action`; a no-op if it's already playing or doesn't exist. */
	function playAction(action) {
		if (currentAction === action || !action) return;
		action.reset().fadeIn(0.25).play();
		if (currentAction) currentAction.fadeOut(0.25);
		currentAction = action;
	}
	playAction(idleAction);

	// Patrol state — unused (and never advanced) when isPatrolling is false.
	let waypointIndex = 0;
	// Starts at 0, not `pauseSeconds` (fixed run 38, DECISIONS.md ADR-0045) — `patrolWaypoints[0]` is
	// always this NPC's own spawn point (see `spawnConfiguredNPCs`), so the very first `update()` call
	// resolves it as an immediate zero-distance "arrival" (a no-op) and *then* starts the real
	// `pauseSeconds` dwell before the first actual step. Pre-loading this to `pauseSeconds` would idle
	// a second, redundant full cycle before that first arrival ever gets checked.
	let pauseTimer = 0;

	return {
		object3D: model,
		// FAZ 5 interaction (run 33, ADR-0033): exposed so game3d.js's dialogue affordance can
		// address this NPC by name without a separate lookup back into NPC_CONFIG.SPAWNS.
		displayName: displayName ?? null,

		/** @param {number} delta Seconds since the last frame. */
		update(delta) {
			if (isPatrolling) {
				if (pauseTimer > 0) {
					pauseTimer -= delta;
					playAction(idleAction);
				} else {
					const target = patrolWaypoints[waypointIndex % patrolWaypoints.length];
					const dx = target.x - model.position.x;
					const dz = target.z - model.position.z;
					const distance = Math.hypot(dx, dz);
					const step = speedMps * delta;

					if (distance <= step) {
						model.position.x = target.x;
						model.position.z = target.z;
						model.position.y = groundCollider.getGroundHeight(target.x, target.z);
						waypointIndex += 1;
						pauseTimer = pauseSeconds;
						playAction(idleAction);
					} else {
						model.position.x += (dx / distance) * step;
						model.position.z += (dz / distance) * step;
						model.position.y = groundCollider.getGroundHeight(model.position.x, model.position.z);

						const targetYaw = Math.atan2(dx, dz);
						const turnStep = turnRateRadiansPerSecond * delta;
						model.rotation.y = THREE.MathUtils.lerp(
							model.rotation.y,
							model.rotation.y + THREE.MathUtils.euclideanModulo(targetYaw - model.rotation.y + Math.PI, Math.PI * 2) - Math.PI,
							Math.min(1, turnStep),
						);
						playAction(walkAction);
					}
				}
			}

			mixer.update(delta);
		},

		/** Stops all animation actions and releases the model's GPU resources. */
		dispose() {
			mixer.stopAllAction();
			AssetLoader.disposeObject3D(model);
		},
	};
}

/**
 * Resolves and loads every configured NPC spawn (`gameplayConfig.js`'s `NPC_CONFIG.SPAWNS`) against a
 * kingdom-seat lookup, in parallel — moved out of `game3d.js` (run 29, DECISIONS.md ADR-0028) to
 * keep that file a thin orchestrator, per this folder's own ownership convention (see
 * `gameplay/README.md`). A spawn referencing an unknown `seatId` is skipped with a console warning,
 * not thrown — matches `game3d.js`'s prior inline behavior exactly.
 * @param {object} options
 * @param {import('../assetLoader.js').AssetLoader} options.assetLoader
 * @param {typeof import('./gameplayConfig.js').NPC_CONFIG} options.npcConfig
 * @param {Map<string, {id: string, x: number, z: number}>} options.seatsById
 * @param {(worldX: number, worldZ: number) => number} options.sampleGroundY
 * @param {{getGroundHeight: (x: number, z: number) => number}} options.groundCollider
 * @returns {Promise<Awaited<ReturnType<typeof createNPC>>[]>} Already filtered — no `null` entries.
 */
export async function spawnConfiguredNPCs({ assetLoader, npcConfig, seatsById, sampleGroundY, groundCollider }) {
	const npcs = await Promise.all(
		npcConfig.SPAWNS.map(async (spawn) => {
			const seat = seatsById.get(spawn.seatId);
			if (!seat) {
				console.warn(`[gameplay/npc] NPC spawn "${spawn.id}" references unknown seat "${spawn.seatId}" — skipping.`);
				return null;
			}
			const worldX = seat.x + spawn.offsetXMeters;
			const worldZ = seat.z + spawn.offsetZMeters;
			const groundY = sampleGroundY(worldX, worldZ);
			const patrolWaypoints = spawn.patrol
				? [
						{ x: worldX, z: worldZ },
						{ x: seat.x + spawn.patrol.toOffsetXMeters, z: seat.z + spawn.patrol.toOffsetZMeters },
					]
				: undefined;
			return createNPC({
				assetLoader,
				modelUrl: spawn.modelUrl,
				idleAnimationUrl: npcConfig.IDLE_ANIMATION_URL,
				worldX,
				worldZ,
				groundY,
				rotationYRadians: spawn.rotationYRadians,
				name: spawn.id,
				displayName: spawn.displayName,
				nameTagWidthMeters: npcConfig.NAME_TAG_WIDTH_METERS,
				nameTagHeightMeters: npcConfig.NAME_TAG_HEIGHT_METERS,
				nameTagVerticalOffsetMeters: npcConfig.NAME_TAG_VERTICAL_OFFSET_METERS,
				groundCollider: patrolWaypoints ? groundCollider : undefined,
				walkAnimationUrl: patrolWaypoints ? npcConfig.WALK_ANIMATION_URL : undefined,
				patrolWaypoints,
				speedMps: npcConfig.PATROL_SPEED_MPS,
				pauseSeconds: npcConfig.PATROL_PAUSE_SECONDS,
				turnRateRadiansPerSecond: npcConfig.PATROL_TURN_RATE_RADIANS_PER_SECOND,
			});
		}),
	);
	return npcs.filter(Boolean);
}
