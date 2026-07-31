/**
 * Flying dragons (FAZ 7). First pass (run 53): a single dragon circling at a fixed altitude above
 * a kingdom seat, looping its real `Fly` animation clip — no rig/animation work needed since
 * `DRAGON_CONFIG.MODEL_URL` (`black_dragon`, Free3D) already ships a skeleton + baked clips, unlike
 * the unrigged Meshy/Hitem3d reference dragons (see `gameplayConfig.js`'s `DRAGON_CONFIG` doc
 * comment and DECISIONS.md ADR-0071). Deliberately the smallest thing that reads as "a dragon
 * patrols the sky": a closed circular path at constant altitude, no ground collision, no
 * pathfinding — same scope discipline `gameplay/animals.js`'s first straight-line patrol pass set
 * for FAZ 6. Run 54 (DECISIONS.md ADR-0072) adds the first player-awareness: an edge-triggered
 * one-shot "notice" event through the shared `EventBus` when the player enters `noticeRadiusMeters`
 * of the dragon's real, current 3D position — the flight path itself is still untouched by it (no
 * diving/chasing/fleeing), same "awareness before behavior change" order FAZ 6's wolves went
 * through (flee trigger existed before pack-alert). `game3d.js` wires this in the same
 * spawn-then-per-frame-update shape every other gameplay system already uses.
 * @module gameplay/dragons
 */

import * as THREE from 'three';
import { AssetLoader } from '../assetLoader.js';

/**
 * Loads the dragon model, places it on its circling flight path, and returns a small controller
 * object matching this project's usual `{object3D, update(delta), dispose()}` shape (see
 * `gameplay/animals.js`'s `createWolf`, `gameplay/npc.js`'s `createNPC`).
 * @param {object} options
 * @param {import('../assetLoader.js').AssetLoader} options.assetLoader
 * @param {string} options.modelUrl
 * @param {string} [options.texturesResourcePath] See `AssetLoader.loadFBXModel`'s `resourcePath` option.
 * @param {number} options.scale Uniform scale applied to the loaded model — see `DRAGON_CONFIG.SCALE`'s doc comment for why this can't reuse `AssetLoader.correctMixamoFbxScale`.
 * @param {string} options.flyClipName Exact `THREE.AnimationClip` name to loop.
 * @param {number} options.centerX World-space circle-center X (a kingdom seat's own position).
 * @param {number} options.centerZ World-space circle-center Z.
 * @param {number} options.centerY World-space altitude the dragon flies at (already
 *   ground-height + `altitudeMeters` — resolved by the caller, same convention
 *   `spawnConfiguredAnimals` uses for `sampleGroundY`).
 * @param {number} options.circleRadiusMeters
 * @param {number} options.speedMps Tangential speed around the circle.
 * @param {number} [options.bankAngleRadians] Constant visual roll while circling.
 * @param {number} [options.startAngleRadians] Initial position on the circle (radians).
 * @param {string} [options.name] Assigned to the loaded `Object3D` (useful for debugging/tests).
 * @param {number} [options.noticeRadiusMeters] Player-awareness (run 54, ADR-0072): when the player
 *   comes within this many meters of the dragon's real, current 3D position, `eventsBus.emit(
 *   eventName, noticeToast)` fires once — edge-triggered, re-arms only after the player leaves the
 *   radius again. Omit (along with `eventsBus`/`eventName`/`noticeToast`) to disable entirely — the
 *   controller then never reads `update()`'s `playerPosition` argument at all.
 * @param {import('../eventBus.js').EventBus} [options.eventsBus]
 * @param {string} [options.eventName] `EVENTS.WORLD_EVENT_TRIGGERED`, passed in rather than imported
 *   — same options-over-import precedent `gameplay/worldEvents.js` itself uses.
 * @param {{icon: string, title: string, desc: string, color: string}} [options.noticeToast] Payload
 *   emitted as-is — matches `ui/worldEventToast.js`'s existing `_show(event)` shape, so no new UI
 *   widget is needed for this first player-awareness pass.
 * @returns {Promise<{object3D: THREE.Object3D, update: (delta: number, playerPosition?: {x: number, y: number, z: number}) => void, dispose: () => void}>}
 */
export async function createDragon({
	assetLoader,
	modelUrl,
	texturesResourcePath,
	scale,
	flyClipName,
	centerX,
	centerZ,
	centerY,
	circleRadiusMeters,
	speedMps,
	bankAngleRadians = 0,
	startAngleRadians = 0,
	name,
	noticeRadiusMeters,
	eventsBus,
	eventName,
	noticeToast,
}) {
	const model = await assetLoader.loadFBXModel(modelUrl, {
		fallbackColor: 0x2a2a2a,
		fallbackSize: 6,
		resourcePath: texturesResourcePath,
	});
	model.scale.setScalar(scale);
	if (name) model.name = name;

	const mixer = new THREE.AnimationMixer(model);
	const flyClip = THREE.AnimationClip.findByName(model.animations, flyClipName);
	const flyAction = flyClip ? mixer.clipAction(flyClip) : null;
	if (flyAction) flyAction.play();

	// Angular speed, not linear — constant so a shorter/longer radius never changes how fast the
	// dragon completes one lap in the same tuned "majestic patrol" feel (see DRAGON_CONFIG's own
	// speed/radius comment for the resulting ~0.08 rad/s at the default spawn).
	const angularSpeedRadiansPerSecond = speedMps / circleRadiusMeters;
	let angle = startAngleRadians;

	/** Places `model` at the current `angle` on its circle and orients it along the direction of travel. */
	function applyPose() {
		const x = centerX + circleRadiusMeters * Math.sin(angle);
		const z = centerZ + circleRadiusMeters * Math.cos(angle);
		model.position.set(x, centerY, z);
		// Tangent direction of a circle parameterized by (sin, cos) is (cos, -sin) — the same
		// atan2(dx, dz) yaw convention every other gameplay system here already uses (see
		// `gameplay/animals.js`'s `turnToward`), just derived analytically instead of from a
		// per-frame position delta since the path itself is a closed-form circle.
		const tangentX = Math.cos(angle);
		const tangentZ = -Math.sin(angle);
		model.rotation.set(0, Math.atan2(tangentX, tangentZ), bankAngleRadians);
	}
	applyPose();

	const canNotice = Boolean(noticeRadiusMeters != null && eventsBus && eventName && noticeToast);
	// Starts false: the very first `update()` call (typically seconds after boot) does its own
	// real distance check before deciding whether the player already started inside the radius —
	// never assumed true/false up front.
	let playerWasInNoticeRadius = false;

	return {
		object3D: model,

		/**
		 * @param {number} delta Seconds since the last frame.
		 * @param {{x: number, y: number, z: number}} [playerPosition] Current player world position —
		 *   only read when this dragon has player-awareness configured (`noticeRadiusMeters`).
		 */
		update(delta, playerPosition) {
			angle += angularSpeedRadiansPerSecond * delta;
			applyPose();
			mixer.update(delta);

			if (canNotice && playerPosition) {
				const dx = model.position.x - playerPosition.x;
				const dy = model.position.y - playerPosition.y;
				const dz = model.position.z - playerPosition.z;
				const isInRadius = Math.hypot(dx, dy, dz) < noticeRadiusMeters;
				if (isInRadius && !playerWasInNoticeRadius) {
					eventsBus.emit(eventName, noticeToast);
				}
				playerWasInNoticeRadius = isInRadius;
			}
		},

		/** Stops all animation actions and releases the model's GPU resources. */
		dispose() {
			mixer.stopAllAction();
			AssetLoader.disposeObject3D(model);
		},
	};
}

/**
 * Resolves and loads every configured dragon spawn (`gameplayConfig.js`'s `DRAGON_CONFIG.SPAWNS`)
 * against a kingdom-seat lookup, in parallel — same shape as `gameplay/animals.js`'s
 * `spawnConfiguredAnimals` / `gameplay/npc.js`'s `spawnConfiguredNPCs`, keeping `game3d.js` a thin
 * orchestrator. A spawn referencing an unknown `seatId` is skipped with a console warning, not
 * thrown, matching both of those modules' existing behavior.
 * @param {object} options
 * @param {import('../assetLoader.js').AssetLoader} options.assetLoader
 * @param {typeof import('./gameplayConfig.js').DRAGON_CONFIG} options.dragonConfig
 * @param {Map<string, {id: string, x: number, z: number}>} options.seatsById
 * @param {(worldX: number, worldZ: number) => number} options.sampleGroundY
 * @param {import('../eventBus.js').EventBus} [options.eventsBus] Player-awareness (ADR-0072) — see
 *   `createDragon`'s own doc comment. Omit to spawn every configured dragon with awareness disabled.
 * @param {string} [options.eventName] `EVENTS.WORLD_EVENT_TRIGGERED`.
 * @returns {Promise<Awaited<ReturnType<typeof createDragon>>[]>} Already filtered — no `null` entries.
 */
export async function spawnConfiguredDragons({ assetLoader, dragonConfig, seatsById, sampleGroundY, eventsBus, eventName }) {
	const dragons = await Promise.all(
		dragonConfig.SPAWNS.map(async (spawn) => {
			const seat = seatsById.get(spawn.seatId);
			if (!seat) {
				console.warn(`[gameplay/dragons] Dragon spawn "${spawn.id}" references unknown seat "${spawn.seatId}" — skipping.`);
				return null;
			}
			return createDragon({
				assetLoader,
				modelUrl: dragonConfig.MODEL_URL,
				texturesResourcePath: dragonConfig.TEXTURES_RESOURCE_PATH,
				scale: dragonConfig.SCALE,
				flyClipName: dragonConfig.FLY_CLIP_NAME,
				centerX: seat.x,
				centerZ: seat.z,
				centerY: sampleGroundY(seat.x, seat.z) + spawn.altitudeMeters,
				circleRadiusMeters: spawn.circleRadiusMeters,
				speedMps: spawn.speedMps,
				bankAngleRadians: spawn.bankAngleRadians,
				name: spawn.id,
				noticeRadiusMeters: spawn.noticeRadiusMeters,
				eventsBus,
				eventName,
				noticeToast: spawn.noticeToast,
			});
		}),
	);
	return dragons.filter(Boolean);
}
