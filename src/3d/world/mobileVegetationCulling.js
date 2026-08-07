/**
 * Mobile-only whole-disc vegetation distance culling (run 141 / ADR-0165).
 *
 * Mobile currently has two deterministic vegetation discs: the legacy world-origin disc and the
 * run-135 player-spawn disc. Terrain itself is bounded and streams around the player, so a tree disc
 * that cannot intersect the currently resident terrain should not remain render-visible. This module
 * toggles whole groups only; it never mutates instance matrices, seeds, geometry, or desktop state.
 * @module world/mobileVegetationCulling
 */

import { CHUNK_CONFIG, MOBILE_VEGETATION_CULLING_CONFIG_RUN141 } from '../config.js';
import { MOBILE_LIVE_WORLD_RADIUS_CHUNKS } from './chunkManager.js';

/**
 * Returns the current culling geometry derived from the live mobile terrain radius.
 * The live-binding export in chunkManager.js is intentionally used instead of copying radius 4 here,
 * so a future additive radius increase can update one source of truth and this threshold follows it.
 * @returns {{residentTerrainRadiusMeters:number, vegetationDiscRadiusMeters:number, marginMeters:number, maxCenterDistanceMeters:number}}
 */
export function getMobileVegetationCullingDistancesRun141() {
	const residentTerrainRadiusMeters = MOBILE_LIVE_WORLD_RADIUS_CHUNKS * CHUNK_CONFIG.CHUNK_SIZE_METERS;
	const vegetationDiscRadiusMeters = CHUNK_CONFIG.STREAM_RADIUS_CHUNKS * CHUNK_CONFIG.CHUNK_SIZE_METERS;
	const marginMeters = MOBILE_VEGETATION_CULLING_CONFIG_RUN141.INTERSECTION_MARGIN_METERS;
	return Object.freeze({
		residentTerrainRadiusMeters,
		vegetationDiscRadiusMeters,
		marginMeters,
		maxCenterDistanceMeters: residentTerrainRadiusMeters + vegetationDiscRadiusMeters + marginMeters,
	});
}

/**
 * Pure visibility decision used by the runtime updater and regression test.
 * @param {number} playerX
 * @param {number} playerZ
 * @param {number} groupCenterX
 * @param {number} groupCenterZ
 * @returns {boolean}
 */
export function shouldShowMobileVegetationDiscRun141(playerX, playerZ, groupCenterX, groupCenterZ) {
	const { maxCenterDistanceMeters } = getMobileVegetationCullingDistancesRun141();
	return Math.hypot(playerX - groupCenterX, playerZ - groupCenterZ) <= maxCenterDistanceMeters;
}

/**
 * Applies whole-disc visibility on the mobile path only. Deterministic instance data stays resident
 * and is simply shown again when the player returns near the disc.
 * @param {{x:number,z:number}} playerPosition
 * @param {{id:string,group:{position:{x:number,z:number},visible:boolean,userData:object}|null}[]} entries
 * @param {boolean} isMobile
 */
export function updateMobileVegetationDistanceCullingRun141(playerPosition, entries, isMobile) {
	if (!isMobile) return;
	for (const entry of entries) {
		if (!entry.group) continue;
		const visible = shouldShowMobileVegetationDiscRun141(
			playerPosition.x,
			playerPosition.z,
			entry.group.position.x,
			entry.group.position.z,
		);
		const previous = entry.group.userData.mobileVegetationCullingRun141?.visible;
		entry.group.visible = visible;
		entry.group.userData.mobileVegetationCullingRun141 = Object.freeze({ visible, id: entry.id });
		if (previous !== visible) {
			console.info(`[mobileVegetationCulling] ${entry.id} ${visible ? 'visible' : 'hidden'}`);
		}
	}
}
