/**
 * Mobile-only vegetation-disc distance culling (run 138 / ADR-0162).
 *
 * The mobile scene can contain two deterministic vegetation discs: the legacy world-origin disc
 * and the run-135 player-spawn disc. Only discs that intersect the currently resident bounded
 * terrain neighborhood should remain visible. This keeps vegetation that sits over unloaded terrain
 * from consuming draw/triangle budget while preserving both deterministic scatters for when the
 * player approaches them again. Desktop behavior is explicitly unchanged.
 * @module world/mobileVegetationCulling
 */

import { MOBILE_VEGETATION_CULLING_CONFIG_RUN138 } from '../config.js';

/**
 * Pure visibility calculation used by the runtime updater and regression test.
 * @param {number} playerX
 * @param {number} playerZ
 * @param {number} groupCenterX
 * @param {number} groupCenterZ
 * @returns {boolean}
 */
export function shouldShowMobileVegetationDiscRun138(playerX, playerZ, groupCenterX, groupCenterZ) {
	const maxCenterDistance =
		MOBILE_VEGETATION_CULLING_CONFIG_RUN138.RESIDENT_TERRAIN_RADIUS_METERS +
		MOBILE_VEGETATION_CULLING_CONFIG_RUN138.VEGETATION_DISC_RADIUS_METERS +
		MOBILE_VEGETATION_CULLING_CONFIG_RUN138.INTERSECTION_MARGIN_METERS;
	return Math.hypot(playerX - groupCenterX, playerZ - groupCenterZ) <= maxCenterDistance;
}

/**
 * Applies mobile-only whole-disc visibility. State changes are logged once per transition so the
 * Playwright regression gate can prove the coarse-pointer runtime path is active without exposing
 * mutable scene state globally.
 * @param {{x:number,z:number}} playerPosition
 * @param {{id:string,group:{position:{x:number,z:number},visible:boolean,userData:object}|null}[]} entries
 * @param {boolean} isMobile
 */
export function updateMobileVegetationDistanceCullingRun138(playerPosition, entries, isMobile) {
	if (!isMobile) return;
	for (const entry of entries) {
		if (!entry.group) continue;
		const visible = shouldShowMobileVegetationDiscRun138(
			playerPosition.x,
			playerPosition.z,
			entry.group.position.x,
			entry.group.position.z,
		);
		const previous = entry.group.userData.mobileVegetationCullingRun138?.visible;
		entry.group.visible = visible;
		entry.group.userData.mobileVegetationCullingRun138 = Object.freeze({ visible, id: entry.id });
		if (previous !== visible) {
			console.info(`[mobileVegetationCulling] ${entry.id} ${visible ? 'visible' : 'hidden'}`);
		}
	}
}
