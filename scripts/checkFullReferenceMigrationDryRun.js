#!/usr/bin/env node
/**
 * Dry-run proof for the planned canonical full-reference migration (ADR-0202).
 * This check does not wire the canonical extent or hydrology into runtime terrain/water.
 * It exercises the live browser modules and proves that a future uniform full-map
 * scale/re-center preserves all canonical seat coordinates and the road MST topology.
 */
const http = require('http');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const MIME_TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8' };

function assert(condition, message) {
	if (!condition) throw new Error(message);
}

function startStaticServer() {
	const server = http.createServer((req, res) => {
		try {
			const urlPath = decodeURIComponent(req.url.split('?')[0]);
			const filePath = path.join(ROOT, urlPath === '/' ? '/index.html' : urlPath);
			if (!filePath.startsWith(ROOT) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
				res.writeHead(404);
				res.end('Not found');
				return;
			}
			const ext = path.extname(filePath).toLowerCase();
			res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
			fs.createReadStream(filePath).pipe(res);
		} catch (error) {
			res.writeHead(500);
			res.end(String(error));
		}
	});
	return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function loadPlaywright() {
	for (const id of ['playwright', '/opt/node22/lib/node_modules/playwright']) {
		try {
			return require(id);
		} catch (error) {
			// Try the next established project location.
		}
	}
	return null;
}

async function main() {
	const playwright = loadPlaywright();
	if (!playwright) {
		console.error('[checkFullReferenceMigrationDryRun] SKIP: Playwright is not available in this environment.');
		process.exit(2);
	}

	const server = await startStaticServer();
	const { port } = server.address();
	const browser = await playwright.chromium.launch({ headless: true });
	let result;
	try {
		const page = await browser.newPage();
		await page.goto(`http://127.0.0.1:${port}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });
		result = await page.evaluate(async () => {
			const { WORLD_SCALE } = await import('/src/3d/config.js');
			const { KINGDOM_SEATS, mapToWorldXZ } = await import('/src/3d/world/settlements.js');
			const { computeSeatMST } = await import('/src/3d/world/roads.js');
			const {
				WORLD_REFERENCE_ALIGNMENT,
				mapCanvasToNormalizedReference,
				worldXZToNormalizedReference,
				normalizedReferenceToWorldXZ,
			} = await import('/src/3d/world/worldReferenceAlignment.js');
			const { FULL_REFERENCE_EXTENT_PLAN } = await import('/src/3d/world/worldReferenceExtent.js');
			const {
				referenceProtectionRadiiFromMeters,
				sampleSeatSafeReferenceHydrology,
			} = await import('/src/3d/world/worldReferenceHydrology.js');

			const fullMapBounds = Object.freeze({
				minX: 0,
				maxX: WORLD_REFERENCE_ALIGNMENT.mapCanvasWidthUnits,
				minY: 0,
				maxY: WORLD_REFERENCE_ALIGNMENT.mapCanvasHeightUnits,
			});
			const targetScale = FULL_REFERENCE_EXTENT_PLAN.metersPerMapUnit;
			const scaleRatio = targetScale / WORLD_SCALE.METERS_PER_MAP_UNIT;
			const epsilon = 1e-7;
			const currentSeats = KINGDOM_SEATS.map((seat) => ({
				id: seat.id,
				...mapToWorldXZ(seat.mapX, seat.mapY, WORLD_SCALE.MAP_BOUNDS, WORLD_SCALE.METERS_PER_MAP_UNIT),
			}));
			const targetSeats = KINGDOM_SEATS.map((seat) => ({
				id: seat.id,
				...mapToWorldXZ(seat.mapX, seat.mapY, fullMapBounds, targetScale),
			}));
			const targetById = new Map(targetSeats.map((seat) => [seat.id, seat]));
			const protectedSites = KINGDOM_SEATS.map((seat) => ({
				id: seat.id,
				...mapCanvasToNormalizedReference(seat.mapX, seat.mapY),
			}));
			const targetProtectionRadii = referenceProtectionRadiiFromMeters(75, targetScale);

			let safeSeatCount = 0;
			let maxTransformErrorMeters = 0;
			let maxReferenceRoundTripError = 0;
			for (let index = 0; index < KINGDOM_SEATS.length; index++) {
				const seat = KINGDOM_SEATS[index];
				const current = currentSeats[index];
				const target = targetSeats[index];
				const normalized = worldXZToNormalizedReference(
					current.x,
					current.z,
					WORLD_SCALE.MAP_BOUNDS,
					WORLD_SCALE.METERS_PER_MAP_UNIT,
				);
				const expectedNormalized = mapCanvasToNormalizedReference(seat.mapX, seat.mapY);
				const transformed = normalizedReferenceToWorldXZ(normalized.x, normalized.y, fullMapBounds, targetScale);
				const transformError = Math.hypot(transformed.x - target.x, transformed.z - target.z);
				maxTransformErrorMeters = Math.max(maxTransformErrorMeters, transformError);
				const targetNormalized = worldXZToNormalizedReference(target.x, target.z, fullMapBounds, targetScale);
				const referenceError = Math.hypot(targetNormalized.x - expectedNormalized.x, targetNormalized.y - expectedNormalized.y);
				maxReferenceRoundTripError = Math.max(maxReferenceRoundTripError, referenceError);
				if (transformError > epsilon || referenceError > 1e-12) {
					throw new Error(`${seat.id}: full-reference transform drifted`);
				}
				if (Math.abs(target.x) > FULL_REFERENCE_EXTENT_PLAN.widthMeters / 2 + epsilon || Math.abs(target.z) > FULL_REFERENCE_EXTENT_PLAN.depthMeters / 2 + epsilon) {
					throw new Error(`${seat.id}: target seat escaped full-reference extent`);
				}
				const hydrology = sampleSeatSafeReferenceHydrology(expectedNormalized.x, expectedNormalized.y, protectedSites, targetProtectionRadii);
				if (!hydrology.land || hydrology.water || hydrology.protectedLandWeight !== 1) {
					throw new Error(`${seat.id}: target-scale seat-safe hydrology failed`);
				}
				safeSeatCount++;
			}

			let maxPairScaleError = 0;
			for (let a = 0; a < currentSeats.length; a++) {
				for (let b = a + 1; b < currentSeats.length; b++) {
					const currentDistance = Math.hypot(currentSeats[a].x - currentSeats[b].x, currentSeats[a].z - currentSeats[b].z);
					const targetDistance = Math.hypot(targetSeats[a].x - targetSeats[b].x, targetSeats[a].z - targetSeats[b].z);
					const error = Math.abs(targetDistance - currentDistance * scaleRatio);
					maxPairScaleError = Math.max(maxPairScaleError, error);
					if (error > epsilon) throw new Error(`${currentSeats[a].id}->${currentSeats[b].id}: pairwise scale drifted`);
				}
			}

			const currentEdges = computeSeatMST(currentSeats);
			const targetEdges = computeSeatMST(targetSeats);
			if (currentEdges.length !== 13 || targetEdges.length !== 13) throw new Error('expected 13-edge MST before and after migration');
			let preservedRoadEdges = 0;
			let maxRoadEndpointErrorMeters = 0;
			for (let index = 0; index < currentEdges.length; index++) {
				const before = currentEdges[index];
				const after = targetEdges[index];
				if (before.fromId !== after.fromId || before.toId !== after.toId) {
					throw new Error(`MST topology changed at edge ${index}: ${before.fromId}->${before.toId} vs ${after.fromId}->${after.toId}`);
				}
				const fromCurrent = currentSeats.find((seat) => seat.id === before.fromId);
				const toCurrent = currentSeats.find((seat) => seat.id === before.toId);
				const fromExpected = targetById.get(before.fromId);
				const toExpected = targetById.get(before.toId);
				for (const [currentPoint, expectedPoint] of [[fromCurrent, fromExpected], [toCurrent, toExpected]]) {
					const normalized = worldXZToNormalizedReference(currentPoint.x, currentPoint.z, WORLD_SCALE.MAP_BOUNDS, WORLD_SCALE.METERS_PER_MAP_UNIT);
					const transformed = normalizedReferenceToWorldXZ(normalized.x, normalized.y, fullMapBounds, targetScale);
					const endpointError = Math.hypot(transformed.x - expectedPoint.x, transformed.z - expectedPoint.z);
					maxRoadEndpointErrorMeters = Math.max(maxRoadEndpointErrorMeters, endpointError);
					if (endpointError > epsilon) throw new Error(`${before.fromId}->${before.toId}: road endpoint transform drifted`);
				}
				preservedRoadEdges++;
			}

			return {
				seatCount: KINGDOM_SEATS.length,
				safeSeatCount,
				preservedRoadEdges,
				targetAreaKm2: FULL_REFERENCE_EXTENT_PLAN.areaKm2,
				targetWidthMeters: FULL_REFERENCE_EXTENT_PLAN.widthMeters,
				targetDepthMeters: FULL_REFERENCE_EXTENT_PLAN.depthMeters,
				scaleRatio,
				maxTransformErrorMeters,
				maxReferenceRoundTripError,
				maxPairScaleError,
				maxRoadEndpointErrorMeters,
			};
		});
	} finally {
		await browser.close();
		server.close();
	}

	assert(result.seatCount === 14 && result.safeSeatCount === 14, 'expected 14/14 target seats safe');
	assert(result.preservedRoadEdges === 13, 'expected all 13 MST edges preserved');
	assert(Math.abs(result.targetAreaKm2 - 137.5) < 1e-9, 'target area drifted');
	console.log(
		`[checkFullReferenceMigrationDryRun] PASS: target ${result.targetAreaKm2.toFixed(1)} km² ` +
		`(${result.targetWidthMeters.toFixed(0)}x${result.targetDepthMeters.toFixed(0)}m), scale ratio=${result.scaleRatio.toFixed(9)}; ` +
		`seat transform/hydrology ${result.safeSeatCount}/${result.seatCount}; road MST topology/endpoints ${result.preservedRoadEdges}/13 preserved; ` +
		`max transform error=${result.maxTransformErrorMeters.toExponential(2)}m, pair-scale error=${result.maxPairScaleError.toExponential(2)}m. ` +
		`This is a dry-run proof only; slope-aware routed grades remain a mandatory gate when runtime terrain scale is actually migrated.`,
	);
}

main().catch((error) => {
	console.error(`[checkFullReferenceMigrationDryRun] FAIL: ${error && error.stack ? error.stack : error}`);
	process.exit(1);
});
