/** Procedural vegetation regression check (run 111/ADR-0138, extended run 112/ADR-0139 for species
 * variety, extended run 113/ADR-0140 for seat-local clustering). */

// Run 332 RCA (game3d.js line-cap extraction, ADR-0279): this project's own boot cost has grown
// past this constant's original assumption -- run-326/330/330b/331's procedural creatures, real
// castle models, and villages pushed a real game3d.html boot to ~9-13s (observed via direct
// domcontentloaded-timing instrumentation) in this project's software-WebGL sandboxed CI/dev
// environment, which sat right at or over the old 10s/15s ceiling -- a pre-existing flake
// (already recorded as an "environment quirk" by game3dSmokeChecksScene.js's own run-68 comment)
// that reproduced on unmodified `main` in this run's own RCA, not something the run's actual code
// change caused (confirmed: that change executes strictly after the domcontentloaded event this
// timeout gates on). 30s gives real margin above the observed range, including one measured 20s+
// outlier under sandbox contention.
const NAV_TIMEOUT_MS = 30_000;

async function checkVegetation(browser, baseUrl) {
	const page = await browser.newPage();
	let result;
	try {
		await page.goto(`${baseUrl}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
		result = await page.evaluate(async () => {
			const THREE = await import('/src/3d/vendor/three/three.module.js');
			const { createVegetation, disposeVegetation, isPlaceablePosition, distancePointToSegment2D, pickSpeciesIndex, sampleAnnulusPoint } =
				await import('/src/3d/world/vegetation.js');

			// Flat ground well above sea level everywhere, except a steep ridge along x=200 and a
			// synthetic depression south of z=-500 (below sea level) — a deliberately simple sampler,
			// not real terrain.js noise, so every assertion below is exact-value, not approximate.
			const FLAT_HEIGHT = 50;
			const SEA_LEVEL = 6;
			const sampleHeightMeters = (x, z) => {
				if (z < -500) return 0; // "underwater" region
				if (Math.abs(x - 200) < 1) return FLAT_HEIGHT + 40; // near-vertical ridge face
				return FLAT_HEIGHT;
			};
			const seats = [{ x: 1000, z: 1000 }];
			const roadEdges = [{ points: [{ x: -50, z: 0 }, { x: 50, z: 0 }] }];

			// distancePointToSegment2D — exact-value on a known horizontal segment.
			const segmentDistanceExact = distancePointToSegment2D(0, 10, -50, 0, 50, 0) === 10;
			const segmentDistancePastEndpoint = distancePointToSegment2D(100, 0, -50, 0, 50, 0) === 50;

			// isPlaceablePosition — one assertion per exclusion rule, all far from every OTHER rule's
			// trigger zone so each test isolates exactly one condition.
			const acceptsOrdinaryFlatGround = isPlaceablePosition(2000, 2000, { sampleHeightMeters, seaLevelMeters: SEA_LEVEL, seats, roadEdges }) === true;
			const rejectsUnderwater = isPlaceablePosition(2000, -2000, { sampleHeightMeters, seaLevelMeters: SEA_LEVEL, seats, roadEdges }) === false;
			const rejectsNearSeat = isPlaceablePosition(1010, 1000, { sampleHeightMeters, seaLevelMeters: SEA_LEVEL, seats, roadEdges }) === false;
			const acceptsFarFromSeat = isPlaceablePosition(1200, 1200, { sampleHeightMeters, seaLevelMeters: SEA_LEVEL, seats, roadEdges }) === true;
			const rejectsNearRoad = isPlaceablePosition(0, 0, { sampleHeightMeters, seaLevelMeters: SEA_LEVEL, seats, roadEdges }) === false;
			const acceptsFarFromRoad = isPlaceablePosition(0, 200, { sampleHeightMeters, seaLevelMeters: SEA_LEVEL, seats, roadEdges }) === true;
			const rejectsSteepSlope = isPlaceablePosition(200, 2000, { sampleHeightMeters, seaLevelMeters: SEA_LEVEL, seats, roadEdges }) === false;

			// pickSpeciesIndex — pure weighted-pick function, exact-value at and around the boundary
			// (weights 0.6/0.4 normalized against a 1.0 total: index 0 covers [0, 0.6), index 1 covers
			// [0.6, 1)).
			const speciesPickLowRoll = pickSpeciesIndex(0) === 0;
			const speciesPickJustBelowBoundary = pickSpeciesIndex(0.599) === 0;
			const speciesPickAtBoundary = pickSpeciesIndex(0.6) === 1;
			const speciesPickHighRoll = pickSpeciesIndex(0.999999) === 1;

			// createVegetation — determinism: identical seed produces an identical scatter (compared via
			// every placed instance's transform across every species' mesh, not just placedCount or a
			// single instance, so a same-count-different-layout OR same-count-different-species-mix bug
			// would still be caught).
			const collectAllMatrices = (group) => {
				const out = [];
				const m = new THREE.Matrix4();
				for (const mesh of group.children) {
					for (let i = 0; i < mesh.count; i++) {
						mesh.getMatrixAt(i, m);
						out.push(...m.toArray());
					}
				}
				return out;
			};
			const baseParams = { sampleHeightMeters, seaLevelMeters: SEA_LEVEL, seats: [], roadEdges: [], radiusMeters: 500, densityPerKm2: 40 };
			const runA = createVegetation({ ...baseParams, seed: 777 });
			const runB = createVegetation({ ...baseParams, seed: 777 });
			const runC = createVegetation({ ...baseParams, seed: 999 });
			const matricesA = collectAllMatrices(runA.group);
			const matricesB = collectAllMatrices(runB.group);
			const matricesC = collectAllMatrices(runC.group);
			const sameSeedIsDeterministic = runA.placedCount === runB.placedCount
				&& runA.placedCount > 0
				&& matricesA.length === matricesB.length
				&& matricesA.every((value, index) => value === matricesB[index]);
			const differentSeedDiffers = runA.placedCount !== runC.placedCount
				|| matricesA.length !== matricesC.length
				|| matricesA.some((value, index) => value !== matricesC[index]);
			const placedNeverExceedsTarget = runA.placedCount <= runA.targetCount;
			// 3 species * (trunk + foliage) = 6 draw calls. Snow-pine remains a real mesh pair even
			// when this temperate fixture gives it zero instances, preserving stable species ordering.
			const sixDrawCallsForThreeSpecies = runA.group.children.length === 6;
			// This seed/area/density combination places enough temperate trees (verified, not assumed)
			// that both weighted temperate species are represented.
			const bothTemperateSpeciesRepresented = runA.group.children[0].count > 0 && runA.group.children[2].count > 0;
			const speciesCountsSumToPlaced = runA.group.children[0].count + runA.group.children[2].count + runA.group.children[4].count === runA.placedCount;

			// Total exclusion: a seat placed at the disc's own center with a disc radius (80m) smaller
			// than the seat's own 90m exclusion radius means every candidate point is rejected — proves
			// rejection actually rejects, not merely a plausible-looking no-op. Density raised well
			// above the default so `targetCount` is unambiguously > 0 at this small a radius (a disc
			// this size at the default 30/km² would round `targetCount` down to 0, which would make the
			// assertion below pass for the wrong reason — an untested no-op, not a proven rejection).
			const fullyExcluded = createVegetation({
				sampleHeightMeters, seaLevelMeters: SEA_LEVEL, seed: 1, seats: [{ x: 0, z: 0 }], roadEdges: [],
				radiusMeters: 80, densityPerKm2: 300,
			});
			const rejectionActuallyRejects = fullyExcluded.targetCount > 0 && fullyExcluded.placedCount === 0;

			// Zero-area disc: radiusMeters=0 must not throw and must yield nothing.
			const zeroRadius = createVegetation({ sampleHeightMeters, seaLevelMeters: SEA_LEVEL, seed: 1, seats: [], roadEdges: [], radiusMeters: 0 });
			const zeroRadiusIsInert = zeroRadius.targetCount === 0 && zeroRadius.placedCount === 0 && zeroRadius.group.children.length === 0;

			// dispose() must not throw on a real (non-empty) scatter.
			let disposeThrew = false;
			try {
				disposeVegetation(runA.group);
			} catch {
				disposeThrew = true;
			}

			// sampleAnnulusPoint — exact-value at the ring's inner/outer edges (a queued fake rng, not
			// the real seeded stream, so both draws are pinned to known values).
			const queuedRng = (values) => {
				let i = 0;
				return () => values[i++];
			};
			const annulusAtInnerEdge = sampleAnnulusPoint(queuedRng([0, 0]), 0, 0, 100, 260);
			const annulusInnerEdgeExact = Math.abs(annulusAtInnerEdge.x - 100) < 1e-9 && Math.abs(annulusAtInnerEdge.z) < 1e-9;
			const annulusAtOuterEdge = sampleAnnulusPoint(queuedRng([0, 1]), 0, 0, 100, 260);
			const annulusOuterEdgeExact = Math.abs(annulusAtOuterEdge.x - 260) < 1e-9 && Math.abs(annulusAtOuterEdge.z) < 1e-9;
			// Off-center annulus (non-zero center) — confirms the offset is applied, not just the radius.
			const annulusOffCenter = sampleAnnulusPoint(queuedRng([0, 0]), 500, -300, 100, 260);
			const annulusOffCenterExact = Math.abs(annulusOffCenter.x - 600) < 1e-9 && Math.abs(annulusOffCenter.z - -300) < 1e-9;

			// createVegetation seat-local clustering (run 113/ADR-0140) — a seat at the disc's own
			// center, disc radius (400m) large enough its full ring (260m) fits inside
			// (0 + 260 <= 400), density forced to 0 so every placed tree is provably a cluster tree, not
			// a base-scatter one.
			const decomposePosition = (mesh, index) => {
				const m = new THREE.Matrix4();
				const p = new THREE.Vector3();
				const q = new THREE.Quaternion();
				const s = new THREE.Vector3();
				mesh.getMatrixAt(index, m);
				m.decompose(p, q, s);
				return p;
			};
			const clustered = createVegetation({
				sampleHeightMeters, seaLevelMeters: SEA_LEVEL, seed: 42, seats: [{ x: 0, z: 0 }], roadEdges: [],
				radiusMeters: 400, densityPerKm2: 0,
			});
			const qualifyingSeatGetsCluster = clustered.clusterSeatCount === 1 && clustered.placedCount > 0;
			// Every placed instance (both species' meshes) sits within [SEAT_EXCLUSION_RADIUS_METERS,
			// CLUSTER_RING_OUTER_RADIUS_METERS] of the seat — proves the ring actually bounds where cluster
			// trees land, not just that *some* trees got placed somewhere. (Lower bound uses the seat
			// exclusion radius, not the ring's own tighter inner margin, so this assertion doesn't need to
			// hand-duplicate vegetation.js's own private CLUSTER_RING_INNER_MARGIN_METERS constant.)
			let allClusterTreesWithinRing = true;
			for (const mesh of clustered.group.children) {
				for (let i = 0; i < mesh.count; i++) {
					const p = decomposePosition(mesh, i);
					const distanceFromSeat = Math.hypot(p.x, p.z);
					if (distanceFromSeat < 90 || distanceFromSeat > 260 + 1e-6) allClusterTreesWithinRing = false;
				}
			}
			// A seat far outside the disc never gets a ring — the same "no trees over a chunk that was
			// never generated" guarantee, extended to the ring's own outer edge.
			const farSeat = createVegetation({
				sampleHeightMeters, seaLevelMeters: SEA_LEVEL, seed: 42, seats: [{ x: 10000, z: 10000 }], roadEdges: [],
				radiusMeters: 400, densityPerKm2: 0,
			});
			const nonQualifyingSeatGetsNoCluster = farSeat.clusterSeatCount === 0 && farSeat.placedCount === 0;
			// Empty `seats` (this check's own pre-existing determinism runs above) never triggers
			// clustering — locks in that ADR-0138/ADR-0139's own scatter-only behavior is unchanged.
			const emptySeatsGetsNoCluster = runA.clusterSeatCount === 0 && runB.clusterSeatCount === 0 && runC.clusterSeatCount === 0;

			return {
				segmentDistanceExact, segmentDistancePastEndpoint,
				acceptsOrdinaryFlatGround, rejectsUnderwater, rejectsNearSeat, acceptsFarFromSeat,
				rejectsNearRoad, acceptsFarFromRoad, rejectsSteepSlope,
				speciesPickLowRoll, speciesPickJustBelowBoundary, speciesPickAtBoundary, speciesPickHighRoll,
				sameSeedIsDeterministic, differentSeedDiffers, placedNeverExceedsTarget,
				sixDrawCallsForThreeSpecies, bothTemperateSpeciesRepresented, speciesCountsSumToPlaced,
				rejectionActuallyRejects, zeroRadiusIsInert, disposeDidNotThrow: !disposeThrew,
				annulusInnerEdgeExact, annulusOuterEdgeExact, annulusOffCenterExact,
				qualifyingSeatGetsCluster, allClusterTreesWithinRing, nonQualifyingSeatGetsNoCluster, emptySeatsGetsNoCluster,
			};
		});
	} finally {
		await page.close();
	}
	const ok = Object.values(result).every(Boolean);
	return {
		name: 'procedural vegetation (world/vegetation.js, ADR-0138/ADR-0139/ADR-0140)',
		ok,
		details: ok
			? 'segment-distance exact-value, isPlaceablePosition rejects water/steep-slope/near-seat/near-road and accepts ordinary ground, pickSpeciesIndex exact at/around its weight boundary, same-seed scatter is bit-identical across every species mesh, different seed differs, placed never exceeds target, 6 draw calls (3 species x trunk+foliage), both weighted temperate species represented and all three species counts sum to placedCount, full-exclusion disc places zero, zero-radius disc is inert, dispose does not throw, sampleAnnulusPoint exact at inner/outer edges and off-center, a qualifying seat gets a cluster ring with every instance provably inside it, a too-far seat gets none, empty seats never triggers clustering'
			: `FAILED assertion(s): ${JSON.stringify(result)}`,
	};
}

module.exports = { checkVegetation };