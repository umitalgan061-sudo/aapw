#!/usr/bin/env node
/** Run 189: deterministic shadow-only qualification for canonical rock/stone placement. */
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ARTIFACT_DIR = path.join(ROOT, 'artifacts', 'run189-rock-placement');
const ARTIFACT = path.join(ARTIFACT_DIR, 'qualification.json');
const FIXTURE = path.join(ROOT, 'scripts', 'fixtures', 'run189-rock-placement.json');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8' };

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

function deepSort(value) {
	if (Array.isArray(value)) return value.map(deepSort);
	if (!value || typeof value !== 'object') return value;
	return Object.fromEntries(Object.keys(value).sort().map((key) => [key, deepSort(value[key])]));
}

function checksum(value) {
	return crypto.createHash('sha256').update(JSON.stringify(deepSort(value))).digest('hex');
}

function round(value, digits = 3) {
	const factor = 10 ** digits;
	return Math.round(value * factor) / factor;
}

async function measure() {
	const playwright = loadPlaywright();
	if (!playwright) {
		console.error('[checkCanonicalRockPlacementShadow] SKIP: Playwright unavailable.');
		process.exit(2);
	}
	const server = await startServer();
	const port = server.address().port;
	const browser = await playwright.chromium.launch({ headless: true });
	try {
		const page = await browser.newPage();
		await page.goto(`http://127.0.0.1:${port}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 15000 });
		return await page.evaluate(async () => {
			const { WORLD_DEFAULTS, SETTLEMENT_CONFIG } = await import('/src/3d/config.js');
			const { createHeightSampler } = await import('/src/3d/world/terrain.js');
			const { KINGDOM_SEATS, computeSettlementFlattenPads } = await import('/src/3d/world/settlements.js');
			const { REFERENCE_BIOME_ZONES, REFERENCE_RELIEF_CHAINS, sampleReferenceInfluence } = await import('/src/3d/world/worldReferenceMap.js');
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
			const sampler = createCanonicalHydrologyTerrainSampler({ baseHeightSampler: base, seaLevelMeters: sea, protectedSites, protectionRadii });
			const protectedSeatCenters = protectedSites.filter((site) => sampleSeatSafeReferenceHydrology(site.x, site.y, protectedSites, protectionRadii).protectedLand).length;

			function mix32(value) {
				let x = value >>> 0;
				x ^= x >>> 16;
				x = Math.imul(x, 0x7feb352d);
				x ^= x >>> 15;
				x = Math.imul(x, 0x846ca68b);
				x ^= x >>> 16;
				return x >>> 0;
			}
			function rand01(ix, iz, salt) {
				const seed = WORLD_DEFAULTS.WORLD_SEED >>> 0;
				return mix32(seed ^ Math.imul(ix + 4099, 0x9e3779b1) ^ Math.imul(iz + 8191, 0x85ebca6b) ^ salt) / 4294967296;
			}
			function segmentDistance(px, py, ax, ay, bx, by) {
				const abx = bx - ax;
				const aby = by - ay;
				const length2 = abx * abx + aby * aby;
				if (length2 <= 1e-12) return Math.hypot(px - ax, py - ay);
				const t = Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / length2));
				return Math.hypot(px - (ax + abx * t), py - (ay + aby * t));
			}
			function reliefInfluence(nx, ny) {
				let best = 0;
				for (const chain of REFERENCE_RELIEF_CHAINS) {
					for (let i = 1; i < chain.points.length; i += 1) {
						const a = chain.points[i - 1];
						const b = chain.points[i];
						const distance = segmentDistance(nx, ny, a[0], a[1], b[0], b[1]);
						const influence = Math.max(0, 1 - distance / 0.045);
						best = Math.max(best, influence * influence * (3 - 2 * influence));
					}
				}
				return best;
			}
			function geology(nx, ny) {
				let bestZone = null;
				let bestInfluence = 0;
				for (const zone of REFERENCE_BIOME_ZONES) {
					if (zone.kind !== 'mountain' && zone.kind !== 'rocky-hills') continue;
					const influence = sampleReferenceInfluence(nx, ny, zone);
					if (influence > bestInfluence) {
						bestInfluence = influence;
						bestZone = zone.id;
					}
				}
				const chainInfluence = reliefInfluence(nx, ny);
				return { zoneId: bestZone, zoneInfluence: bestInfluence, reliefInfluence: chainInfluence, score: Math.max(bestInfluence, chainInfluence * 0.9) };
			}
			function slopeAt(x, z) {
				const d = 12;
				const dx = (sampler(x + d, z) - sampler(x - d, z)) / (2 * d);
				const dz = (sampler(x, z + d) - sampler(x, z - d)) / (2 * d);
				return Math.atan(Math.hypot(dx, dz)) * 180 / Math.PI;
			}

			const cellMeters = 120;
			const jitterMeters = 34;
			const maxSlopeDegrees = 35;
			const minGeologyScore = 0.18;
			const minX = -plan.worldWidthMeters * 0.5;
			const maxX = plan.worldWidthMeters * 0.5;
			const minZ = -plan.worldDepthMeters * 0.5;
			const maxZ = plan.worldDepthMeters * 0.5;
			const candidates = [];
			let scanned = 0;
			let dryLand = 0;
			let protectedExcluded = 0;
			let waterExcluded = 0;
			let geologyExcluded = 0;
			let slopeExcluded = 0;
			const byZone = {};
			const slopeBins = { '0-10': 0, '10-20': 0, '20-35': 0 };

			let iz = 0;
			for (let centerZ = minZ + cellMeters * 0.5; centerZ < maxZ - cellMeters * 0.5; centerZ += cellMeters, iz += 1) {
				let ix = 0;
				for (let centerX = minX + cellMeters * 0.5; centerX < maxX - cellMeters * 0.5; centerX += cellMeters, ix += 1) {
					scanned += 1;
					const x = centerX + (rand01(ix, iz, 0x1234abcd) * 2 - 1) * jitterMeters;
					const z = centerZ + (rand01(ix, iz, 0x89abcdef) * 2 - 1) * jitterMeters;
					const map = plannedWorldXZToMapCanvas(x, z);
					const normalized = mapCanvasToNormalizedReference(map.x, map.y);
					const hydrology = sampleSeatSafeReferenceHydrology(normalized.x, normalized.y, protectedSites, protectionRadii);
					if (hydrology.water) { waterExcluded += 1; continue; }
					dryLand += 1;
					if (hydrology.protectedLand) { protectedExcluded += 1; continue; }
					const geo = geology(normalized.x, normalized.y);
					if (geo.score < minGeologyScore) { geologyExcluded += 1; continue; }
					const slope = slopeAt(x, z);
					if (slope > maxSlopeDegrees) { slopeExcluded += 1; continue; }
					const densityGate = Math.min(0.92, 0.18 + geo.score * 0.72);
					if (rand01(ix, iz, 0x31415926) > densityGate) continue;
					const tierRoll = rand01(ix, iz, 0x27182818);
					const tier = tierRoll < 0.68 ? 'stone' : tierRoll < 0.93 ? 'rock' : 'boulder';
					const yawRadians = rand01(ix, iz, 0x5f3759df) * Math.PI * 2;
					const scale = tier === 'stone'
						? 0.45 + rand01(ix, iz, 0x11111111) * 0.85
						: tier === 'rock'
							? 1.2 + rand01(ix, iz, 0x22222222) * 2.2
							: 3.5 + rand01(ix, iz, 0x33333333) * 4.5;
					const y = sampler(x, z);
					const zoneId = geo.zoneId || 'relief-chain';
					byZone[zoneId] = (byZone[zoneId] || 0) + 1;
					if (slope < 10) slopeBins['0-10'] += 1;
					else if (slope < 20) slopeBins['10-20'] += 1;
					else slopeBins['20-35'] += 1;
					candidates.push({
						ix, iz,
						x: Math.round(x * 1000) / 1000,
						y: Math.round(y * 1000) / 1000,
						z: Math.round(z * 1000) / 1000,
						slopeDegrees: Math.round(slope * 1000) / 1000,
						geologyScore: Math.round(geo.score * 1000000) / 1000000,
						zoneId,
						tier,
						yawRadians: Math.round(yawRadians * 1000000) / 1000000,
						scale: Math.round(scale * 1000) / 1000,
					});
				}
			}

			const tierCounts = candidates.reduce((acc, item) => {
				acc[item.tier] = (acc[item.tier] || 0) + 1;
				return acc;
			}, { stone: 0, rock: 0, boulder: 0 });
			const maxSlope = candidates.reduce((max, item) => Math.max(max, item.slopeDegrees), 0);
			const minHeight = candidates.reduce((min, item) => Math.min(min, item.y), Infinity);
			const maxHeight = candidates.reduce((max, item) => Math.max(max, item.y), -Infinity);
			const zoneCoverage = Object.entries(byZone).sort(([a], [b]) => a.localeCompare(b));
			return {
				policy: { cellMeters, jitterMeters, maxSlopeDegrees, minGeologyScore, seed: WORLD_DEFAULTS.WORLD_SEED },
				world: { widthMeters: plan.worldWidthMeters, depthMeters: plan.worldDepthMeters, areaKm2: plan.areaKm2 },
				counts: { scanned, dryLand, waterExcluded, protectedExcluded, protectedSeatCenters, geologyExcluded, slopeExcluded, eligible: candidates.length, tierCounts },
				maxSlopeDegrees: maxSlope,
				heightRangeMeters: [minHeight, maxHeight],
				slopeBins,
				zoneCoverage,
				candidates,
			};
		});
	} finally {
		await browser.close();
		server.close();
	}
}

function summaryPayload(report) {
	return {
		policy: report.policy,
		world: report.world,
		counts: report.counts,
		maxSlopeDegrees: round(report.maxSlopeDegrees),
		heightRangeMeters: report.heightRangeMeters.map((value) => round(value)),
		slopeBins: report.slopeBins,
		zoneCoverage: report.zoneCoverage,
		candidateChecksum: checksum(report.candidates),
	};
}

async function main() {
	const reportA = await measure();
	const reportB = await measure();
	const summaryA = summaryPayload(reportA);
	const summaryB = summaryPayload(reportB);
	assert(checksum(summaryA) === checksum(summaryB), 'repeat qualification checksum changed');
	assert(summaryA.counts.scanned > 5000, `expected broad full-world sample, got ${summaryA.counts.scanned}`);
	assert(summaryA.counts.dryLand > 1000, `expected substantial dry land, got ${summaryA.counts.dryLand}`);
	assert(summaryA.counts.waterExcluded > 0, 'expected canonical water exclusions');
	assert(summaryA.counts.protectedSeatCenters === 14, `expected 14 protected seat centers, got ${summaryA.counts.protectedSeatCenters}`);
	assert(summaryA.counts.eligible >= 50, `too few eligible rock candidates: ${summaryA.counts.eligible}`);
	assert(summaryA.counts.tierCounts.stone > 0, 'stone tier empty');
	assert(summaryA.counts.tierCounts.rock > 0, 'rock tier empty');
	assert(summaryA.counts.tierCounts.boulder > 0, 'boulder tier empty');
	assert(summaryA.maxSlopeDegrees <= summaryA.policy.maxSlopeDegrees + 0.001, `eligible slope ${summaryA.maxSlopeDegrees} exceeds ${summaryA.policy.maxSlopeDegrees}`);
	assert(summaryA.zoneCoverage.length >= 3, `expected >=3 geology zones, got ${summaryA.zoneCoverage.length}`);

	const final = { ...summaryA, checksum: checksum(summaryA) };
	fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
	fs.writeFileSync(ARTIFACT, JSON.stringify(final, null, 2) + '\n');

	if (process.argv.includes('--write-fixture')) {
		fs.mkdirSync(path.dirname(FIXTURE), { recursive: true });
		fs.writeFileSync(FIXTURE, JSON.stringify(final, null, 2) + '\n');
	}
	if (process.argv.includes('--verify-fixture')) {
		assert(fs.existsSync(FIXTURE), 'fixture missing');
		const fixture = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
		assert(JSON.stringify(deepSort(fixture)) === JSON.stringify(deepSort(final)), 'fixture mismatch');
	}

	console.log(`[checkCanonicalRockPlacementShadow] PASS: scanned ${final.counts.scanned} full-reference cells; eligible ${final.counts.eligible} dry, unprotected geology candidates; tiers stone/rock/boulder ${final.counts.tierCounts.stone}/${final.counts.tierCounts.rock}/${final.counts.tierCounts.boulder}; zones ${final.zoneCoverage.length}; max slope ${final.maxSlopeDegrees.toFixed(1)}° <= ${final.policy.maxSlopeDegrees}°; checksum ${final.checksum}; live runtime unchanged.`);
	console.log(`[checkCanonicalRockPlacementShadow] CHECKSUM: ${final.checksum}`);
}

main().catch((error) => {
	console.error('[checkCanonicalRockPlacementShadow] FAIL:', error);
	process.exit(1);
});
