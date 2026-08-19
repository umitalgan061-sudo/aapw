#!/usr/bin/env node
/** Run 188: shadow-only comparison of unresolved canonical road/water policy options. */
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const FIXTURE = path.join(ROOT, 'scripts', 'fixtures', 'run188-road-water-policy.json');
const ARTIFACT_DIR = path.join(ROOT, 'artifacts', 'run188-road-water-policy');
const ARTIFACT = path.join(ARTIFACT_DIR, 'comparison.json');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8' };
const EXPECTED_RUN187 = Object.freeze({ routePoints: 1020, waterPoints: 399, affectedEdges: 6 });

function assert(condition, message) {
	if (!condition) throw new Error(message);
}

function startServer() {
	const server = http.createServer((req, res) => {
		try {
			const clean = decodeURIComponent(req.url.split('?')[0]);
			const file = path.join(ROOT, clean === '/' ? 'index.html' : clean.replace(/^\//, ''));
			if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
				res.writeHead(404); res.end('Not found'); return;
			}
			res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
			fs.createReadStream(file).pipe(res);
		} catch (error) {
			res.writeHead(500); res.end(String(error));
		}
	});
	return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function loadPlaywright() {
	for (const id of ['playwright', '/opt/node22/lib/node_modules/playwright']) {
		try { return require(id); } catch (error) { /* next */ }
	}
	return null;
}

function round(value, digits = 3) {
	if (!Number.isFinite(value)) return null;
	const factor = 10 ** digits;
	return Math.round(value * factor) / factor;
}

async function measurePolicyMatrix() {
	const playwright = loadPlaywright();
	if (!playwright) {
		console.error('[checkRoadWaterPolicyComparison] SKIP: Playwright unavailable.');
		process.exit(2);
	}
	const server = await startServer();
	const port = server.address().port;
	const browser = await playwright.chromium.launch({ headless: true });
	try {
		const page = await browser.newPage();
		await page.goto(`http://127.0.0.1:${port}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });
		return await page.evaluate(async () => {
			const { WORLD_DEFAULTS, SETTLEMENT_CONFIG } = await import('/src/3d/config.js');
			const { createHeightSampler } = await import('/src/3d/world/terrain.js');
			const { KINGDOM_SEATS, computeSettlementFlattenPads, mapToWorldXZ } = await import('/src/3d/world/settlements.js');
			const { computeSeatMST } = await import('/src/3d/world/roads.js');
			const { findSlopeAwarePath, ROAD_COMFORT_GRADE_DEGREES } = await import('/src/3d/world/roadPathfinder.js');
			const { mapCanvasToNormalizedReference } = await import('/src/3d/world/worldReferenceAlignment.js');
			const { referenceProtectionRadiiFromMeters, sampleSeatSafeReferenceHydrology } = await import('/src/3d/world/worldReferenceHydrology.js');
			const { FULL_REFERENCE_MAP_BOUNDS, FULL_REFERENCE_WORLD_MIGRATION_PLAN, plannedWorldXZToMapCanvas } = await import('/src/3d/world/worldReferenceMigrationPlan.js');
			const { createCanonicalHydrologyTerrainSampler } = await import('/src/3d/world/worldReferenceTerrainAdapter.js');

			const plan = FULL_REFERENCE_WORLD_MIGRATION_PLAN;
			const sea = WORLD_DEFAULTS.WATER_LEVEL_METERS;
			const natural = createHeightSampler(WORLD_DEFAULTS.WORLD_SEED);
			const pads = computeSettlementFlattenPads({
				sampleHeightMeters: natural,
				seaLevelMeters: sea,
				minGroundClearanceMeters: SETTLEMENT_CONFIG.MIN_GROUND_CLEARANCE_METERS,
				mapBounds: FULL_REFERENCE_MAP_BOUNDS,
				metersPerMapUnit: plan.metersPerMapUnit,
			});
			const base = createHeightSampler(WORLD_DEFAULTS.WORLD_SEED, undefined, pads);
			const protectionRadii = referenceProtectionRadiiFromMeters(pads[0].outerRadiusMeters, plan.metersPerMapUnit);
			const protectedSites = KINGDOM_SEATS.map((seat) => ({ id: seat.id, ...mapCanvasToNormalizedReference(seat.mapX, seat.mapY) }));
			const canonicalSampler = createCanonicalHydrologyTerrainSampler({ baseHeightSampler: base, seaLevelMeters: sea, protectedSites, protectionRadii });
			const hydrologyAtWorld = (worldX, worldZ) => {
				const map = plannedWorldXZToMapCanvas(worldX, worldZ);
				const normalized = mapCanvasToNormalizedReference(map.x, map.y);
				return sampleSeatSafeReferenceHydrology(normalized.x, normalized.y, protectedSites, protectionRadii);
			};
			const seatWorld = KINGDOM_SEATS.map((seat) => ({ id: seat.id, ...mapToWorldXZ(seat.mapX, seat.mapY, FULL_REFERENCE_MAP_BOUNDS, plan.metersPerMapUnit) }));
			const seatById = new Map(seatWorld.map((seat) => [seat.id, seat]));
			const mst = computeSeatMST(seatWorld);

			const polylineLength = (points) => {
				let total = 0;
				for (let i = 1; i < points.length; i += 1) total += Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z);
				return total;
			};
			const maxGrade = (points, segmentFilter = () => true) => {
				let max = 0;
				for (let i = 1; i < points.length; i += 1) {
					const a = points[i - 1];
					const b = points[i];
					if (!segmentFilter(a, b)) continue;
					const horizontal = Math.hypot(b.x - a.x, b.z - a.z);
					if (horizontal <= 0) continue;
					const angle = Math.atan2(Math.abs(b.y - a.y), horizontal) * 180 / Math.PI;
					max = Math.max(max, angle);
				}
				return max;
			};
			const sampleSegmentWater = (a, b, stepMeters = 10) => {
				const distance = Math.hypot(b.x - a.x, b.z - a.z);
				const steps = Math.max(1, Math.ceil(distance / stepMeters));
				const samples = [];
				for (let index = 0; index < steps; index += 1) {
					const t = (index + 0.5) / steps;
					const x = a.x + (b.x - a.x) * t;
					const z = a.z + (b.z - a.z) * t;
					samples.push({ x, z, water: hydrologyAtWorld(x, z).water, meters: distance / steps });
				}
				return samples;
			};
			const classifyRouteWater = (points) => {
				const samples = [];
				for (let i = 1; i < points.length; i += 1) samples.push(...sampleSegmentWater(points[i - 1], points[i]));
				let waterMeters = 0;
				let current = null;
				const crossings = [];
				for (const sample of samples) {
					if (sample.water) {
						waterMeters += sample.meters;
						if (!current) current = { alongMeters: 0, first: sample, last: sample };
						current.alongMeters += sample.meters;
						current.last = sample;
					} else if (current) {
						crossings.push(current);
						current = null;
					}
				}
				if (current) crossings.push(current);
				return {
					waterMeters,
					crossings: crossings.map((crossing) => ({
						alongMeters: crossing.alongMeters,
						chordMeters: Math.hypot(crossing.last.x - crossing.first.x, crossing.last.z - crossing.first.z),
					})),
				};
			};

			class MinHeap {
				constructor() { this.items = []; }
				get size() { return this.items.length; }
				push(item) {
					const items = this.items; items.push(item); let index = items.length - 1;
					while (index > 0) {
						const parent = (index - 1) >> 1;
						if (items[parent].f <= items[index].f) break;
						[items[parent], items[index]] = [items[index], items[parent]]; index = parent;
					}
				}
				pop() {
					const items = this.items; const top = items[0]; const last = items.pop();
					if (items.length > 0) {
						items[0] = last; let index = 0;
						for (;;) {
							let smallest = index; const left = index * 2 + 1; const right = left + 1;
							if (left < items.length && items[left].f < items[smallest].f) smallest = left;
							if (right < items.length && items[right].f < items[smallest].f) smallest = right;
							if (smallest === index) break;
							[items[index], items[smallest]] = [items[smallest], items[index]]; index = smallest;
						}
					}
					return top;
				}
			}

			const findDryCartRoute = (start, end) => {
				const cellMeters = 40;
				const hardGradeDegrees = 20;
				const minX = -plan.worldWidthMeters * 0.5;
				const minZ = -plan.worldDepthMeters * 0.5;
				const cols = Math.floor(plan.worldWidthMeters / cellMeters) + 1;
				const rows = Math.floor(plan.worldDepthMeters / cellMeters) + 1;
				const count = cols * rows;
				const nodeIndex = (i, j) => j * cols + i;
				const worldPoint = (i, j) => ({ x: minX + i * cellMeters, z: minZ + j * cellMeters });
				const clampI = (i) => Math.min(cols - 1, Math.max(0, i));
				const clampJ = (j) => Math.min(rows - 1, Math.max(0, j));
				const waterCache = new Int8Array(count); waterCache.fill(-1);
				const heightCache = new Float64Array(count); heightCache.fill(NaN);
				const isWater = (i, j) => {
					const idx = nodeIndex(i, j);
					if (waterCache[idx] < 0) {
						const point = worldPoint(i, j);
						waterCache[idx] = hydrologyAtWorld(point.x, point.z).water ? 1 : 0;
					}
					return waterCache[idx] === 1;
				};
				const heightAt = (i, j) => {
					const idx = nodeIndex(i, j);
					if (Number.isNaN(heightCache[idx])) {
						const point = worldPoint(i, j);
						heightCache[idx] = canonicalSampler(point.x, point.z);
					}
					return heightCache[idx];
				};
				const segmentWaterFree = (a, b) => sampleSegmentWater(a, b, 10).every((sample) => !sample.water);
				const attachment = (point) => {
					const centerI = clampI(Math.round((point.x - minX) / cellMeters));
					const centerJ = clampJ(Math.round((point.z - minZ) / cellMeters));
					let best = null;
					for (let radius = 0; radius <= 3; radius += 1) {
						for (let dj = -radius; dj <= radius; dj += 1) {
							for (let di = -radius; di <= radius; di += 1) {
								const i = centerI + di; const j = centerJ + dj;
								if (i < 0 || j < 0 || i >= cols || j >= rows || isWater(i, j)) continue;
								const candidate = worldPoint(i, j);
								const horizontal = Math.hypot(candidate.x - point.x, candidate.z - point.z);
								if (horizontal === 0) return { i, j };
								if (!segmentWaterFree({ ...point, y: canonicalSampler(point.x, point.z) }, { ...candidate, y: heightAt(i, j) })) continue;
								const grade = Math.atan2(Math.abs(heightAt(i, j) - canonicalSampler(point.x, point.z)), horizontal) * 180 / Math.PI;
								if (grade > hardGradeDegrees) continue;
								if (!best || horizontal < best.distance) best = { i, j, distance: horizontal };
							}
						}
						if (best) return best;
					}
					return null;
				};
				const startCell = attachment(start); const endCell = attachment(end);
				if (!startCell || !endCell) return { found: false, reason: 'seat-attachment' };
				const startIdx = nodeIndex(startCell.i, startCell.j); const endIdx = nodeIndex(endCell.i, endCell.j);
				const gScore = new Float64Array(count); gScore.fill(Infinity);
				const cameFrom = new Int32Array(count); cameFrom.fill(-1);
				const closed = new Uint8Array(count);
				const heap = new MinHeap();
				const heuristic = (i, j) => Math.hypot((i - endCell.i) * cellMeters, (j - endCell.j) * cellMeters);
				const offsets = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
				gScore[startIdx] = 0; heap.push({ f: heuristic(startCell.i, startCell.j), i: startCell.i, j: startCell.j });
				let found = startIdx === endIdx; let expansions = 0;
				while (!found && heap.size > 0) {
					const current = heap.pop(); const idx = nodeIndex(current.i, current.j);
					if (closed[idx]) continue;
					closed[idx] = 1; expansions += 1;
					if (idx === endIdx) { found = true; break; }
					const currentHeight = heightAt(current.i, current.j);
					for (const [di, dj] of offsets) {
						const ni = current.i + di; const nj = current.j + dj;
						if (ni < 0 || nj < 0 || ni >= cols || nj >= rows || isWater(ni, nj)) continue;
						if (di !== 0 && dj !== 0 && (isWater(current.i + di, current.j) || isWater(current.i, current.j + dj))) continue;
						const nIdx = nodeIndex(ni, nj); if (closed[nIdx]) continue;
						const horizontal = Math.hypot(di * cellMeters, dj * cellMeters);
						const angle = Math.atan2(Math.abs(heightAt(ni, nj) - currentHeight), horizontal) * 180 / Math.PI;
						if (angle > hardGradeDegrees) continue;
						const ratio = angle / ROAD_COMFORT_GRADE_DEGREES;
						const stepCost = horizontal * (1 + ratio ** 3);
						const tentative = gScore[idx] + stepCost;
						if (tentative < gScore[nIdx]) {
							gScore[nIdx] = tentative; cameFrom[nIdx] = idx;
							heap.push({ f: tentative + heuristic(ni, nj), i: ni, j: nj });
						}
					}
				}
				if (!found) return { found: false, reason: 'no-dry-cart-path', expansions };
				const grid = [];
				for (let cursor = endIdx; cursor !== -1; cursor = cameFrom[cursor]) grid.push({ i: cursor % cols, j: Math.floor(cursor / cols) });
				grid.reverse();
				const points = [{ x: start.x, z: start.z, y: canonicalSampler(start.x, start.z) }];
				for (const cell of grid) {
					const point = worldPoint(cell.i, cell.j);
					points.push({ ...point, y: heightAt(cell.i, cell.j) });
				}
				points.push({ x: end.x, z: end.z, y: canonicalSampler(end.x, end.z) });
				const waterFree = points.slice(1).every((point, index) => segmentWaterFree(points[index], point));
				const maxGradeDegrees = maxGrade(points);
				if (!waterFree) return { found: false, reason: 'segment-water-after-grid', expansions };
				if (maxGradeDegrees > hardGradeDegrees + 1e-9) return { found: false, reason: 'segment-grade-after-grid', expansions, maxGradeDegrees };
				return { found: true, points, lengthMeters: polylineLength(points), maxGradeDegrees, expansions, cellMeters };
			};

			let routePointCount = 0;
			let waterPointCount = 0;
			const baselineEdges = [];
			for (const edge of mst) {
				const start = seatById.get(edge.fromId); const end = seatById.get(edge.toId);
				const route = findSlopeAwarePath({ sampleHeightMeters: canonicalSampler, start, end });
				let pointWater = 0;
				for (const point of route.points) {
					routePointCount += 1;
					if (hydrologyAtWorld(point.x, point.z).water) { pointWater += 1; waterPointCount += 1; }
				}
				if (pointWater === 0) continue;
				const water = classifyRouteWater(route.points);
				const landMaxGradeDegrees = maxGrade(route.points, (a, b) => {
					const midpoint = { x: (a.x + b.x) * 0.5, z: (a.z + b.z) * 0.5 };
					return !hydrologyAtWorld(midpoint.x, midpoint.z).water;
				});
				const dry = findDryCartRoute(start, end);
				baselineEdges.push({
					edge: `${edge.fromId}->${edge.toId}`,
					pointWater,
					pointTotal: route.points.length,
					baselineLengthMeters: polylineLength(route.points),
					baselineMaxGradeDegrees: route.maxGradeDegrees,
					landOnlyMaxGradeDegrees: landMaxGradeDegrees,
					waterTraversalMeters: water.waterMeters,
					crossingCount: water.crossings.length,
					bridgeTotalChordMeters: water.crossings.reduce((sum, crossing) => sum + crossing.chordMeters, 0),
					bridgeMaxChordMeters: water.crossings.reduce((max, crossing) => Math.max(max, crossing.chordMeters), 0),
					ferryTotalRouteMeters: water.crossings.reduce((sum, crossing) => sum + crossing.alongMeters, 0),
					ferryMaxRouteMeters: water.crossings.reduce((max, crossing) => Math.max(max, crossing.alongMeters), 0),
					dry: dry.found ? {
						found: true,
						lengthMeters: dry.lengthMeters,
						lengthInflationRatio: dry.lengthMeters / polylineLength(route.points),
						maxGradeDegrees: dry.maxGradeDegrees,
						expansions: dry.expansions,
						cellMeters: dry.cellMeters,
					} : { found: false, reason: dry.reason, expansions: dry.expansions || 0 },
				});
			}
			return { routePointCount, waterPointCount, baselineEdges };
		});
	} finally {
		await browser.close();
		server.close();
	}
}

async function main() {
	const raw = await measurePolicyMatrix();
	assert(raw.routePointCount === EXPECTED_RUN187.routePoints, `Run187 route point baseline drift: ${raw.routePointCount}`);
	assert(raw.waterPointCount === EXPECTED_RUN187.waterPoints, `Run187 water point baseline drift: ${raw.waterPointCount}`);
	assert(raw.baselineEdges.length === EXPECTED_RUN187.affectedEdges, `Run187 affected edge baseline drift: ${raw.baselineEdges.length}`);
	const normalized = {
		version: 'run188-road-water-policy-comparison-v1',
		run187: { routePoints: raw.routePointCount, waterPoints: raw.waterPointCount, affectedEdges: raw.baselineEdges.length },
		edges: raw.baselineEdges.map((edge) => ({
			edge: edge.edge,
			pointWater: edge.pointWater,
			pointTotal: edge.pointTotal,
			baselineLengthMeters: round(edge.baselineLengthMeters),
			baselineMaxGradeDegrees: round(edge.baselineMaxGradeDegrees),
			landOnlyMaxGradeDegrees: round(edge.landOnlyMaxGradeDegrees),
			waterTraversalMeters: round(edge.waterTraversalMeters),
			crossingCount: edge.crossingCount,
			bridgeTotalChordMeters: round(edge.bridgeTotalChordMeters),
			bridgeMaxChordMeters: round(edge.bridgeMaxChordMeters),
			ferryTotalRouteMeters: round(edge.ferryTotalRouteMeters),
			ferryMaxRouteMeters: round(edge.ferryMaxRouteMeters),
			dry: edge.dry.found ? {
				found: true,
				lengthMeters: round(edge.dry.lengthMeters),
				lengthInflationRatio: round(edge.dry.lengthInflationRatio, 4),
				maxGradeDegrees: round(edge.dry.maxGradeDegrees),
				expansions: edge.dry.expansions,
				cellMeters: edge.dry.cellMeters,
			} : { found: false, reason: edge.dry.reason, expansions: edge.dry.expansions },
		})),
	};
	const dryFeasible = normalized.edges.filter((edge) => edge.dry.found).length;
	const totalBridgeMeters = normalized.edges.reduce((sum, edge) => sum + edge.bridgeTotalChordMeters, 0);
	const maxBridgeMeters = normalized.edges.reduce((max, edge) => Math.max(max, edge.bridgeMaxChordMeters), 0);
	const totalFerryMeters = normalized.edges.reduce((sum, edge) => sum + edge.ferryTotalRouteMeters, 0);
	const maxFerryMeters = normalized.edges.reduce((max, edge) => Math.max(max, edge.ferryMaxRouteMeters), 0);
	const payload = JSON.stringify(normalized);
	const checksum = crypto.createHash('sha256').update(payload).digest('hex');
	const report = { checksum, ...normalized };
	fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
	fs.writeFileSync(ARTIFACT, JSON.stringify(report, null, 2) + '\n');
	if (!fs.existsSync(FIXTURE)) {
		console.log(`[checkRoadWaterPolicyComparison] CANDIDATE: checksum ${checksum}; dry-cart route ${dryFeasible}/${normalized.edges.length}; bridge diagnostic total ${round(totalBridgeMeters)}m max ${round(maxBridgeMeters)}m; ferry diagnostic total ${round(totalFerryMeters)}m max ${round(maxFerryMeters)}m; no policy selected.`);
		console.log(`[checkRoadWaterPolicyComparison] CANDIDATE_JSON: ${JSON.stringify(report)}`);
		process.exit(3);
	}
	const fixture = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
	assert(fixture.version === normalized.version, `fixture version mismatch: ${fixture.version}`);
	assert(fixture.checksum === checksum, `policy comparison checksum drift: ${checksum} != ${fixture.checksum}`);
	assert(fixture.baseCommit === 'b7f570884f7f58d391c6fdb16393adef8bce9d5a', `fixture baseCommit mismatch: ${fixture.baseCommit}`);
	console.log(`[checkRoadWaterPolicyComparison] CHECKSUM: ${checksum}`);
	console.log(`[checkRoadWaterPolicyComparison] PASS: Run187 399/1020 water-point diagnostic preserved across 6/13 edges; bridge diagnostic total ${round(totalBridgeMeters)}m max ${round(maxBridgeMeters)}m; ferry diagnostic total ${round(totalFerryMeters)}m max ${round(maxFerryMeters)}m; 40m-grid water-impassable <=20deg dry-cart route feasible ${dryFeasible}/${normalized.edges.length}; mixed policy remains owner-selected per edge; live runtime unchanged.`);
	console.log(`[checkRoadWaterPolicyComparison] MATRIX_JSON: ${JSON.stringify(report)}`);
}

main().catch((error) => {
	console.error('[checkRoadWaterPolicyComparison] FAIL:', error.stack || error.message);
	process.exit(1);
});
