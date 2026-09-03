#!/usr/bin/env node
/**
 * checkRoadRibbonGrounding.js — guards that roads lie on the ground rather than over it.
 *
 * **The defect.** `appendRoadRibbon` built both edges of the ribbon at `point.y`, the terrain height
 * sampled at the *centre* of the road. That is only right where the ground is level across the road's
 * width. On a cross-slope the ribbon stays horizontal while the ground under it tilts, so the downhill
 * edge lifts into the air by half the width times the cross-grade — an 8 m cart road on a 30-degree
 * cross-slope floats its downhill edge 2.3 m — while the uphill edge buries itself. It showed up as a
 * pale sheet standing off a hillside beside a village, which is how it was found: by looking at a
 * render, not from any gate.
 *
 * It is the same mistake `world/villageBuildings.js` made with buildings, and it has the same shape:
 * one height sample used for something that has width.
 *
 * **What is measured.** Every vertex of both road meshes, against the live ground collider directly
 * beneath it. A road is allowed to sit slightly proud of the terrain — `VERTICAL_OFFSET_METERS` lifts
 * it 0.4 m deliberately so it does not z-fight with the ground — and terrain interpolation between the
 * chunk mesh and the collider adds a little more. Anything past that is a real hole of daylight under
 * the road.
 *
 * Usage: `node scripts/checkRoadRibbonGrounding.js`
 * Exit codes: 0 = PASS. 1 = FAIL. 2 = Playwright unavailable.
 * @module scripts/checkRoadRibbonGrounding
 */
const { startStaticServer, loadPlaywright } = require('./devServerHelper.js');

/**
 * How far a road vertex may stand above the ground under it, in metres.
 *
 * `VERTICAL_OFFSET_METERS` is 0.4 by design. 1.2 leaves room for that plus sampler interpolation
 * without admitting a real float: the centreline-only bug produced 2 m and more on ordinary hillsides.
 */
const MAX_VERTEX_FLOAT_METERS = 1.2;
/** How far below the ground a vertex may sink before the road is buried rather than laid. */
const MAX_VERTEX_BURY_METERS = 3.0;
/** Share of vertices allowed to exceed the float ceiling — none, but stated rather than implied. */
const MAX_FLOATING_FRACTION = 0.002;

(async () => {
	const playwright = loadPlaywright();
	if (!playwright) {
		console.error('[road-grounding] SKIP: Playwright unavailable');
		process.exit(2);
	}
	const server = await startStaticServer();
	const origin = `http://127.0.0.1:${server.address().port}`;
	const browser = await playwright.chromium.launch({ headless: true });
	try {
		const page = await browser.newPage();
		await page.goto(`${origin}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
		const result = await page.evaluate(async () => {
			const THREE = await import('three');
			const { createScene } = await import('/src/3d/sceneManager.js');
			const canvas = document.createElement('canvas');
			document.body.append(canvas);
			const state = createScene(canvas);
			const ground = state.groundCollider.getGroundHeight;

			// Both tiers of the MST network plus the canonical map highways — every road the player sees.
			const groups = [state.roads].filter(Boolean);
			for (const child of state.scene.children) {
				if (child.name === 'owner-map-roads') groups.push(child);
			}

			// Vertices must be measured in **world** space: a mesh sitting under a translated group would
			// otherwise be compared against the ground somewhere else entirely.
			const vertex = new THREE.Vector3();
			let vertices = 0;
			let floating = 0;
			let worstFloat = 0;
			let worstBury = 0;
			let worstAt = null;
			let deckVertices = 0;
			let worstDeckFloat = 0;
			const byMesh = new Map();
			for (const group of groups) {
				group.updateMatrixWorld(true);
				group.traverse((node) => {
					if (!node.isMesh || !node.geometry) return;
					const position = node.geometry.getAttribute('position');
					if (!position) return;
					// Run 441: a bridge deck is *supposed* to stand off the ground — that is what a bridge is.
					// `world/roadRiverBridges.js` marks the vertices it raised, so they are counted and
					// reported separately instead of being read as the ribbon failing to follow the terrain.
					// The exemption is precise: only vertices the deck attribute actually marks, and the
					// deck's own height is checked by `scripts/checkRoadRiverBridgeCrossings.js`.
					const deckCarry = node.geometry.getAttribute('roadBridgeDeck');
					for (let i = 0; i < position.count; i += 1) {
						vertex.fromBufferAttribute(position, i).applyMatrix4(node.matrixWorld);
						const gap = vertex.y - ground(vertex.x, vertex.z);
						vertices += 1;
						if (deckCarry && deckCarry.getX(i) > 0) {
							deckVertices += 1;
							if (gap > worstDeckFloat) worstDeckFloat = gap;
							continue;
						}
						if (gap > 1.2) {
							floating += 1;
							byMesh.set(node.name || '(unnamed)', (byMesh.get(node.name || '(unnamed)') ?? 0) + 1);
						}
						if (gap > worstFloat) {
							worstFloat = gap;
							worstAt = { x: Math.round(vertex.x), z: Math.round(vertex.z), mesh: node.name || '(unnamed)' };
						}
						if (-gap > worstBury) worstBury = -gap;
					}
				});
			}

			return {
				groupCount: groups.length,
				deckVertices,
				worstDeckFloat: Number(worstDeckFloat.toFixed(2)),
				vertices,
				floating,
				worstFloat: +worstFloat.toFixed(2),
				worstBury: +worstBury.toFixed(2),
				worstAt,
				byMesh: [...byMesh.entries()],
			};
		});

		const floatingFraction = result.vertices ? result.floating / result.vertices : 0;
		const failures = [];
		if (result.vertices === 0) failures.push('no road vertices found — the roads did not build');
		if (result.worstFloat > MAX_VERTEX_FLOAT_METERS) {
			failures.push(`a road vertex stands ${result.worstFloat} m above the ground at (${result.worstAt?.x}, ${result.worstAt?.z}) (max ${MAX_VERTEX_FLOAT_METERS} m) — the ribbon is not following the ground across its width`);
		}
		if (floatingFraction > MAX_FLOATING_FRACTION) {
			failures.push(`${result.floating} of ${result.vertices} road vertices float more than ${MAX_VERTEX_FLOAT_METERS} m`);
		}
		if (result.worstBury > MAX_VERTEX_BURY_METERS) {
			failures.push(`a road vertex is buried ${result.worstBury} m under the ground (max ${MAX_VERTEX_BURY_METERS} m)`);
		}

		console.log(`[road-grounding] ${result.vertices} vertices across ${result.groupCount} road group(s)`);
		console.log(`[road-grounding] worst float ${result.worstFloat} m (max ${MAX_VERTEX_FLOAT_METERS}), worst bury ${result.worstBury} m (max ${MAX_VERTEX_BURY_METERS}), ${result.floating} floating`);
		console.log(`[road-grounding] ${result.deckVertices} vertices carry a bridge deck and are exempt; the highest stands ${result.worstDeckFloat} m over the channel it spans`);
		console.log(`[road-grounding] worst vertex is in mesh "${result.worstAt?.mesh}"; floating by mesh: ${JSON.stringify(result.byMesh)}`);

		if (failures.length) {
			for (const failure of failures) console.error(`[road-grounding] FAIL: ${failure}`);
			process.exit(1);
		}
		console.log('[road-grounding] PASS: every road vertex lies on the ground beneath it.');
		process.exit(0);
	} catch (error) {
		console.error('[road-grounding] FAIL:', error);
		process.exit(1);
	} finally {
		await browser.close();
		server.close();
	}
})();
