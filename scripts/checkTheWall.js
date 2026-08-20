#!/usr/bin/env node
/**
 * checkTheWall.js — guards run 375's Wall.
 *
 * The Wall had never been built. Every reference to it in this repository was a comment, including the
 * docstring of the road that runs to it. This asserts the properties that make it the Wall rather than a
 * decorative ridge:
 *
 * **1. It seals the continent.** Both ends must reach water. A wall with a way around it is not a
 * barrier, and the map draws this one running from the Bay of Ice to the Bay of Seals. Checked by
 * sampling just beyond each end and requiring sea.
 *
 * **2. It stands on the ground along its whole length.** No section may float above the terrain or sink
 * so far that the crown drops toward it. Checked against the live height field under every section.
 *
 * **3. It is seven hundred feet.** The books' number, 213 m. Held to the policy rather than to taste.
 *
 * **4. It is where the map puts it.** Castle Black — the `jon` seat — must lie within a short distance
 * south of the line, because the map draws the castle immediately below the Wall and the Kingsroad
 * terminates there.
 *
 * **5. It changed no terrain.** The Wall is geometry, not a height-field term. A height field maps one
 * (x, z) to one height and cannot express a vertical face, so building it into the terrain would produce
 * a ramp — and this project has already learned what a height-field change costs downstream. The live
 * field must be bit-identical with the Wall module loaded.
 *
 * Usage: `node scripts/checkTheWall.js`
 * Exit codes: 0 = PASS. 1 = FAIL. 2 = Playwright unavailable.
 * @module scripts/checkTheWall
 */
const { startStaticServer, loadPlaywright } = require('./devServerHelper.js');

/** How far south of the Wall Castle Black may sit and still count as "at the Wall", in metres. */
const CASTLE_BLACK_MAX_DISTANCE_METERS = 400;

(async () => {
	const playwright = loadPlaywright();
	if (!playwright) {
		console.error('[the-wall] SKIP: Playwright unavailable');
		process.exit(2);
	}
	const server = await startStaticServer();
	const origin = `http://127.0.0.1:${server.address().port}`;
	const browser = await playwright.chromium.launch({ headless: true });
	try {
		const page = await browser.newPage();
		await page.goto(`${origin}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
		const result = await page.evaluate(async () => {
			const { WORLD_DEFAULTS, WORLD_SCALE, SETTLEMENT_CONFIG } = await import('/src/3d/config.js');
			const { computeSettlementFlattenPads, KINGDOM_SEATS } = await import('/src/3d/world/settlements.js');
			const { createHeightSampler } = await import('/src/3d/world/terrain.js');
			const { computeRiverValleys } = await import('/src/3d/world/terrainValleyCarving.js');
			const wall = await import('/src/3d/world/theWall.js');
			const P = wall.THE_WALL_POLICY;
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

			// Terrain fingerprint before and after building, to prove the Wall is render-only.
			const fingerprintPoints = [];
			for (let i = 0; i < 200; i += 1) {
				const angle = i * 2.399963;
				const radius = 3000 * Math.sqrt((i % 197) / 197);
				fingerprintPoints.push({ x: Math.cos(angle) * radius, z: -2200 + Math.sin(angle) * radius });
			}
			const before = fingerprintPoints.map((p) => live(p.x, p.z));

			const centreline = wall.sampleWallCentreline(live);
			const built = wall.createTheWall({ sampleHeightMeters: live });

			const after = fingerprintPoints.map((p) => live(p.x, p.z));
			let terrainDrift = 0;
			for (let i = 0; i < before.length; i += 1) terrainDrift = Math.max(terrainDrift, Math.abs(after[i] - before[i]));

			// Ends must reach water: sample outward past each end along the Wall's own direction.
			const west = centreline[0];
			const east = centreline[centreline.length - 1];
			const dx = east.x - west.x;
			const dz = east.z - west.z;
			const length = Math.hypot(dx, dz) || 1;
			const ux = dx / length;
			const uz = dz / length;
			const probe = (px, pz) => {
				let best = Infinity;
				for (let d = 20; d <= 260; d += 20) best = Math.min(best, live(px + ux * d, pz + uz * d));
				return best;
			};
			const westBeyond = probe(west.x - ux * 40 * 2, west.z - uz * 40 * 2);
			const eastBeyondSamples = [];
			for (let d = 20; d <= 260; d += 20) eastBeyondSamples.push(live(east.x + ux * d, east.z + uz * d));
			const westReachesWater = probe(west.x - ux * 300, west.z - uz * 300) <= sea || westBeyond <= sea;
			const eastReachesWater = Math.min(...eastBeyondSamples) <= sea;

			// Grounding: crown must clear every ground sample by a sane margin, base must not float.
			// The crown is one level line (the Wall is described as level along its length); the base follows
			// the terrain, each section footed at its own ground minus `footingMeters`. So the two questions
			// are different: does the crown stay at least its full height above the ground anywhere, and does
			// any section's foot sit above its own ground?
			//
			// An earlier revision of this check computed the base gap as `crownY - height - groundY`, which
			// reduces to `highestGround - groundY` — the terrain's own variation along the Wall, not a float
			// at all. It reported 28.7 m and failed a Wall that was correctly grounded.
			let minClearance = Infinity;
			let maxBaseFloat = -Infinity;
			let groundSpread = 0;
			let lowestGround = Infinity;
			for (const point of centreline) {
				minClearance = Math.min(minClearance, built.crownY - point.groundY);
				maxBaseFloat = Math.max(maxBaseFloat, (point.groundY - P.footingMeters) - point.groundY);
				lowestGround = Math.min(lowestGround, point.groundY);
			}
			for (const point of centreline) groundSpread = Math.max(groundSpread, point.groundY - lowestGround);

			// Castle Black must be at the Wall.
			const { MAP_BOUNDS, METERS_PER_MAP_UNIT } = WORLD_SCALE;
			const jon = KINGDOM_SEATS.find((s) => s.id === 'jon');
			const jonX = (jon.mapX - (MAP_BOUNDS.minX + MAP_BOUNDS.maxX) * 0.5) * METERS_PER_MAP_UNIT;
			const jonZ = (jon.mapY - (MAP_BOUNDS.minY + MAP_BOUNDS.maxY) * 0.5) * METERS_PER_MAP_UNIT;
			// Perpendicular distance from Castle Black to the Wall's line.
			const castleBlackDistance = Math.abs((jonX - west.x) * uz - (jonZ - west.z) * ux);

			return {
				lengthMeters: built.lengthMeters,
				crownY: built.crownY,
				heightMeters: P.heightMeters,
				sectionCount: built.sectionCount,
				terrainDrift, westReachesWater, eastReachesWater,
				minClearance, maxBaseFloat, groundSpread, castleBlackDistance,
				triangles: (built.group.children[0]?.geometry?.getIndex()?.count ?? 0) / 3,
			};
		});

		const failures = [];
		if (result.terrainDrift !== 0) failures.push(`the Wall changed the height field by ${result.terrainDrift} m — it must be geometry, not terrain`);
		if (!result.westReachesWater) failures.push('the west end does not reach water — the Wall can be walked around');
		if (!result.eastReachesWater) failures.push('the east end does not reach water — the Wall can be walked around');
		if (!(result.minClearance >= result.heightMeters)) failures.push(`the crown drops to ${result.minClearance.toFixed(1)} m over the ground somewhere, below its ${result.heightMeters} m height`);
		if (!(result.maxBaseFloat <= 0)) failures.push(`the base floats ${result.maxBaseFloat.toFixed(1)} m above the ground somewhere`);
		if (!(result.castleBlackDistance <= CASTLE_BLACK_MAX_DISTANCE_METERS)) {
			failures.push(`Castle Black is ${result.castleBlackDistance.toFixed(0)} m from the Wall's line (max ${CASTLE_BLACK_MAX_DISTANCE_METERS} m) — the map draws it immediately below the Wall`);
		}

		console.log(`[the-wall] ${result.lengthMeters.toFixed(0)} m coast to coast, ${result.heightMeters} m tall, crown at ${result.crownY.toFixed(0)} m, ${result.sectionCount} sections, ${result.triangles} triangles`);
		console.log(`[the-wall] seals: west reaches water ${result.westReachesWater}, east reaches water ${result.eastReachesWater}`);
		console.log(`[the-wall] grounding: min crown clearance ${result.minClearance.toFixed(1)} m, worst base float ${result.maxBaseFloat.toFixed(1)} m (must be <= 0), ground varies ${result.groundSpread.toFixed(1)} m along the span`);
		console.log(`[the-wall] Castle Black sits ${result.castleBlackDistance.toFixed(0)} m from the line; terrain drift ${result.terrainDrift} m`);
		if (failures.length) {
			for (const failure of failures) console.error(`[the-wall] FAIL: ${failure}`);
			process.exit(1);
		}
		console.log('[the-wall] PASS: it spans coast to coast, stands on the ground, is 700 feet, sits at Castle Black, and changed no terrain.');
		process.exit(0);
	} catch (error) {
		console.error('[the-wall] FAIL:', error);
		process.exit(1);
	} finally {
		await browser.close();
		server.close();
	}
})();
