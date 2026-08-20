#!/usr/bin/env node
/**
 * checkNamedRivers.js — guards run 376's named rivers.
 *
 * **The bug this exists to catch already happened.** Run 376 added ten map-read headwaters and every
 * downstream gate went green: `terrainSeatSafetyCheck` unchanged, `roadNetworkSafetyCheck` reporting a
 * road network byte-identical to its baseline. That looked like a clean landing. It was the opposite —
 * `generateRiverPath` bounded its walk with `hypot(bestX, bestZ)`, distance from the *world* origin,
 * written when there was one river whose origin was (0, 0) and the two expressions were the same. Every
 * Westeros headwater sits 4.5-5.0 km from the world origin, past the 2800 m default, so eight of the ten
 * rivers broke out of the walk on their first step, returned a one-point path, and were silently dropped
 * by `computeRiverValleys`'s `points.length < 2` guard. Nothing carved, so nothing downstream moved, so
 * every check passed. **A river that traces nothing is invisible to every other gate in this project.**
 * That is what this file is for.
 *
 * What it asserts:
 *
 * **1. Every named river traces.** All ten, not "most". A river reduced to a stub is the exact silent
 * failure above, and the count is the only place it shows.
 *
 * **2. Every one reaches the sea.** `endReason === 'sea'`. A river ending in `local-minimum` has run
 * into a hollow and stopped; one ending in `bounds` has hit the walk limit — the run-376 bug's own
 * signature. Rivers end in the sea.
 *
 * **3. Every mouth is in canonical water.** Reaching sea *level* is not the same as reaching the sea: a
 * closed inland pit below sea level would satisfy the height test and still be wrong. The mouth is
 * checked against `map.png`'s own water mask, the one thing this project does not move.
 *
 * **4. Every source is on canonical land.** A river rising offshore is a transcription error.
 *
 * **5. The carve actually reaches the ground.** The composed valley field must cut measurably more than
 * the same field with no named rivers. This is the assertion that would have failed loudest in run 376.
 *
 * **6. The water is not buried.** The first render of this feature showed the Mander as a dashed line
 * of disconnected blue patches: the ribbon followed the traced polyline's 40 m chords while the ground
 * between those points rose as much as 28 m through it, leaving 23-63% of every river underground. So
 * the ribbon centreline is walked at 4 m and every sample must have its water surface at or above the
 * ground. No height-field gate can see this — the terrain is correct; it is the water that is wrong.
 *
 * **7. The water is not perched.** The opposite failure: a ribbon draped over open hillside, its edges
 * hanging in the air. Checked at the ribbon's own bank vertices, with enough allowance for a genuine
 * pool — where a course crosses a rise, `buildRiverSurface` ponds behind it on purpose.
 *
 * **8. It is deterministic.** Two builds of the same seed produce identical courses.
 *
 * Usage: `node scripts/checkNamedRivers.js`
 * Exit codes: 0 = PASS. 1 = FAIL. 2 = Playwright unavailable.
 * @module scripts/checkNamedRivers
 */
const { startStaticServer, loadPlaywright } = require('./devServerHelper.js');

/**
 * Metres a ribbon's bank vertex may stand above the ground beneath it.
 *
 * Not zero: water has depth, and `buildRiverSurface` deliberately ponds where a course crosses a rise,
 * so a genuine pool's banks stand well above their own bed. This is set to catch the different failure
 * — a ribbon draped across open hillside — which shows up as tens of metres, not ones.
 */
const MAX_RIBBON_PERCH_METERS = 30;
/**
 * Fraction of a ribbon's length that may be underground.
 *
 * The failure this guards measured **23-63%**; the fix brought it to **0.32%**. Set at 1% rather than
 * hard against the current reading: it still catches the real defect by more than twenty times over,
 * while leaving enough headroom that an unrelated metre of terrain noise cannot turn the gate red for
 * no reason. A gate that cries wolf gets ignored, which is worse than one set slightly loose.
 */
const MAX_BURIED_SHARE = 0.01;
/**
 * Triangle ceiling for all ten ribbons together (GOVERNANCE.md §4).
 *
 * The ribbons are the one part of this feature with a per-frame cost — the valleys are terrain and are
 * paid for by chunks that already existed. Ten flat quad strips at one cross-section every 8 m is a
 * rounding error against the world's budget, but the spacing is a tunable, and halving it doubles this.
 * The ceiling is here so that trade is made deliberately rather than discovered on a phone.
 */
const MAX_RIVER_TRIANGLES = 20000;
/** Fraction of the 800 m disc around a mouth that must be canonical water for it to be a real coast. */
const MIN_MOUTH_WATER_SHARE = 0.15;

(async () => {
	const playwright = loadPlaywright();
	if (!playwright) {
		console.error('[named-rivers] SKIP: Playwright unavailable');
		process.exit(2);
	}
	const server = await startStaticServer();
	const origin = `http://127.0.0.1:${server.address().port}`;
	const browser = await playwright.chromium.launch({ headless: true });
	try {
		const page = await browser.newPage();
		await page.goto(`${origin}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
		const result = await page.evaluate(async ({ maxPerch }) => {
			const { WORLD_DEFAULTS, WORLD_SCALE, SETTLEMENT_CONFIG } = await import('/src/3d/config.js');
			const { computeSettlementFlattenPads } = await import('/src/3d/world/settlements.js');
			const { createHeightSampler } = await import('/src/3d/world/terrain.js');
			const { computeRiverValleys } = await import('/src/3d/world/terrainValleyCarving.js');
			const { generateRiverPath, createNamedRiverMeshes, NAMED_RIVER_SEED_TAG } = await import('/src/3d/world/rivers.js');
			const { allRiverHeadwaters, REFERENCE_RIVERS } = await import('/src/3d/world/worldReferenceRivers.js');
			const { sampleReferenceWaterMask } = await import('/src/3d/world/worldReferenceWaterMask.js');
			const { WORLD_REFERENCE_ALIGNMENT } = await import('/src/3d/world/worldReferenceAlignment.js');

			const sea = WORLD_DEFAULTS.WATER_LEVEL_METERS;
			const { MAP_BOUNDS, METERS_PER_MAP_UNIT } = WORLD_SCALE;
			const toNormalized = (x, z) => [
				(x / METERS_PER_MAP_UNIT + (MAP_BOUNDS.minX + MAP_BOUNDS.maxX) * 0.5) / WORLD_REFERENCE_ALIGNMENT.mapCanvasWidthUnits,
				(z / METERS_PER_MAP_UNIT + (MAP_BOUNDS.minY + MAP_BOUNDS.maxY) * 0.5) / WORLD_REFERENCE_ALIGNMENT.mapCanvasHeightUnits,
			];

			const raw = createHeightSampler(WORLD_DEFAULTS.WORLD_SEED);
			const pads = computeSettlementFlattenPads({
				sampleHeightMeters: raw, seaLevelMeters: sea,
				minGroundClearanceMeters: SETTLEMENT_CONFIG.MIN_GROUND_CLEARANCE_METERS,
				mapBounds: MAP_BOUNDS, metersPerMapUnit: METERS_PER_MAP_UNIT,
			});
			const phase1 = createHeightSampler(WORLD_DEFAULTS.WORLD_SEED, undefined, pads);

			const withRivers = computeRiverValleys({ seed: WORLD_DEFAULTS.WORLD_SEED, baseSampleHeightMeters: phase1, seaLevelMeters: sea });
			const withoutRivers = computeRiverValleys({ seed: WORLD_DEFAULTS.WORLD_SEED, baseSampleHeightMeters: phase1, seaLevelMeters: sea, headwaters: [] });
			const again = computeRiverValleys({ seed: WORLD_DEFAULTS.WORLD_SEED, baseSampleHeightMeters: phase1, seaLevelMeters: sea });
			const live = createHeightSampler(WORLD_DEFAULTS.WORLD_SEED, undefined, pads, null, withRivers);

			// Per-river facts, from the same trace the carve uses.
			const rivers = [];
			for (const headwater of allRiverHeadwaters()) {
				const { points, endReason } = generateRiverPath({
					seed: WORLD_DEFAULTS.WORLD_SEED ^ NAMED_RIVER_SEED_TAG,
					sampleHeightMeters: phase1, seaLevelMeters: sea,
					originX: headwater.x, originZ: headwater.z, searchRadiusMeters: headwater.searchRadiusMeters,
				});
				const source = points[0];
				const mouth = points[points.length - 1];
				let lengthMeters = 0;
				for (let i = 1; i < points.length; i += 1) lengthMeters += Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z);
				// Is the mouth on a real coast, or in an isolated pit that happens to be below sea level?
				let waterSamples = 0;
				for (let i = 0; i < 400; i += 1) {
					const angle = i * 2.399963;
					const radius = 800 * Math.sqrt((i % 397) / 397);
					if (sampleReferenceWaterMask(...toNormalized(mouth.x + Math.cos(angle) * radius, mouth.z + Math.sin(angle) * radius))) waterSamples += 1;
				}
				rivers.push({
					id: headwater.id, pointCount: points.length, endReason,
					lengthMeters, sourceY: source.y, mouthY: mouth.y,
					sourceOnLand: !sampleReferenceWaterMask(...toNormalized(source.x, source.z)),
					mouthInWater: sampleReferenceWaterMask(...toNormalized(mouth.x, mouth.z)),
					mouthWaterShare: waterSamples / 400,
				});
			}

			// Does the carve reach the ground the game renders?
			let cutSamples = 0;
			let landSamples = 0;
			let deepestCutMeters = 0;
			for (let i = 0; i < 30000; i += 1) {
				const angle = i * 2.399963;
				const radius = 7000 * Math.sqrt((i % 2999) / 2999);
				const x = Math.cos(angle) * radius;
				const z = Math.sin(angle) * radius;
				const natural = phase1(x, z);
				if (natural <= sea) continue;
				landSamples += 1;
				const cut = withoutRivers.sampleValleyHeight(x, z, natural) - withRivers.sampleValleyHeight(x, z, natural);
				if (cut > 0.01) {
					cutSamples += 1;
					if (cut > deepestCutMeters) deepestCutMeters = cut;
				}
			}

			// Do the drawn ribbons lie in the beds that were cut for them?
			const meshes = createNamedRiverMeshes({ namedRivers: withRivers.namedRivers, sampleHeightMeters: live });
			let worstPerchMeters = -Infinity;
			let worstPerchRiver = null;
			let perchedVertices = 0;
			let checkedVertices = 0;
			for (const mesh of meshes) {
				const position = mesh.geometry.getAttribute('position');
				for (let i = 0; i < position.count; i += 1) {
					const x = position.getX(i);
					const y = position.getY(i);
					const z = position.getZ(i);
					const ground = live(x, z);
					// Only water above the sea surface has a bed to sit in; the last span crosses the shore.
					if (ground <= sea) continue;
					checkedVertices += 1;
					const perch = y - ground;
					if (perch > maxPerch) perchedVertices += 1;
					if (perch > worstPerchMeters) {
						worstPerchMeters = perch;
						worstPerchRiver = mesh.userData.namedRiver.id;
					}
				}
			}

			// Burial: walk each ribbon's centreline finely and ask whether the ground rises through it.
			// This is the measurement that caught the dashed-line Mander; vertex tests could not see it,
			// because the vertices were fine and it was the ground *between* them that poked through.
			let buriedSamples = 0;
			let centrelineSamples = 0;
			let deepestBurialMeters = 0;
			let worstBuriedRiver = null;
			for (const mesh of meshes) {
				const position = mesh.geometry.getAttribute('position');
				// Bank pairs: the centreline is the midpoint of each cross-section's two vertices.
				for (let i = 0; i + 3 < position.count; i += 2) {
					const ax = (position.getX(i) + position.getX(i + 1)) * 0.5;
					const ay = (position.getY(i) + position.getY(i + 1)) * 0.5;
					const az = (position.getZ(i) + position.getZ(i + 1)) * 0.5;
					const bx = (position.getX(i + 2) + position.getX(i + 3)) * 0.5;
					const by = (position.getY(i + 2) + position.getY(i + 3)) * 0.5;
					const bz = (position.getZ(i + 2) + position.getZ(i + 3)) * 0.5;
					const steps = Math.max(1, Math.round(Math.hypot(bx - ax, bz - az) / 4));
					for (let step = 0; step <= steps; step += 1) {
						const t = step / steps;
						const x = ax + (bx - ax) * t;
						const z = az + (bz - az) * t;
						const surfaceY = ay + (by - ay) * t;
						centrelineSamples += 1;
						const burial = live(x, z) - surfaceY;
						if (burial > 0.05) {
							buriedSamples += 1;
							if (burial > deepestBurialMeters) {
								deepestBurialMeters = burial;
								worstBuriedRiver = mesh.userData.namedRiver.id;
							}
						}
					}
				}
			}

			// Determinism: same seed, same courses.
			const courseDigest = (build) => build.namedRivers
				.map((river) => `${river.id}:${river.points.length}:${river.points[river.points.length - 1].y.toFixed(4)}`)
				.join('|');

			let triangles = 0;
			let vertices = 0;
			for (const mesh of meshes) {
				triangles += (mesh.geometry.getIndex()?.count ?? 0) / 3;
				vertices += mesh.geometry.getAttribute('position').count;
			}

			return {
				declaredCount: REFERENCE_RIVERS.length,
				rivers,
				meshCount: meshes.length,
				triangles, vertices,
				carvedCount: withRivers.namedRivers.length,
				cutSamples, landSamples, deepestCutMeters,
				worstPerchMeters, worstPerchRiver, perchedVertices, checkedVertices,
				buriedSamples, centrelineSamples, deepestBurialMeters, worstBuriedRiver,
				deterministic: courseDigest(withRivers) === courseDigest(again),
			};
		}, { maxPerch: MAX_RIBBON_PERCH_METERS });

		const failures = [];
		const traced = result.rivers.filter((river) => river.pointCount >= 2);
		if (traced.length !== result.declaredCount) {
			const dead = result.rivers.filter((river) => river.pointCount < 2).map((river) => river.id).join(', ');
			failures.push(`only ${traced.length}/${result.declaredCount} named rivers traced a course — silent: ${dead}`);
		}
		if (result.carvedCount !== result.declaredCount) failures.push(`${result.carvedCount}/${result.declaredCount} rivers reached the valley carver`);
		if (result.meshCount !== result.declaredCount) failures.push(`${result.meshCount}/${result.declaredCount} rivers produced a ribbon mesh`);
		for (const river of result.rivers) {
			if (river.endReason !== 'sea') failures.push(`${river.id} ended via "${river.endReason}" rather than reaching the sea`);
			if (!river.sourceOnLand) failures.push(`${river.id} rises offshore — its headwater reading is in canonical water`);
			if (!river.mouthInWater) failures.push(`${river.id} does not empty into canonical water`);
			if (river.mouthWaterShare < MIN_MOUTH_WATER_SHARE) {
				failures.push(`${river.id}'s mouth has only ${(river.mouthWaterShare * 100).toFixed(0)}% water within 800 m — an inland pit, not a coast`);
			}
		}
		if (!(result.cutSamples > 0 && result.deepestCutMeters > 1)) {
			failures.push(`the named rivers cut nothing into the ground (${result.cutSamples} samples, deepest ${result.deepestCutMeters.toFixed(2)} m)`);
		}
		const buriedShare = result.centrelineSamples ? result.buriedSamples / result.centrelineSamples : 1;
		if (buriedShare > MAX_BURIED_SHARE) {
			failures.push(`${(buriedShare * 100).toFixed(1)}% of the named rivers' length is underground, deepest ${result.deepestBurialMeters.toFixed(1)} m on ${result.worstBuriedRiver} (max ${(MAX_BURIED_SHARE * 100).toFixed(1)}%) — the water renders as disconnected patches`);
		}
		if (result.perchedVertices > 0) {
			failures.push(`${result.perchedVertices}/${result.checkedVertices} ribbon vertices stand over ${MAX_RIBBON_PERCH_METERS} m above the ground, worst ${result.worstPerchMeters.toFixed(1)} m on ${result.worstPerchRiver} — water draped over a hillside`);
		}
		if (!result.deterministic) failures.push('two builds of the same seed produced different courses');
		if (result.triangles > MAX_RIVER_TRIANGLES) {
			failures.push(`the named rivers cost ${result.triangles} triangles across ${result.meshCount} draw calls (ceiling ${MAX_RIVER_TRIANGLES}) — see GOVERNANCE.md §4`);
		}

		console.log(`[named-rivers] ${traced.length}/${result.declaredCount} traced, ${result.carvedCount} carved, ${result.meshCount} ribbons drawn`);
		console.log('[named-rivers] id                  pts    len m   source m -> mouth m   endReason   mouth water@800m');
		for (const river of result.rivers) {
			console.log(
				`[named-rivers]   ${river.id.padEnd(18)} ${String(river.pointCount).padStart(3)} ${river.lengthMeters.toFixed(0).padStart(7)}` +
					`   ${river.sourceY.toFixed(0).padStart(6)} -> ${river.mouthY.toFixed(1).padStart(6)}   ${river.endReason.padEnd(13)} ${(river.mouthWaterShare * 100).toFixed(0)}%`,
			);
		}
		console.log(`[named-rivers] carve: ${result.cutSamples}/${result.landSamples} land samples cut, deepest ${result.deepestCutMeters.toFixed(1)} m`);
		console.log(`[named-rivers] cost: ${result.triangles} triangles / ${result.vertices} vertices over ${result.meshCount} draw calls (ceiling ${MAX_RIVER_TRIANGLES})`);
		console.log(`[named-rivers] ribbons: ${(buriedShare * 100).toFixed(2)}% buried over ${result.centrelineSamples} centreline samples (deepest ${result.deepestBurialMeters.toFixed(1)} m), worst perch ${result.worstPerchMeters.toFixed(1)} m over ${result.checkedVertices} vertices; deterministic ${result.deterministic}`);
		if (failures.length) {
			for (const failure of failures) console.error(`[named-rivers] FAIL: ${failure}`);
			process.exit(1);
		}
		console.log('[named-rivers] PASS: every named river rises on land, runs to the sea, cuts its valley, and carries water that lies in it.');
		process.exit(0);
	} catch (error) {
		console.error('[named-rivers] FAIL:', error);
		process.exit(1);
	} finally {
		await browser.close();
		server.close();
	}
})();
