/**
 * Village buildings — the church, the smithy, the barns and the market that turn a cluster of
 * cottages into a settlement, built from the real models in `assets/`.
 *
 * **What was wrong, in the owner's words.** "Dolu yerleşim olayını yapman için assets kısmındaki her
 * şeyi coğrafyaya yerleştir demiştim zaten, sen yapmamışsın." Runs 370 and 377 did place the whole
 * model library across the map — but `world/worldPropScatter.js` *scatters*: a barn on one hillside, a
 * house two kilometres away, each alone in open country. That is a furnished wilderness, not a
 * populated one. Meanwhile `world/villages.js` builds the actual settlements out of procedural boxes,
 * and its own header still says why: "there are none [no house models] in `assets_manifest.json`".
 * That was true when it was written and is not true now. The catalogue carries **21 dwellings, 10
 * barns and farms, 9 places of worship and 4 craft buildings**, and none of them had ever stood in a
 * village.
 *
 * **This is additive, and that is deliberate.** It does not replace `villages.js`'s cottages; it
 * raises the buildings a village has *besides* houses, on plots the cottages do not use. Two reasons.
 * First, every model in this repository is a Git LFS pointer in a fresh clone (RCA_RUN344), so a
 * village rebuilt entirely from models would render as **nothing at all** wherever LFS is not
 * hydrated — strictly worse than the boxes it replaced. Second, the cottages are already the right
 * scale and already carry collision circles. So the boxes stay as the dwellings that are always there,
 * and these are the church, the forge, the barns and the stalls that appear on top of them when the
 * real files resolve.
 *
 * **A village is a plan, not a scatter.** Each hamlet gets one place of worship and one craft
 * building on the edge of its green, its barns and farm buildings pushed out past the houses where
 * fields would be, and its stalls, carts and barrels in the middle where people would gather. Roles
 * are assigned by ring and bearing rather than by random draw, which is the whole difference between
 * a village and the same buildings sprinkled at random.
 *
 * **Placeholders are never planted**, the same rule `worldPropScatter.js` follows: `AssetLoader`
 * returns a visible box for a file it cannot read, and planting those would carpet every village in
 * grey cubes. A model that fails to load leaves its plot empty and the village keeps its cottages.
 *
 * **Textures** go through the same `normalisePropMaterials` discipline as the scatter — sRGB for
 * colour maps, linear for data maps, anisotropy on, shadows on — so a barn here is lit the same way a
 * barn on a hillside is.
 *
 * **Deterministic.** One `mulberry32` stream seeded from the world seed and the village's own index.
 * No `Math.random()`.
 *
 * @module world/villageBuildings
 */

import * as THREE from 'three';
import { mulberry32 } from './terrain.js';
import { loadPropModel } from './worldPropScatter.js';

export const VILLAGE_BUILDING_POLICY = Object.freeze({
	id: 'village-buildings-2026-08-21-v1',
	/** Ring the church and the smithy stand on: the edge of the green, past the cottages. */
	civicRingMeters: 30,
	/** Ring the barns and farm buildings stand on: outside the houses, where the fields start. */
	fieldRingMeters: 52,
	/** Radius the market clutter fills, in the middle of the green. */
	marketRadiusMeters: 12,
	/** Clearance kept between any two placed buildings. */
	minSpacingMeters: 9,
	/** Metres a building is sunk so its flat base never floats on the downhill side. */
	groundBiteMeters: 0.3,
	/** Slope above which a plot is refused — a barn does not stand on a cliff. */
	maxSlopeGrade: 0.32,
	/** Barns and farm buildings per village. */
	fieldBuildingCount: 3,
	/** Stalls, carts, barrels and crates on the green. */
	marketPropCount: 5,
	/**
	 * Fence runs around the green's edge — two, not four.
	 *
	 * `fence_fence.fbx` is 17,254 triangles for a rail fence, and at four per village it was **63% of
	 * every village building in the world put together** (500k of 800k) for the least visible thing in
	 * them. `world/villages.js` already draws the field walls that do this job as instanced geometry at
	 * almost no cost; these are variety on top of that, not the whole hedgerow.
	 */
	fenceCount: 2,
});

/**
 * What a village is made of, by role, as paths into `assets/models/`.
 *
 * Written out rather than pattern-matched off `PROP_CATALOGUE` on purpose: "which of these is a
 * church" is a judgement about the model, and a regex over filenames would silently promote the next
 * file whose name happens to contain "temple" into every village in Westeros. Every entry here is
 * also in the catalogue, so `scripts/checkAssetCoverage.js` still accounts for it.
 */
export const VILLAGE_BUILDING_ROLES = Object.freeze({
	/** One per village, on the green's edge — the tallest thing in the settlement after the castle. */
	worship: Object.freeze([
		'settlements/church_6vzTphxL9w4.glb',
		'settlements/church_GHzPfvoyzX.glb',
	]),
	/** One per village — where the work gets done. */
	craft: Object.freeze([
		'settlements/blacksmith_bV52eTG1Aj.glb',
		'settlements/barracks_UXCOwRBSxx.glb',
	]),
	/** The outer ring: barns, stables, silos, worked fields. */
	field: Object.freeze([
		'settlements/barn_0QTh_KUZRYE.glb',
		'settlements/barn_A6UkPq33aZ.glb',
		'settlements/barn_dSsUaUlaxHk.glb',
		'settlements/barn_vSqQNA7ez6.glb',
		'settlements/big_barn_q1N3xn2SpC.glb',
		'settlements/fantasy_stable_qhNQSOGGbi.glb',
		'settlements/silo_house_ZgstejsAcN.glb',
		'animals/farm_5GDbUJV2vQb.glb',
		'animals/farm_91wMLb9kKo.glb',
		'vegetation/crops_Ro6K0Yg7mx.glb',
	]),
	/** The green itself: things people put down and stand around. */
	market: Object.freeze([
		'props/barrel_zjCQP1TAci.glb',
		'props/crate_3OEFd1AWfa.glb',
		'props/bonfire_Azj9hJwwwG.glb',
		'fbx/Fountain_fount.fbx',
	]),
	/** Field boundaries. */
	fence: Object.freeze(['fbx/fence_fence.fbx']),
});

/**
 * **Two kinds of file were removed from these lists after being measured, not after being guessed.**
 *
 * *Asset packs.* `fbx/Medieval_Market_Asset_Pack.fbx` measures **7612 m x 377 m x 5710 m**: it is not a
 * market, it is ninety separate props laid out across several kilometres of empty space, the way a
 * store page arranges a pack for a screenshot. Normalising it to a 14 m footprint — the right thing to
 * do to a building — shrinks every object in it to a speck and centres the village's craft plot on the
 * middle of the empty grid between them. `fbx/Medieval_Market_.fbx` is the same pack at 156 MB. A pack
 * has to be split into its parts before any of them can be placed, which is real work and not this
 * module's.
 *
 * *Photogrammetry scans.* `fbx/wooden_military_crate_4k.fbx` is 58 MB and
 * `fbx/MedievalPackSTY_Chest1.fbx` is 35 MB — for a crate and a chest, sitting on a village green next
 * to a 970-triangle barn. `fbx/Free_temple_temple.fbx` is 86,728 triangles, which is one temple per
 * village against a whole world budget. They are all in the catalogue and still scattered by
 * `worldPropScatter.js`; they are simply not what a village should be built from.
 */

/**
 * Footprint per role, in metres — what each model is scaled to, and the room kept around it.
 *
 * `market` is 1.6 m and not 3 m because 3 m produced a crate on the village green taller than the
 * cottage beside it. These are the things a person picks up: a barrel is knee-high, a crate is
 * waist-high. Scale is the difference between a village square and a giant's toybox.
 */
const ROLE_FOOTPRINT_METERS = Object.freeze({
	worship: 16, craft: 14, field: 13, market: 1.6, fence: 6,
});

/**
 * Scales a loaded model to its role's footprint, then stands it on the terrain.
 *
 * **The scaling is not optional and forgetting it is spectacular.** These models come from a dozen
 * authors in a dozen unit conventions — metres, centimetres, whatever the exporter defaulted to — so a
 * barn dropped in at its own scale filled the entire frame from ninety metres away, a red wall taller
 * than the hill it stood on. `world/worldPropScatter.js` has always normalised the same way
 * (`footprintMeters / widest`); this simply did not, and one render made it obvious.
 *
 * The model's own bounding box then decides where its feet are, which is the only reliable way to
 * place files authored at a dozen different origins.
 *
 * @returns {number} The building's footprint radius in world metres, for spacing and collision.
 */
function groundModel(model, x, z, groundY, yaw, footprintMeters) {
	model.rotation.set(0, yaw, 0);
	model.scale.setScalar(1);
	model.position.set(0, 0, 0);
	model.updateMatrixWorld(true);
	const raw = new THREE.Box3().setFromObject(model);
	const rawSize = raw.getSize(new THREE.Vector3());
	const widest = Math.max(rawSize.x, rawSize.z) || 1;
	model.scale.setScalar(footprintMeters / widest);
	model.updateMatrixWorld(true);

	const box = new THREE.Box3().setFromObject(model);
	const size = box.getSize(new THREE.Vector3());
	const centre = box.getCenter(new THREE.Vector3());
	model.position.set(
		x - centre.x,
		groundY - box.min.y - VILLAGE_BUILDING_POLICY.groundBiteMeters,
		z - centre.z,
	);
	model.updateMatrixWorld(true);
	return Math.max(size.x, size.z) * 0.5;
}

/** Local grade over 12 m — enough to refuse a plot on a hillside, small enough to allow a slight rise. */
function localGrade(sampleHeightMeters, x, z, groundY) {
	return Math.max(
		Math.abs(sampleHeightMeters(x + 12, z) - groundY),
		Math.abs(sampleHeightMeters(x, z + 12) - groundY),
	) / 12;
}

/**
 * Builds the non-dwelling buildings of every village.
 *
 * @param {object} options
 * @param {import('../assetLoader.js').AssetLoader} options.assetLoader
 * @param {{seatId: string, x: number, z: number, radiusMeters: number}[]} options.hamlets
 *   `createVillages(...).hamlets` — the greens the cottages were built around.
 * @param {(x: number, z: number) => number} options.sampleHeightMeters
 * @param {number} options.seaLevelMeters
 * @param {number} options.seed
 * @returns {Promise<{group: THREE.Group, placed: number, skipped: number,
 *   byRole: Record<string, number>, buildings: {x: number, z: number, radius: number}[]}>}
 */
export async function createVillageBuildings({ assetLoader, hamlets, sampleHeightMeters, seaLevelMeters, seed }) {
	const P = VILLAGE_BUILDING_POLICY;
	const group = new THREE.Group();
	group.name = 'village-buildings';
	const byRole = { worship: 0, craft: 0, field: 0, market: 0, fence: 0 };
	const buildings = [];
	let placed = 0;
	let skipped = 0;

	/**
	 * One load per distinct file for the whole world, then cloned per plot.
	 *
	 * Shared with the scatter rather than reimplemented: `loadPropModel` routes `.fbx` to the FBX
	 * loader and everything else to the glTF one, and normalises the materials. A local copy here was
	 * glTF-only and silently dropped every FBX building — which is exactly the bug that had already
	 * cost the scatter a third of the catalogue.
	 */
	const cache = new Map();
	const loadOnce = (file) => loadPropModel(assetLoader, cache, file);

	for (const [index, hamlet] of (hamlets ?? []).entries()) {
		const rng = mulberry32((seed ^ 0x56424c44) + index * 7919); // "VBLD"
		const placedHere = [];

		/** The plan: role, which ring it stands on, and its bearing around the green. */
		const plan = [];
		const civicBearing = rng() * Math.PI * 2;
		plan.push({ role: 'worship', ring: P.civicRingMeters, bearing: civicBearing });
		plan.push({ role: 'craft', ring: P.civicRingMeters, bearing: civicBearing + Math.PI * 0.7 });
		for (let i = 0; i < P.fieldBuildingCount; i += 1) {
			plan.push({ role: 'field', ring: P.fieldRingMeters, bearing: (i / P.fieldBuildingCount) * Math.PI * 2 + rng() * 0.6 });
		}
		for (let i = 0; i < P.fenceCount; i += 1) {
			plan.push({ role: 'fence', ring: P.fieldRingMeters * 0.72, bearing: (i / P.fenceCount) * Math.PI * 2 + 0.4 });
		}
		for (let i = 0; i < P.marketPropCount; i += 1) {
			plan.push({ role: 'market', ring: P.marketRadiusMeters * Math.sqrt(rng()), bearing: rng() * Math.PI * 2 });
		}

		for (const plot of plan) {
			const options = VILLAGE_BUILDING_ROLES[plot.role];
			const file = options[Math.floor(rng() * options.length) % options.length];
			const x = hamlet.x + Math.cos(plot.bearing) * plot.ring;
			const z = hamlet.z + Math.sin(plot.bearing) * plot.ring;
			const groundY = sampleHeightMeters(x, z);
			if (groundY <= seaLevelMeters) { skipped += 1; continue; }
			if (localGrade(sampleHeightMeters, x, z, groundY) > P.maxSlopeGrade) { skipped += 1; continue; }
			const clearance = Math.max(P.minSpacingMeters, ROLE_FOOTPRINT_METERS[plot.role]);
			let crowded = false;
			for (const other of placedHere) {
				if (Math.hypot(x - other.x, z - other.z) < (clearance + other.clearance) * 0.5) { crowded = true; break; }
			}
			if (crowded) { skipped += 1; continue; }

			const source = await loadOnce(file);
			// Never plant a placeholder — see this module's header. The village keeps its cottages.
			if (!source || source.userData?.isPlaceholder) { skipped += 1; continue; }

			// `loadPropModel` already normalised the source's materials; the clone shares them.
			const model = source.clone(true);
			// Face the green, so the settlement turns inward the way the cottages already do.
			const yaw = Math.atan2(hamlet.x - x, hamlet.z - z) + (rng() - 0.5) * 0.4;
			const radius = groundModel(model, x, z, groundY, yaw, ROLE_FOOTPRINT_METERS[plot.role]);
			model.name = `village-${plot.role}-${hamlet.seatId}`;
			model.userData.villageBuilding = Object.freeze({ seatId: hamlet.seatId, role: plot.role, file });
			group.add(model);
			placedHere.push({ x, z, clearance });
			buildings.push({ x, z, radius });
			byRole[plot.role] += 1;
			placed += 1;
		}
	}

	return { group, placed, skipped, byRole, buildings };
}

/**
 * Builds them and adds them to the live scene — the `world/worldDressing.js` layer signature.
 *
 * @param {object} options
 * @param {import('../assetLoader.js').AssetLoader} options.assetLoader
 * @param {object} options.state Needs `scene`, `groundCollider` and `villageHamlets`.
 * @returns {Promise<THREE.Group|null>}
 */
export async function initVillageBuildings({ assetLoader, state }) {
	const { WORLD_DEFAULTS } = await import('../config.js');
	const result = await createVillageBuildings({
		assetLoader,
		hamlets: state.villageHamlets,
		sampleHeightMeters: state.groundCollider.getGroundHeight,
		seaLevelMeters: WORLD_DEFAULTS.WATER_LEVEL_METERS,
		seed: WORLD_DEFAULTS.WORLD_SEED,
	});
	state.scene.add(result.group);
	const roles = Object.entries(result.byRole).map(([role, count]) => `${role} ${count}`).join(', ');
	console.info(
		`[game3d] Village buildings: ${result.placed} raised across ${(state.villageHamlets ?? []).length} village(s) ` +
			`(${roles}); ${result.skipped} plot(s) left empty.`,
	);
	return result.group;
}

/** Disposes them — same single-argument convention as every other `world/` disposer. */
export function disposeVillageBuildings(group) {
	group.traverse((node) => {
		if (!node.isMesh) return;
		node.geometry?.dispose?.();
		const materials = Array.isArray(node.material) ? node.material : [node.material];
		for (const material of materials) material?.dispose?.();
	});
	group.clear();
}
