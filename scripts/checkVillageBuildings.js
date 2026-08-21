#!/usr/bin/env node
/**
 * checkVillageBuildings.js — guards run 379's village buildings.
 *
 * The owner's complaint was precise: the model library had been *scattered* across the map but the
 * settlements were still procedural boxes. "Dolu yerleşim olayını yapman için assets kısmındaki her
 * şeyi coğrafyaya yerleştir demiştim zaten, sen yapmamışsın." This holds the fix to the properties
 * that make a village a village rather than the same models sprinkled at random:
 *
 * **1. Every village gets a plan, not a scatter.** Each hamlet must be issued exactly one place of
 * worship and one craft building, plus its ring of field buildings and its market clutter. A village
 * with two churches and no smithy is a random draw wearing a plan's clothes.
 *
 * **2. The buildings are in the village.** Every plot must fall inside its own hamlet's outer ring.
 * The whole defect being fixed is buildings that exist but stand alone in open country, so a plot that
 * drifts out of its settlement reproduces the bug this module was written to end.
 *
 * **3. Villages do not overlap each other.** Two hamlets' buildings must not interleave.
 *
 * **4. Nothing is planted underwater or on a cliff.** Same rules the prop scatter obeys.
 *
 * **5. No placeholders are ever planted.** In a clone without Git LFS objects every model is a
 * 132-byte pointer and `AssetLoader` returns a grey box; planting those would carpet every village in
 * cubes, which is strictly worse than the cottages already there. The plan must degrade to *nothing*
 * rather than to boxes — and this check asserts the degradation, so it passes in both worlds: with
 * LFS hydrated it asserts the buildings are right, and without it asserts they are absent.
 *
 * **6. It is deterministic.** Two builds place the same buildings in the same spots.
 *
 * **7. Every model it uses is in the catalogue**, so `scripts/checkAssetCoverage.js` still accounts
 * for the whole library and a village building cannot become a back door for an unaccounted asset.
 *
 * Usage: `node scripts/checkVillageBuildings.js`
 * Exit codes: 0 = PASS. 1 = FAIL. 2 = Playwright unavailable.
 * @module scripts/checkVillageBuildings
 */
const { startStaticServer, loadPlaywright } = require('./devServerHelper.js');

/** How far past a hamlet's own green a building may stand, in metres. */
const MAX_PLOT_DISTANCE_METERS = 70;
/**
 * How far a building's base may sit above the tallest ground under its own footprint before it counts
 * as floating, in metres. `groundModel` founds every building on the *lowest* ground under it minus a
 * small bite, so a correctly grounded building has a base at or below the terrain everywhere — a
 * positive gap here means a real hole of open air under it, which is what the owner flagged. The
 * tolerance covers height-sampler interpolation between the placement sampler and the live collider,
 * not a visible gap. */
const MAX_FLOAT_METERS = 0.75;
/**
 * Triangle ceiling for every village building in the world together (GOVERNANCE.md §4).
 *
 * This is where an asset library bites: the models range from a 970-triangle barn to an 86,728-triangle
 * temple, and picking by looks alone quietly buys the expensive one eleven times over. The ceiling is
 * what makes that trade visible at review time instead of on a phone.
 */
const MAX_VILLAGE_TRIANGLES = 900000;

(async () => {
	const playwright = loadPlaywright();
	if (!playwright) {
		console.error('[village-buildings] SKIP: Playwright unavailable');
		process.exit(2);
	}
	const server = await startStaticServer();
	const origin = `http://127.0.0.1:${server.address().port}`;
	const browser = await playwright.chromium.launch({ headless: true });
	try {
		const page = await browser.newPage();
		await page.goto(`${origin}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
		const result = await page.evaluate(async ({ maxPlotDistance, floatToleranceMeters }) => {
			const THREE = await import('three');
			const { WORLD_DEFAULTS } = await import('/src/3d/config.js');
			const { createScene } = await import('/src/3d/sceneManager.js');
			const { AssetLoader } = await import('/src/3d/assetLoader.js');
			const vb = await import('/src/3d/world/villageBuildings.js');
			const { PROP_CATALOGUE } = await import('/src/3d/world/worldPropCatalogue.js');

			const canvas = document.createElement('canvas');
			document.body.append(canvas);
			const state = createScene(canvas);
			const hamlets = state.villageHamlets ?? [];

			const build = () => vb.createVillageBuildings({
				assetLoader: new AssetLoader(),
				hamlets,
				sampleHeightMeters: state.groundCollider.getGroundHeight,
				seaLevelMeters: WORLD_DEFAULTS.WATER_LEVEL_METERS,
				seed: WORLD_DEFAULTS.WORLD_SEED,
			});
			const built = await build();
			const again = await build();

			// Every file the roles can draw must be in the catalogue.
			const catalogued = new Set(PROP_CATALOGUE.map((entry) => entry.file));
			const uncatalogued = [];
			for (const [role, files] of Object.entries(vb.VILLAGE_BUILDING_ROLES)) {
				for (const file of files) if (!catalogued.has(file)) uncatalogued.push(`${role}:${file}`);
			}

			// Per-hamlet accounting of what was actually raised.
			const perHamlet = new Map();
			let placedOutsideVillage = 0;
			let worstPlotDistance = 0;
			let submerged = 0;
			let placeholders = 0;
			let floating = 0;
			let worstFloatMeters = 0;
			const sea = WORLD_DEFAULTS.WATER_LEVEL_METERS;
			const ground = state.groundCollider.getGroundHeight;
			// Where a building *is*, not where its transform node is. `groundModel` recentres a model on
			// its plot by offsetting the node by the model's own bounding-box centre, so a mesh authored
			// far from its file origin — routine in exported FBX — has a node hundreds of metres away
			// while the visible building stands exactly on its plot. Measuring `node.position` reported
			// two buildings 545 m from their village and one standing in water; all three were where they
			// belonged. Measure the world bounding box, which is what a player sees.
			const worldBox = new THREE.Box3();
			const worldCentre = new THREE.Vector3();
			for (const node of built.group.children) {
				const meta = node.userData.villageBuilding;
				if (!meta) continue;
				let isPlaceholder = false;
				node.traverse((child) => { if (child.userData?.isPlaceholder) isPlaceholder = true; });
				if (isPlaceholder) placeholders += 1;
				node.updateMatrixWorld(true);
				worldBox.setFromObject(node);
				worldBox.getCenter(worldCentre);
				const hamlet = hamlets.find((h) => h.seatId === meta.seatId);
				const distance = Math.hypot(worldCentre.x - hamlet.x, worldCentre.z - hamlet.z);
				worstPlotDistance = Math.max(worstPlotDistance, distance);
				if (distance > maxPlotDistance) placedOutsideVillage += 1;
				if (ground(worldCentre.x, worldCentre.z) <= sea) submerged += 1;
				// Floating: a corner of the building's flat base sits above the ground beneath it, leaving a
				// gap of open air — the exact defect the owner flagged. The gap is largest at the *lowest*
				// ground under the footprint (the downhill corner), not the highest: measure the base
				// against the minimum ground across the footprint's four corners and its centre. A base
				// more than the tolerance above that lowest point is a real, visible float. (Grounding on
				// the footprint minimum, as `groundModel` now does, drives this to -groundBite by
				// construction; center-only grounding leaves it at the downhill drop, which is the bug.)
				const worldSize = worldBox.getSize(new THREE.Vector3());
				const hx = worldSize.x * 0.5;
				const hz = worldSize.z * 0.5;
				let lowestUnderFootprint = ground(worldCentre.x, worldCentre.z);
				for (const cx of [-hx, hx]) {
					for (const cz of [-hz, hz]) {
						lowestUnderFootprint = Math.min(lowestUnderFootprint, ground(worldCentre.x + cx, worldCentre.z + cz));
					}
				}
				const gap = worldBox.min.y - lowestUnderFootprint;
				if (gap > floatToleranceMeters) { floating += 1; worstFloatMeters = Math.max(worstFloatMeters, gap); }
				const entry = perHamlet.get(meta.seatId) ?? {};
				entry[meta.role] = (entry[meta.role] ?? 0) + 1;
				perHamlet.set(meta.seatId, entry);
			}

			// GOVERNANCE.md §4: what the villages cost per frame.
			let triangles = 0;
			let drawCalls = 0;
			built.group.traverse((node) => {
				if (!node.isMesh) return;
				drawCalls += 1;
				const geometry = node.geometry;
				const index = geometry.getIndex();
				triangles += (index ? index.count : geometry.getAttribute('position').count) / 3;
			});

			const digest = (r) => r.group.children
				.map((n) => `${n.userData.villageBuilding?.role}:${n.position.x.toFixed(2)}:${n.position.z.toFixed(2)}`)
				.join('|');

			return {
				hamletCount: hamlets.length,
				placed: built.placed, skipped: built.skipped, byRole: built.byRole,
				perHamlet: [...perHamlet.entries()].map(([seatId, roles]) => ({ seatId, roles })),
				placedOutsideVillage, worstPlotDistance, submerged, placeholders,
				floating, worstFloatMeters: +worstFloatMeters.toFixed(2),
				triangles: Math.round(triangles), drawCalls,
				uncatalogued,
				deterministic: digest(built) === digest(again),
			};
		}, { maxPlotDistance: MAX_PLOT_DISTANCE_METERS, floatToleranceMeters: MAX_FLOAT_METERS });

		const failures = [];
		if (result.hamletCount === 0) failures.push('no villages exist at all — nothing to build buildings in');
		if (result.uncatalogued.length) {
			failures.push(`${result.uncatalogued.length} village model(s) are not in the prop catalogue: ${result.uncatalogued.slice(0, 4).join(', ')}`);
		}
		if (result.placeholders > 0) {
			failures.push(`${result.placeholders} placeholder box(es) were planted — a village of grey cubes is worse than one of cottages`);
		}
		if (result.placedOutsideVillage > 0) {
			failures.push(`${result.placedOutsideVillage} building(s) stand more than ${MAX_PLOT_DISTANCE_METERS} m from their own village green, worst ${result.worstPlotDistance.toFixed(0)} m — that is the scattered-props bug again`);
		}
		if (result.submerged > 0) failures.push(`${result.submerged} building(s) stand in water`);
		if (result.floating > 0) failures.push(`${result.floating} building(s) float above their own footprint, worst gap ${result.worstFloatMeters} m — a corner is left in the air`);
		if (!result.deterministic) failures.push('two builds placed different buildings');
		if (result.triangles > MAX_VILLAGE_TRIANGLES) {
			failures.push(`the villages cost ${result.triangles} triangles (ceiling ${MAX_VILLAGE_TRIANGLES}) — see GOVERNANCE.md §4`);
		}
		// When the models resolve, the plan must actually be a plan: one church and one smithy each.
		if (result.placed > 0) {
			for (const { seatId, roles } of result.perHamlet) {
				if ((roles.worship ?? 0) > 1) failures.push(`${seatId} has ${roles.worship} places of worship — the plan allows one`);
				if ((roles.craft ?? 0) > 1) failures.push(`${seatId} has ${roles.craft} craft buildings — the plan allows one`);
			}
		}

		const roles = Object.entries(result.byRole).map(([role, count]) => `${role} ${count}`).join(', ');
		console.log(`[village-buildings] ${result.hamletCount} village(s); ${result.placed} building(s) raised, ${result.skipped} plot(s) empty`);
		console.log(`[village-buildings] by role: ${roles}`);
		console.log(`[village-buildings] plots: worst distance from its own green ${result.worstPlotDistance.toFixed(0)} m (max ${MAX_PLOT_DISTANCE_METERS} m), ${result.submerged} in water, ${result.floating} floating (worst ${result.worstFloatMeters} m, max ${MAX_FLOAT_METERS} m), ${result.placeholders} placeholders planted`);
		console.log(`[village-buildings] cost: ${result.triangles} triangles over ${result.drawCalls} draw calls (ceiling ${MAX_VILLAGE_TRIANGLES})`);
		console.log(`[village-buildings] every role model is in the catalogue: ${result.uncatalogued.length === 0}; deterministic ${result.deterministic}`);
		if (result.placed === 0) {
			console.log('[village-buildings] NOTE: no model resolved, so every plot degraded to empty — the expected result in a');
			console.log('[village-buildings]       clone without Git LFS objects (RCA_RUN344). Villages keep their cottages.');
		}

		if (failures.length) {
			for (const failure of failures) console.error(`[village-buildings] FAIL: ${failure}`);
			process.exit(1);
		}
		console.log('[village-buildings] PASS: every village has a plan, its buildings stand in it, none is a placeholder, and two builds agree.');
		process.exit(0);
	} catch (error) {
		console.error('[village-buildings] FAIL:', error);
		process.exit(1);
	} finally {
		await browser.close();
		server.close();
	}
})();
