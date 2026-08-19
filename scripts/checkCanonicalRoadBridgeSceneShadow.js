#!/usr/bin/env node
/** Run 192: canonical road + owner-approved stone bridge scene-integration shadow proof. */
const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'artifacts', 'run192-road-bridge-scene-shadow');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8' };
const MAX_APPROACH_GRADE_DEGREES = 18;
const MAX_APPROACH_LENGTH_METERS = 320;

function assert(condition, message) {
	if (!condition) throw new Error(message);
}

function loadPlaywright() {
	for (const id of ['playwright', '/opt/node22/lib/node_modules/playwright']) {
		try { return require(id); } catch (error) { /* next */ }
	}
	return null;
}

function startServer() {
	const server = http.createServer((req, res) => {
		try {
			const clean = decodeURIComponent(req.url.split('?')[0]);
			const relative = clean === '/' ? 'game3d.html' : clean.replace(/^\//, '');
			const file = path.join(ROOT, relative);
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

async function main() {
	const playwright = loadPlaywright();
	if (!playwright) {
		console.error('[checkCanonicalRoadBridgeSceneShadow] SKIP: Playwright unavailable.');
		process.exit(2);
	}
	fs.mkdirSync(OUT, { recursive: true });
	const server = await startServer();
	const port = server.address().port;
	const browser = await playwright.chromium.launch({ headless: true });
	let report;
	try {
		const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
		await page.goto(`http://127.0.0.1:${port}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });
		report = await page.evaluate(async ({ maxGrade, maxApproachLength }) => {
			const THREE = await import('three');
			const { WORLD_DEFAULTS, SETTLEMENT_CONFIG } = await import('/src/3d/config.js');
			const { createHeightSampler } = await import('/src/3d/world/terrain.js');
			const { KINGDOM_SEATS, computeSettlementFlattenPads, mapToWorldXZ } = await import('/src/3d/world/settlements.js');
			const { computeSeatMST } = await import('/src/3d/world/roads.js');
			const { findSlopeAwarePath } = await import('/src/3d/world/roadPathfinder.js');
			const { createWater, updateWater, disposeWater } = await import('/src/3d/world/water.js');
			const { mapCanvasToNormalizedReference } = await import('/src/3d/world/worldReferenceAlignment.js');
			const { referenceProtectionRadiiFromMeters, sampleSeatSafeReferenceHydrology } = await import('/src/3d/world/worldReferenceHydrology.js');
			const {
				FULL_REFERENCE_MAP_BOUNDS,
				FULL_REFERENCE_WORLD_MIGRATION_PLAN,
				plannedWorldXZToMapCanvas,
			} = await import('/src/3d/world/worldReferenceMigrationPlan.js');
			const { createCanonicalHydrologyTerrainSampler } = await import('/src/3d/world/worldReferenceTerrainAdapter.js');
			const { createCanonicalTerrainShadowChunk, disposeCanonicalTerrainShadowChunk } = await import('/src/3d/world/worldReferenceChunkShadow.js');
			const {
				STONE_BRIDGE_OWNER_POLICY,
				buildCanonicalStoneBridgePlan,
				createCanonicalStoneBridgeGeometry,
				disposeCanonicalStoneBridgeGeometry,
			} = await import('/src/3d/world/worldReferenceStoneBridgeShadow.js');

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
			const hydrologyAtWorld = (x, z) => {
				const map = plannedWorldXZToMapCanvas(x, z);
				const normalized = mapCanvasToNormalizedReference(map.x, map.y);
				return sampleSeatSafeReferenceHydrology(normalized.x, normalized.y, protectedSites, protectionRadii);
			};

			const seats = KINGDOM_SEATS.map((seat) => ({
				id: seat.id,
				...mapToWorldXZ(seat.mapX, seat.mapY, FULL_REFERENCE_MAP_BOUNDS, plan.metersPerMapUnit),
			}));
			const seatById = new Map(seats.map((seat) => [seat.id, seat]));
			const routes = [];
			for (const edge of computeSeatMST(seats)) {
				const route = findSlopeAwarePath({ sampleHeightMeters: sampler, start: seatById.get(edge.fromId), end: seatById.get(edge.toId) });
				routes.push({ edgeId: `${edge.fromId}->${edge.toId}`, fromId: edge.fromId, toId: edge.toId, points: route.points });
			}

			const bridgePlan = buildCanonicalStoneBridgePlan();
			const bridgesByEdge = new Map();
			for (const bridge of bridgePlan.bridges) {
				if (!bridgesByEdge.has(bridge.edgeId)) bridgesByEdge.set(bridge.edgeId, []);
				bridgesByEdge.get(bridge.edgeId).push(bridge);
			}
			for (const list of bridgesByEdge.values()) list.sort((a, b) => a.crossingIndex - b.crossingIndex);

			const distance2 = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
			const gradeDegrees = (a, b) => THREE.MathUtils.radToDeg(Math.atan2(Math.abs(b.y - a.y), Math.max(0.001, distance2(a, b))));
			const nearestPointIndex = (points, target, minIndex = 0, maxIndex = points.length - 1) => {
				let best = minIndex;
				let bestDistance = Infinity;
				for (let index = minIndex; index <= maxIndex; index += 1) {
					const d = Math.hypot(points[index].x - target.x, points[index].z - target.z);
					if (d < bestDistance) { bestDistance = d; best = index; }
				}
				return best;
			};
			const approachPlans = [];
			const suppressionByEdge = new Map();
			let coveredWaterRoutePoints = 0;
			let totalWaterRoutePoints = 0;

			for (const route of routes) {
				const edgeBridges = bridgesByEdge.get(route.edgeId) || [];
				const ranges = [];
				let searchFloor = 0;
				for (const bridge of edgeBridges) {
					const deckTopY = bridge.deckY + STONE_BRIDGE_OWNER_POLICY.deckThicknessMeters * 0.5 + 0.04;
					const startTarget = { x: bridge.startX, y: deckTopY, z: bridge.startZ };
					const endTarget = { x: bridge.endX, y: deckTopY, z: bridge.endZ };
					let startIndex = nearestPointIndex(route.points, startTarget, searchFloor);
					let endIndex = nearestPointIndex(route.points, endTarget, startIndex);
					if (endIndex < startIndex) [startIndex, endIndex] = [endIndex, startIndex];

					let startApproachIndex = -1;
					for (let index = startIndex; index >= searchFloor; index -= 1) {
						const point = route.points[index];
						if (hydrologyAtWorld(point.x, point.z).water) continue;
						const candidate = { x: point.x, y: sampler(point.x, point.z) + 0.4, z: point.z };
						if (distance2(candidate, startTarget) <= maxApproachLength && gradeDegrees(candidate, startTarget) <= maxGrade) {
							startApproachIndex = index;
							break;
						}
					}
					let endApproachIndex = -1;
					for (let index = endIndex; index < route.points.length; index += 1) {
						const point = route.points[index];
						if (hydrologyAtWorld(point.x, point.z).water) continue;
						const candidate = { x: point.x, y: sampler(point.x, point.z) + 0.4, z: point.z };
						if (distance2(candidate, endTarget) <= maxApproachLength && gradeDegrees(candidate, endTarget) <= maxGrade) {
							endApproachIndex = index;
							break;
						}
					}
					if (startApproachIndex < 0 || endApproachIndex < 0) throw new Error(`${bridge.id}: no <=${maxGrade}deg bounded dry-bank approach found`);
					const startPointRaw = route.points[startApproachIndex];
					const endPointRaw = route.points[endApproachIndex];
					const startPoint = { x: startPointRaw.x, y: sampler(startPointRaw.x, startPointRaw.z) + 0.4, z: startPointRaw.z };
					const endPoint = { x: endPointRaw.x, y: sampler(endPointRaw.x, endPointRaw.z) + 0.4, z: endPointRaw.z };
					approachPlans.push({ bridgeId: bridge.id, edgeId: route.edgeId, side: 'start', from: startPoint, to: startTarget, gradeDegrees: gradeDegrees(startPoint, startTarget), lengthMeters: distance2(startPoint, startTarget) });
					approachPlans.push({ bridgeId: bridge.id, edgeId: route.edgeId, side: 'end', from: endTarget, to: endPoint, gradeDegrees: gradeDegrees(endTarget, endPoint), lengthMeters: distance2(endTarget, endPoint) });
					ranges.push({ bridgeId: bridge.id, startIndex: startApproachIndex, endIndex: endApproachIndex });
					searchFloor = Math.min(route.points.length - 1, endApproachIndex + 1);
				}
				suppressionByEdge.set(route.edgeId, ranges);
				for (let index = 0; index < route.points.length; index += 1) {
					if (!hydrologyAtWorld(route.points[index].x, route.points[index].z).water) continue;
					totalWaterRoutePoints += 1;
					if (ranges.some((range) => index >= range.startIndex && index <= range.endIndex)) coveredWaterRoutePoints += 1;
				}
			}

			const roadPositions = [];
			const roadIndices = [];
			const appendRibbonRun = (points) => {
				if (points.length < 2) return;
				const halfWidth = STONE_BRIDGE_OWNER_POLICY.bridgeWidthMeters * 0.5;
				const baseVertex = roadPositions.length / 3;
				for (let index = 0; index < points.length; index += 1) {
					const point = points[index];
					const prev = points[Math.max(0, index - 1)];
					const next = points[Math.min(points.length - 1, index + 1)];
					const tx = next.x - prev.x;
					const tz = next.z - prev.z;
					const length = Math.hypot(tx, tz) || 1;
					const px = -tz / length;
					const pz = tx / length;
					roadPositions.push(point.x + px * halfWidth, point.y, point.z + pz * halfWidth, point.x - px * halfWidth, point.y, point.z - pz * halfWidth);
					if (index > 0) {
						const left = baseVertex + index * 2;
						roadIndices.push(left - 2, left - 1, left, left - 1, left + 1, left);
					}
				}
			};
			let renderedDryRoadPointCount = 0;
			for (const route of routes) {
				const ranges = suppressionByEdge.get(route.edgeId) || [];
				let run = [];
				for (let index = 0; index < route.points.length; index += 1) {
					const point = route.points[index];
					const suppressed = ranges.some((range) => index >= range.startIndex && index <= range.endIndex);
					const water = hydrologyAtWorld(point.x, point.z).water;
					if (suppressed || water) {
						appendRibbonRun(run); run = []; continue;
					}
					renderedDryRoadPointCount += 1;
					run.push({ x: point.x, y: sampler(point.x, point.z) + 0.4, z: point.z });
				}
				appendRibbonRun(run);
			}
			const roadGeometry = new THREE.BufferGeometry();
			roadGeometry.setAttribute('position', new THREE.Float32BufferAttribute(roadPositions, 3));
			roadGeometry.setIndex(roadIndices);
			roadGeometry.computeVertexNormals();
			roadGeometry.computeBoundingSphere();
			const roadMaterial = new THREE.MeshStandardMaterial({ color: 0x82623c, roughness: 0.95, metalness: 0, side: THREE.DoubleSide });
			const roadMesh = new THREE.Mesh(roadGeometry, roadMaterial);
			roadMesh.name = 'run192-canonical-dry-road-shadow';

			const approachGeometry = new THREE.BoxGeometry(1, 1, 1);
			const approachMaterial = new THREE.MeshStandardMaterial({ color: 0x98836a, roughness: 0.96, metalness: 0 });
			const approachMesh = new THREE.InstancedMesh(approachGeometry, approachMaterial, approachPlans.length);
			approachMesh.count = approachPlans.length;
			const xAxis = new THREE.Vector3(1, 0, 0);
			for (let index = 0; index < approachPlans.length; index += 1) {
				const approach = approachPlans[index];
				const from = new THREE.Vector3(approach.from.x, approach.from.y, approach.from.z);
				const to = new THREE.Vector3(approach.to.x, approach.to.y, approach.to.z);
				const delta = to.clone().sub(from);
				const length = delta.length();
				const matrix = new THREE.Matrix4();
				const quaternion = new THREE.Quaternion().setFromUnitVectors(xAxis, delta.clone().normalize());
				matrix.compose(from.clone().add(to).multiplyScalar(0.5), quaternion, new THREE.Vector3(length, 0.28, STONE_BRIDGE_OWNER_POLICY.bridgeWidthMeters));
				approachMesh.setMatrixAt(index, matrix);
			}
			approachMesh.instanceMatrix.needsUpdate = true;
			approachMesh.name = 'run192-bridge-approach-ramps-shadow';

			const bridgeGroup = createCanonicalStoneBridgeGeometry({ bridges: bridgePlan.bridges });
			const scene = new THREE.Scene();
			scene.background = new THREE.Color(0x98b2c1);
			scene.add(roadMesh, approachMesh, bridgeGroup);
			const ambient = new THREE.HemisphereLight(0xe9f2ff, 0x44513b, 1.6);
			const sun = new THREE.DirectionalLight(0xffe3b3, 2.1);
			sun.position.set(280, 430, 180);
			scene.add(ambient, sun);

			const targetBridge = [...bridgePlan.bridges].sort((a, b) => a.structuralSpanMeters - b.structuralSpanMeters)[0];
			const chunkSize = plan.chunkSizeMeters;
			const targetChunkX = Math.round(targetBridge.centerX / chunkSize);
			const targetChunkZ = Math.round(targetBridge.centerZ / chunkSize);
			const terrainChunks = [];
			for (let dx = -1; dx <= 1; dx += 1) for (let dz = -1; dz <= 1; dz += 1) {
				const mesh = createCanonicalTerrainShadowChunk({ chunkX: targetChunkX + dx, chunkZ: targetChunkZ + dz, size: chunkSize, segments: 32, sampleHeightMeters: sampler, seaLevelMeters: sea });
				terrainChunks.push(mesh); scene.add(mesh);
			}
			const water = createWater(sea);
			scene.add(water);

			const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
			renderer.setPixelRatio(1);
			renderer.setSize(1280, 720, false);
			document.body.innerHTML = '';
			document.body.style.margin = '0';
			document.body.style.overflow = 'hidden';
			document.body.appendChild(renderer.domElement);
			const camera = new THREE.PerspectiveCamera(58, 1280 / 720, 0.5, 1800);
			const axisX = (targetBridge.endX - targetBridge.startX) / targetBridge.structuralSpanMeters;
			const axisZ = (targetBridge.endZ - targetBridge.startZ) / targetBridge.structuralSpanMeters;
			const sideX = -axisZ;
			const sideZ = axisX;

			const bridgeSpheres = bridgePlan.bridges.map((bridge) => ({
				id: bridge.id,
				sphere: new THREE.Sphere(new THREE.Vector3(bridge.centerX, bridge.deckY, bridge.centerZ), Math.max(bridge.bridgeWidthMeters, bridge.structuralSpanMeters * 0.52)),
			}));
			const nearView = () => {
				camera.position.set(targetBridge.centerX + sideX * 110 - axisX * 90, targetBridge.deckY + 55, targetBridge.centerZ + sideZ * 110 - axisZ * 90);
				camera.lookAt(targetBridge.centerX, targetBridge.deckY, targetBridge.centerZ);
				camera.updateMatrixWorld(true);
				updateWater(water, camera.position, 3.5);
				renderer.render(scene, camera);
			};
			const farView = () => {
				camera.position.set(targetBridge.centerX + sideX * 320 - axisX * 280, targetBridge.deckY + 150, targetBridge.centerZ + sideZ * 320 - axisZ * 280);
				camera.lookAt(targetBridge.centerX, targetBridge.deckY, targetBridge.centerZ);
				camera.updateMatrixWorld(true);
				updateWater(water, camera.position, 7.5);
				renderer.render(scene, camera);
			};
			nearView();

			const projection = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
			const frustum = new THREE.Frustum().setFromProjectionMatrix(projection);
			const nearVisibleBridgeIds = bridgeSpheres.filter((entry) => frustum.intersectsSphere(entry.sphere)).map((entry) => entry.id);

			const bridgeDeckHeightAt = (x, z) => {
				for (const bridge of bridgePlan.bridges) {
					const dx = bridge.endX - bridge.startX;
					const dz = bridge.endZ - bridge.startZ;
					const length = Math.hypot(dx, dz) || 1;
					const ux = dx / length;
					const uz = dz / length;
					const rx = x - bridge.startX;
					const rz = z - bridge.startZ;
					const along = rx * ux + rz * uz;
					const lateral = Math.abs(rx * -uz + rz * ux);
					if (along >= 0 && along <= bridge.structuralSpanMeters && lateral <= bridge.bridgeWidthMeters * 0.5) {
						return bridge.deckY + STONE_BRIDGE_OWNER_POLICY.deckThicknessMeters * 0.5;
					}
				}
				return null;
			};
			const colliderProbeHeights = bridgePlan.bridges.map((bridge) => ({ id: bridge.id, y: bridgeDeckHeightAt(bridge.centerX, bridge.centerZ), terrainY: sampler(bridge.centerX, bridge.centerZ) }));

			const bridgeTriangles = bridgeGroup.children.reduce((sum, mesh) => {
				const baseTriangles = mesh.geometry.index ? mesh.geometry.index.count / 3 : mesh.geometry.getAttribute('position').count / 3;
				return sum + baseTriangles * mesh.count;
			}, 0);
			const roadTriangles = roadGeometry.index.count / 3;
			const approachTriangles = approachGeometry.index.count / 3 * approachMesh.count;
			const coreDrawCalls = 1 + bridgeGroup.children.length + 1;
			const coreTriangles = Math.round(roadTriangles + bridgeTriangles + approachTriangles);
			const renderStats = { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles };

			window.__run192SetFar = farView;
			window.__run192Dispose = () => {
				for (const mesh of terrainChunks) { scene.remove(mesh); disposeCanonicalTerrainShadowChunk(mesh); }
				scene.remove(water); disposeWater(water);
				scene.remove(bridgeGroup); disposeCanonicalStoneBridgeGeometry(bridgeGroup);
				scene.remove(roadMesh, approachMesh);
				roadGeometry.dispose(); roadMaterial.dispose(); approachGeometry.dispose(); approachMaterial.dispose();
				renderer.dispose();
				return { bridgeChildren: bridgeGroup.children.length, canvasCount: document.querySelectorAll('canvas').length };
			};

			return {
				policy: bridgePlan.policy,
				bridgeCount: bridgePlan.bridges.length,
				affectedEdges: bridgePlan.affectedEdges,
				totalWaterRoutePoints,
				coveredWaterRoutePoints,
				renderedDryRoadPointCount,
				approachCount: approachPlans.length,
				maxApproachGradeDegrees: Math.max(...approachPlans.map((entry) => entry.gradeDegrees)),
				maxApproachLengthMeters: Math.max(...approachPlans.map((entry) => entry.lengthMeters)),
				coreDrawCalls,
				coreTriangles,
				renderStats,
				nearVisibleBridgeIds,
				targetBridgeId: targetBridge.id,
				colliderProbeHeights,
				bridgeChecksumInputs: bridgePlan.bridges.map((bridge) => [bridge.id, bridge.structuralSpanMeters, bridge.archCount, bridge.deckY]),
			};
		}, { maxGrade: MAX_APPROACH_GRADE_DEGREES, maxApproachLength: MAX_APPROACH_LENGTH_METERS });

		await page.screenshot({ path: path.join(OUT, 'road-bridge-near.png') });
		await page.evaluate(() => window.__run192SetFar());
		await page.screenshot({ path: path.join(OUT, 'road-bridge-far.png') });
		report.dispose = await page.evaluate(() => window.__run192Dispose());
	} finally {
		await browser.close();
		server.close();
	}

	assert(report.policy === 'stone-arch-bridge', `unexpected policy ${report.policy}`);
	assert(report.bridgeCount === 7, `expected 7 bridges, got ${report.bridgeCount}`);
	assert(report.affectedEdges.length === 6, `expected 6 affected edges, got ${report.affectedEdges.length}`);
	assert(report.totalWaterRoutePoints > 0, 'canonical routes produced no water points');
	assert(report.coveredWaterRoutePoints === report.totalWaterRoutePoints, `water-route suppression coverage ${report.coveredWaterRoutePoints}/${report.totalWaterRoutePoints}`);
	assert(report.approachCount === report.bridgeCount * 2, `expected ${report.bridgeCount * 2} approaches, got ${report.approachCount}`);
	assert(report.maxApproachGradeDegrees <= MAX_APPROACH_GRADE_DEGREES + 1e-9, `approach grade ${report.maxApproachGradeDegrees} > ${MAX_APPROACH_GRADE_DEGREES}`);
	assert(report.maxApproachLengthMeters <= MAX_APPROACH_LENGTH_METERS + 1e-9, `approach length ${report.maxApproachLengthMeters} > ${MAX_APPROACH_LENGTH_METERS}`);
	assert(report.coreDrawCalls <= 8, `core road+bridge scene draw calls ${report.coreDrawCalls} > 8`);
	assert(report.coreTriangles < 100000, `core road+bridge scene triangles ${report.coreTriangles} >= 100000`);
	assert(report.nearVisibleBridgeIds.includes(report.targetBridgeId), 'near camera frustum misses target bridge');
	assert(report.nearVisibleBridgeIds.length < report.bridgeCount, `near camera frustum sees all ${report.bridgeCount} bridges; culling proof is not bounded`);
	for (const probe of report.colliderProbeHeights) {
		assert(Number.isFinite(probe.y), `${probe.id}: bridge collider resolver missed deck center`);
		assert(probe.y > probe.terrainY, `${probe.id}: bridge deck collider is not above underlying terrain`);
	}
	assert(report.dispose.bridgeChildren === 0, `bridge dispose left ${report.dispose.bridgeChildren} children`);
	assert(fs.statSync(path.join(OUT, 'road-bridge-near.png')).size > 0, 'near visual evidence missing');
	assert(fs.statSync(path.join(OUT, 'road-bridge-far.png')).size > 0, 'far visual evidence missing');

	fs.writeFileSync(path.join(OUT, 'proof.json'), JSON.stringify(report, null, 2));
	const summary = `${report.bridgeCount} bridges / ${report.approachCount} bounded approaches / water suppression ${report.coveredWaterRoutePoints}/${report.totalWaterRoutePoints} route points / max approach ${report.maxApproachGradeDegrees.toFixed(2)}deg over ${report.maxApproachLengthMeters.toFixed(1)}m / core ${report.coreDrawCalls} calls ${report.coreTriangles} triangles / near frustum ${report.nearVisibleBridgeIds.length}/${report.bridgeCount}`;
	console.log(`[checkCanonicalRoadBridgeSceneShadow] CORE: ${JSON.stringify({ drawCalls: report.coreDrawCalls, triangles: report.coreTriangles })}`);
	console.log(`[checkCanonicalRoadBridgeSceneShadow] PASS: ${summary}`);
}

main().catch((error) => {
	console.error('[checkCanonicalRoadBridgeSceneShadow] FAIL:', error && error.stack ? error.stack : error);
	process.exit(1);
});
