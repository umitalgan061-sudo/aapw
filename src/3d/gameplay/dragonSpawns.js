/**
 * Config-driven dragon spawn wiring (FAZ 7) — resolves `gameplayConfig.js`'s `DRAGON_CONFIG.SPAWNS`
 * against the kingdom-seat lookup and hands each entry to `dragonController.js`'s `createDragon`.
 * Split out of `gameplay/dragons.js` in run 71 when that single file hit the 600-line cap
 * (DECISIONS.md ADR-0092); `dragons.js` re-exports `spawnConfiguredDragons` from here, so
 * `game3d.js`'s existing import keeps working unchanged. Same "the gameplay folder owns its own
 * spawn wiring, `game3d.js` stays a thin orchestrator" split `gameplay/animals.js`'s
 * `spawnConfiguredAnimals` and `gameplay/npc.js`'s `spawnConfiguredNPCs` already follow (ADR-0028).
 * @module gameplay/dragonSpawns
 */

import { createDragon } from './dragonController.js';

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
 *   Each spawn's own `reactiveSpeedMultiplier`/`reactiveBankAngleRadians`/`reactiveTransitionSeconds`
 *   (run 58, ADR-0077) and `alarmRadiusMeters`/`diveDropMeters`/`diveLateralPullFraction`/
 *   `diveTransitionSeconds`/`minAltitudeAboveGroundMeters` (run 64, ADR-0082) and
 *   `pursuitRadiusMeters`/`pursuitCenterSpeedMps`/`pursuitCircleRadiusMeters`/
 *   `pursuitTransitionSeconds`/`pursuitMaxSeconds` (run 66, ADR-0085) and
 *   `agitatedWingFlapMultiplier` (run 70, ADR-0089) and
 *   `giveUpBankAngleMultiplier`/`giveUpTransitionSeconds` (run 71, ADR-0091) are passed straight
 *   through to `createDragon` — omitted per-spawn fields fall back to `createDragon`'s own no-op
 *   defaults (calm flight, unaffected by the player). `sampleGroundY` itself is always passed
 *   through too (run 64), needed for the dive's and the traveling circle's terrain-safety clamp.
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
				reactiveSpeedMultiplier: spawn.reactiveSpeedMultiplier,
				reactiveBankAngleRadians: spawn.reactiveBankAngleRadians,
				reactiveTransitionSeconds: spawn.reactiveTransitionSeconds,
				alarmRadiusMeters: spawn.alarmRadiusMeters,
				sampleGroundY,
				diveDropMeters: spawn.diveDropMeters,
				diveLateralPullFraction: spawn.diveLateralPullFraction,
				diveTransitionSeconds: spawn.diveTransitionSeconds,
				minAltitudeAboveGroundMeters: spawn.minAltitudeAboveGroundMeters,
				pursuitRadiusMeters: spawn.pursuitRadiusMeters,
				pursuitCenterSpeedMps: spawn.pursuitCenterSpeedMps,
				pursuitCircleRadiusMeters: spawn.pursuitCircleRadiusMeters,
				pursuitTransitionSeconds: spawn.pursuitTransitionSeconds,
				pursuitMaxSeconds: spawn.pursuitMaxSeconds,
				giveUpBankAngleMultiplier: spawn.giveUpBankAngleMultiplier,
				giveUpTransitionSeconds: spawn.giveUpTransitionSeconds,
				// The same number `centerY` above was resolved from — passed separately so the
				// traveling circle can re-derive its cruise altitude over new terrain (run 66).
				cruiseAltitudeAboveGroundMeters: spawn.altitudeMeters,
				agitatedWingFlapMultiplier: spawn.agitatedWingFlapMultiplier,
			});
		}),
	);
	return dragons.filter(Boolean);
}
