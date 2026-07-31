/**
 * Flying dragons (FAZ 7). First pass (run 53): a single dragon circling at a fixed altitude above
 * a kingdom seat, looping its real `Fly` animation clip — no rig/animation work needed since
 * `DRAGON_CONFIG.MODEL_URL` (`black_dragon`, Free3D) already ships a skeleton + baked clips, unlike
 * the unrigged Meshy/Hitem3d reference dragons (see `gameplayConfig.js`'s `DRAGON_CONFIG` doc
 * comment and DECISIONS.md ADR-0071). Deliberately the smallest thing that reads as "a dragon
 * patrols the sky": a closed circular path at constant altitude, no ground collision, no
 * pathfinding, no player-awareness — same scope discipline `gameplay/animals.js`'s first
 * straight-line patrol pass set for FAZ 6. `game3d.js` wires this in the same
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
 * @returns {Promise<{object3D: THREE.Object3D, update: (delta: number) => void, dispose: () => void}>}
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

	return {
		object3D: model,

		/** @param {number} delta Seconds since the last frame. */
		update(delta) {
			angle += angularSpeedRadiansPerSecond * delta;
			applyPose();
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
 * @returns {Promise<Awaited<ReturnType<typeof createDragon>>[]>} Already filtered — no `null` entries.
 */
export async function spawnConfiguredDragons({ assetLoader, dragonConfig, seatsById, sampleGroundY }) {
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
			});
		}),
	);
	return dragons.filter(Boolean);
}
