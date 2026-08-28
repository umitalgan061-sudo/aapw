#!/usr/bin/env node
/**
 * checkNightsWatchCastles.js — guards run 378's Night's Watch castles.
 *
 * The Wall went up in run 375 with nobody on it. This holds what was then built on it to the facts in
 * `docs/westeros-lore-reference.md`, and to the things that are wrong in ways a screenshot from one
 * angle would not show:
 *
 * **1. Three castles, the three that are still manned.** The Shadow Tower, Castle Black, and
 * Eastwatch-by-the-Sea. Not nineteen: the other sixteen are ruins in the story, and quietly rendering
 * three where nineteen belong is a decision that should stay visible rather than drift.
 *
 * **2. Everything stands on the south side.** The Wall's whole purpose is that its north face is the one
 * nothing crosses. A keep, a stair or a winch frame on the wrong side is not a cosmetic error — it is a
 * hole in the premise. Checked against the Wall's own centreline, per structure, not per castle.
 *
 * **3. Castle Black is at Castle Black.** Its position is derived from the `jon` kingdom seat rather
 * than transcribed a second time, so this asserts the derivation actually landed: the yard must be near
 * that seat, which `world/settlements.js` places from the owner map.
 *
 * **4. The King's Tower is a hundred feet.** The books' number, 30 m. Held to the policy, like the
 * Wall's own 213 m.
 *
 * **5. The stair reaches the top.** A stair up the Wall that stops short is worse than no stair. Its
 * highest flight must arrive within a flight's rise of the crown, and its lowest must start near the
 * yard — measured from the built geometry, not from the numbers that generated it.
 *
 * **6. Nothing floats.** Every ground-standing structure is checked against the live height field
 * beneath it. The stair and the winch cage are exempt by construction: they hang on the Wall's face.
 *
 * **7. It changed no terrain.** Same contract as the Wall — geometry, not a height-field term.
 *
 * **8. It is deterministic.** Two builds produce identical positions.
 *
 * Usage: `node scripts/checkNightsWatchCastles.js`
 * Exit codes: 0 = PASS. 1 = FAIL. 2 = Playwright unavailable.
 * @module scripts/checkNightsWatchCastles
 */
const { startStaticServer, loadPlaywright } = require('./devServerHelper.js');

/** How far Castle Black's yard may sit from the `jon` seat, in metres. */
const CASTLE_BLACK_MAX_SEAT_DISTANCE_METERS = 260;
/** Metres a ground-standing structure's base may sit above the ground beneath it. */
const MAX_STRUCTURE_FLOAT_METERS = 2.5;

(async () => {
	const playwright = loadPlaywright();
	if (!playwright) {
		console.error('[nights-watch] SKIP: Playwright unavailable');
		process.exit(2);
	}
	const server = await startStaticServer();
	const origin = `http://127.0.0.1:${server.address().port}`;
	const browser = await playwright.chromium.launch({ headless: true });
	try {
		const page = await browser.newPage();
		await page.goto(`${origin}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
		const result = await page.evaluate(async ({ maxFloat }) => {
			const THREE = await import('three');
			const { WORLD_DEFAULTS, WORLD_SCALE, SETTLEMENT_CONFIG } = await import('/src/3d/config.js');
			const { computeSettlementFlattenPads, KINGDOM_SEATS } = await import('/src/3d/world/settlements.js');
			const { createHeightSampler } = await import('/src/3d/world/terrain.js');
			const { computeRiverValleys } = await import('/src/3d/world/terrainValleyCarving.js');
			const wall = await import('/src/3d/world/theWall.js');
			const nw = await import('/src/3d/world/nightsWatchCastles.js');

			const sea = WORLD_DEFAULTS.WATER_LEVEL_METERS;
			const raw = createHeightSampler(WORLD_DEFAULTS.WORLD_SEED);
			const pads = computeSettlementFlattenPads({
				sampleHeightMeters: raw, seaLevelMeters: sea,
				minGroundClearanceMeters: SETTLEMENT_CONFIG.MIN_GROUND_CLEARANCE_METERS,
				mapBounds: WORLD_SCALE.MAP_BOUNDS, metersPerMapUnit: WORLD_SCALE.METERS_PER_MAP_UNIT,
			});
			const pre = createHeightSampler(WORLD_DEFAULTS.WORLD_SEED, undefined, pads);
			const valleys = computeRiverValleys({ seed: WORLD_DEFAULTS.WORLD_SEED, baseSampleHeightMeters: pre, seaLevelMeters: sea });
			const live = createHeightSampler(WORLD_DEFAULTS.WORLD_SEED, undefined, pads, null, valleys);

			// Terrain fingerprint either side of building, to prove this is render-only.
			const fingerprint = [];
			for (let i = 0; i < 200; i += 1) {
				const angle = i * 2.399963;
				const radius = 1200 * Math.sqrt((i % 197) / 197);
				fingerprint.push({ x: -4200 + Math.cos(angle) * radius, z: -3470 + Math.sin(angle) * radius });
			}
			const before = fingerprint.map((p) => live(p.x, p.z));

			const centreline = wall.sampleWallCentreline(live);
			const built = nw.createNightsWatchCastles({ sampleHeightMeters: live });
			const again = nw.createNightsWatchCastles({ sampleHeightMeters: live });

			const after = fingerprint.map((p) => live(p.x, p.z));
			let terrainDrift = 0;
			for (let i = 0; i < before.length; i += 1) terrainDrift = Math.max(terrainDrift, Math.abs(after[i] - before[i]));

			// The Wall's axis, and which way is south.
			const west = centreline[0];
			const east = centreline[centreline.length - 1];
			const dx = east.x - west.x;
			const dz = east.z - west.z;
			const length = Math.hypot(dx, dz) || 1;
			const alongX = dx / length;
			const alongZ = dz / length;
			let southX = -alongZ;
			let southZ = alongX;
			if (southZ < 0) { southX = -southX; southZ = -southZ; }

			// Signed distance south of the Wall's line for every structure's centre.
			let worstNorthMeters = 0;
			let northSideStructures = 0;
			let structureCount = 0;
			let worstFloatMeters = -Infinity;
			let floatingStructures = 0;
			let groundedChecked = 0;
			let stairTopY = -Infinity;
			let stairBottomY = Infinity;
			const box = new THREE.Box3();
			for (const node of built.group.children) {
				if (!node.isMesh) continue;
				structureCount += 1;
				node.updateMatrixWorld(true);
				box.setFromObject(node);
				const cx = (box.min.x + box.max.x) / 2;
				const cz = (box.min.z + box.max.z) / 2;
				// Distance from the Wall's line, positive to the south.
				const southOffset = (cx - west.x) * southX + (cz - west.z) * southZ;
				if (southOffset < -0.5) {
					northSideStructures += 1;
					worstNorthMeters = Math.min(worstNorthMeters, southOffset);
				}
				// The stair and winch hang on the Wall's face; measure their span, not their grounding.
				if (southOffset < wall.THE_WALL_POLICY.thicknessMeters) {
					stairTopY = Math.max(stairTopY, box.max.y);
					stairBottomY = Math.min(stairBottomY, box.min.y);
				}
				// Only pieces that rest on the terrain are held to it. A merlon 30 m up a tower is not
				// floating, and an earlier revision of this check counted 36 of them as though it were.
				// The builder marks its own ground-standing pieces; see `addMesh` in nightsWatchCastles.js.
				if (!node.userData.standsOnGround) continue;
				groundedChecked += 1;
				const float = box.min.y - live(cx, cz);
				if (float > maxFloat) floatingStructures += 1;
				worstFloatMeters = Math.max(worstFloatMeters, float);
			}

			// Castle Black against its seat.
			const { MAP_BOUNDS, METERS_PER_MAP_UNIT } = WORLD_SCALE;
			const jon = KINGDOM_SEATS.find((s) => s.id === 'jon');
			const jonX = (jon.mapX - (MAP_BOUNDS.minX + MAP_BOUNDS.maxX) * 0.5) * METERS_PER_MAP_UNIT;
			const jonZ = (jon.mapY - (MAP_BOUNDS.minY + MAP_BOUNDS.maxY) * 0.5) * METERS_PER_MAP_UNIT;
			const black = built.castles.find((c) => c.id === 'castle-black');
			const seatDistance = Math.hypot(black.x - jonX, black.z - jonZ);

			// The King's Tower's height, measured off the tallest cylinder in the garrison's cluster.
			let kingsTowerHeight = 0;
			for (const node of built.group.children) {
				if (!node.isMesh || node.geometry.type !== 'CylinderGeometry') continue;
				node.updateMatrixWorld(true);
				box.setFromObject(node);
				const cx = (box.min.x + box.max.x) / 2;
				const cz = (box.min.z + box.max.z) / 2;
				if (Math.hypot(cx - black.x, cz - black.z) > 40) continue;
				kingsTowerHeight = Math.max(kingsTowerHeight, box.max.y - box.min.y);
			}

			const digest = (result) => result.castles.map((c) => `${c.id}:${c.x.toFixed(3)}:${c.z.toFixed(3)}`).join('|');

			return {
				castleIds: built.castles.map((c) => c.id),
				castleNames: built.castles.map((c) => c.name),
				structureCount, northSideStructures, worstNorthMeters,
				floatingStructures, worstFloatMeters, groundedChecked,
				terrainDrift, seatDistance, kingsTowerHeight,
				crownY: built.crownY,
				policyTowerHeight: nw.NIGHTS_WATCH_POLICY.kingsTowerHeightMeters,
				flightRise: (built.crownY - black.groundY) / nw.NIGHTS_WATCH_POLICY.stairFlightCount,
				stairTopY, stairBottomY, yardY: black.groundY,
				deterministic: digest(built) === digest(again),
			};
		}, { maxFloat: MAX_STRUCTURE_FLOAT_METERS });

		const expected = ['shadow-tower', 'castle-black', 'eastwatch'];
		const failures = [];
		if (result.castleIds.join(',') !== expected.join(',')) {
			failures.push(`castles are [${result.castleIds.join(', ')}], expected the three manned ones [${expected.join(', ')}]`);
		}
		if (result.northSideStructures > 0) {
			failures.push(`${result.northSideStructures} structure(s) stand on the NORTH side of the Wall, worst ${result.worstNorthMeters.toFixed(1)} m — the north face is the one nothing crosses`);
		}
		if (!(result.seatDistance <= CASTLE_BLACK_MAX_SEAT_DISTANCE_METERS)) {
			failures.push(`Castle Black's yard is ${result.seatDistance.toFixed(0)} m from the jon seat (max ${CASTLE_BLACK_MAX_SEAT_DISTANCE_METERS} m)`);
		}
		if (Math.abs(result.kingsTowerHeight - result.policyTowerHeight) > 1.5) {
			failures.push(`the King's Tower measures ${result.kingsTowerHeight.toFixed(1)} m, not its ${result.policyTowerHeight} m (a hundred feet)`);
		}
		if (!(result.stairTopY >= result.crownY - result.flightRise)) {
			failures.push(`the stair stops at ${result.stairTopY.toFixed(1)} m, short of the ${result.crownY.toFixed(1)} m crown`);
		}
		if (!(result.stairBottomY <= result.yardY + result.flightRise)) {
			failures.push(`the stair starts at ${result.stairBottomY.toFixed(1)} m, well above the ${result.yardY.toFixed(1)} m yard`);
		}
		if (result.floatingStructures > 0) {
			failures.push(`${result.floatingStructures}/${result.groundedChecked} ground-standing structures float, worst ${result.worstFloatMeters.toFixed(1)} m`);
		}
		if (result.terrainDrift !== 0) failures.push(`building the castles changed the height field by ${result.terrainDrift} m`);
		if (!result.deterministic) failures.push('two builds produced different castle positions');

		console.log(`[nights-watch] ${result.castleNames.join(', ')} — ${result.structureCount} structures, Wall crown ${result.crownY.toFixed(0)} m`);
		console.log(`[nights-watch] sides: ${result.northSideStructures} structure(s) north of the Wall (must be 0); Castle Black ${result.seatDistance.toFixed(0)} m from its seat`);
		console.log(`[nights-watch] King's Tower ${result.kingsTowerHeight.toFixed(1)} m (policy ${result.policyTowerHeight} m); stair runs ${result.stairBottomY.toFixed(0)} m -> ${result.stairTopY.toFixed(0)} m against a ${result.yardY.toFixed(0)}..${result.crownY.toFixed(0)} m climb`);
		console.log(`[nights-watch] grounding: worst float ${result.worstFloatMeters.toFixed(2)} m over ${result.groundedChecked} structures; terrain drift ${result.terrainDrift} m; deterministic ${result.deterministic}`);
		if (failures.length) {
			for (const failure of failures) console.error(`[nights-watch] FAIL: ${failure}`);
			process.exit(1);
		}
		console.log('[nights-watch] PASS: the three manned castles stand south of the Wall, Castle Black is at its seat, the tower is a hundred feet, the stair reaches the crown, and no terrain moved.');
		process.exit(0);
	} catch (error) {
		console.error('[nights-watch] FAIL:', error);
		process.exit(1);
	} finally {
		await browser.close();
		server.close();
	}
})();
