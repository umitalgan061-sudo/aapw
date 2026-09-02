/**
 * Real tree models for the trees close enough to look at.
 *
 * **The defect.** `world/vegetation.js` draws every tree as two primitives — a six-sided cylinder and
 * either a seven-sided cone or a seven-by-six sphere. That was the right call when it was written
 * (ADR-0138/0139: one draw call per part, no external file, a forest for free) and it is still the
 * right call for the thousands of trees on the far hillsides. It is the wrong call for the eight or
 * ten standing next to the player, and those are the ones that make the world read as artificial: a
 * green ball on a brown stick is recognisable as a primitive from any distance a person can walk to.
 *
 * Meanwhile `assets/models/vegetation/` already holds twenty real tree models the owner imported, and
 * `world/worldPropCatalogue.js` places them at roughly two per square kilometre — far too sparse to be
 * what you see when you look at a tree.
 *
 * **What this does.** Near the camera, and only near it, each primitive tree is swapped for a real
 * model standing in exactly the same place: same position, same yaw, same height. Everything beyond
 * that radius is untouched, so the cost is bounded by *area*, not by the world's tree count — a
 * 220 m radius holds on the order of forty trees however large the map gets.
 *
 * **Why the primitives are hidden with an attribute rather than a matrix.** The obvious way to hide an
 * instance is to write a zero-scale matrix over it, and that is exactly what must not happen here:
 * `scripts/checkVegetationVisualContract.js` pins `instanceMatrix.usage` to `StaticDrawUsage` and
 * compares every instance matrix against a second, independently built scatter. Both would break. So
 * the matrices are never touched at all; an instanced float attribute carries a per-tree hidden flag
 * and a two-line vertex patch collapses a hidden tree's vertices onto its own origin, which makes
 * every one of its triangles degenerate and rasterises nothing.
 *
 * **Determinism.** Which trees are detailed depends on where the camera is, and nothing else — no
 * randomness, no frame counter, no accumulated state. The same camera position always selects the
 * same trees, and no gameplay value is read from any of this: placement, collision and height are
 * `world/vegetation.js`'s and the terrain's, exactly as before.
 *
 * @module world/vegetationNearDetail
 */

import * as THREE from 'three';
import { GLTFLoader } from '../vendor/three/addons/loaders/GLTFLoader.js';
import { normalizedMapPoint, resolvePropBiome } from './worldPropScatter.js';
import { sampleMapAridity01, sampleMapForest01 } from './worldReferenceBiomeField.js';

/**
 * Which model stands where (run 423).
 *
 * Run 417 chose the model from the *primitive species* the tree already belonged to, and that species
 * is a coin flip — `pickSpeciesIndex` rolls it from a seeded stream with no idea where it is. So the
 * near field was a conifer or a broadleaf at random, and the north grew the same trees as the Reach.
 *
 * The world already knows better. `world/worldPropScatter.js` reads the owner map's own forest and
 * aridity fields and classifies ground into named biomes; asking it the same question here costs three
 * height samples and two map lookups per tree, once, at build time.
 *
 * Three models, all single trees rather than multi-tree cluster files so one instance is one tree, and
 * none heavier than the conifer run 417 already budgeted for — so the worst case is unchanged at 44
 * detailed trees times 3,648 triangles.
 */
export const VEGETATION_NEAR_DETAIL_POLICY = Object.freeze({
	id: 'vegetation-near-detail-biome-models-v2',
	supersedes: 'vegetation-near-detail-real-models-v1',
	biomeModels: Object.freeze({
		/** Cold and high ground: a narrow conifer. 3,648 triangles. */
		conifer: 'assets/models/vegetation/pine_Zt62gceKXZ.glb',
		/** Everything temperate: a round-crowned broadleaf. 3,505 triangles. */
		broadleaf: 'assets/models/vegetation/tree_QVOop92WmG.glb',
		/** Dry country: a pale, sparse, olive-like tree. 1,210 triangles — the lightest of the three. */
		dryland: 'assets/models/vegetation/tree_VfZbAkek1r.glb',
	}),
	/** `resolvePropBiome`'s vocabulary, mapped onto those three. Anything it cannot classify is
	 * temperate — the safe default, and what the whole near field used before this run. */
	biomeToModel: Object.freeze({
		snowline: 'conifer',
		upland: 'conifer',
		arid: 'dryland',
		woodland: 'broadleaf',
		farmland: 'broadleaf',
		meadow: 'broadleaf',
		coast: 'broadleaf',
		roadside: 'broadleaf',
	}),
	/**
	 * Radius and budget. Desktop's 220 m covers everything a standing player reads as an individual
	 * tree; past that the primitive silhouette is all the eye resolves anyway. The mobile pair is set
	 * from the triangle budget rather than from taste — `scripts/checkMobilePerfBudget.js` allows
	 * 500,000 triangles for the whole scene, and ten of these models is about 35,000 of it.
	 */
	desktop: Object.freeze({ nearRadiusMeters: 220, maxDetailTrees: 44 }),
	mobile: Object.freeze({ nearRadiusMeters: 90, maxDetailTrees: 10 }),
	/**
	 * North of this normalized map latitude the answer is a conifer whatever the height says.
	 *
	 * Without it the rule is altitude-only — `resolvePropBiome` calls ground 'upland' above 240 m and
	 * 'snowline' above 470 m — and a grid over the whole map came back 273 broadleaf, 18 dryland, 15
	 * conifer: 5% conifer, i.e. a change nobody would ever see. Altitude is not why the North is pine
	 * forest; latitude is. 0.36 is just south of the Neck, and sits against the same map latitudes
	 * `world/terrain.js`'s `NORTHERN_SNOW` uses (full snow by 0.15, gone by 0.30, Winterfell at 0.285).
	 */
	coldNorthNy: 0.36,
	/** What an unclassifiable spot gets. Temperate is the safe answer and the run-417 behaviour. */
	defaultModel: 'broadleaf',
	/** Camera travel that triggers a re-selection. Below this the same trees stay chosen. */
	rebuildAfterCameraMoveMeters: 12,
	renderOnly: true,
});

const HIDDEN_ATTRIBUTE = 'run417NearHidden';
const CACHE_KEY = 'run417-vegetation-near-hidden-v1';

/**
 * Adds the hidden flag to one species pair and patches both materials to honour it.
 *
 * The same `InstancedBufferAttribute` object is put on both geometries: trunk and foliage share every
 * instance transform (the visual contract asserts that too), so they must share the flag or a hidden
 * tree would keep half of itself.
 */
function attachHiddenFlag(trunkMesh, foliageMesh) {
	const capacity = trunkMesh.instanceMatrix.count;
	const attribute = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
	attribute.setUsage(THREE.DynamicDrawUsage);
	for (const mesh of [trunkMesh, foliageMesh]) {
		mesh.geometry.setAttribute(HIDDEN_ATTRIBUTE, attribute);
		const material = mesh.material;
		material.onBeforeCompile = (shader) => {
			shader.vertexShader = shader.vertexShader
				.replace('#include <common>', `#include <common>\nattribute float ${HIDDEN_ATTRIBUTE};`)
				// Collapsing to the instance origin rather than discarding: there is no fragment-stage
				// way to skip an instance, and a zero-extent triangle is culled before rasterisation.
				.replace('#include <begin_vertex>', `#include <begin_vertex>\ntransformed *= 1.0 - ${HIDDEN_ATTRIBUTE};`);
		};
		material.customProgramCacheKey = () => CACHE_KEY;
		material.needsUpdate = true;
	}
	return attribute;
}

/** Every mesh in a loaded model, baked into world space and merged per material. */
function collectModelParts(root) {
	root.updateMatrixWorld(true);
	const parts = [];
	root.traverse((child) => {
		if (!child.isMesh || !child.geometry) return;
		const geometry = child.geometry.clone();
		geometry.applyMatrix4(child.matrixWorld);
		parts.push({ geometry, material: child.material });
	});
	return parts;
}

/**
 * Rescales a model's parts so the tree's base sits at y=0, its trunk is centred on x=z=0 and it stands
 * exactly one metre tall.
 *
 * Unit height, not the species height, since run 423: a model is now chosen by biome and so may stand
 * in for either primitive species, which are 8.7 m and 6.9 m tall. Baking one of those into the
 * geometry would make a conifer the wrong size wherever the tree it replaced belonged to the other
 * species. The real height rides in the instance matrix instead, where the per-tree scale and yaw
 * already live.
 */
function normalizeParts(parts, targetHeightMeters) {
	const bounds = new THREE.Box3();
	for (const part of parts) {
		part.geometry.computeBoundingBox();
		bounds.union(part.geometry.boundingBox);
	}
	const size = bounds.getSize(new THREE.Vector3());
	if (!(size.y > 0)) return false;
	const scale = targetHeightMeters / size.y;
	const centerX = (bounds.min.x + bounds.max.x) / 2;
	const centerZ = (bounds.min.z + bounds.max.z) / 2;
	for (const part of parts) {
		part.geometry.translate(-centerX, -bounds.min.y, -centerZ);
		part.geometry.scale(scale, scale, scale);
		part.geometry.computeBoundingSphere();
	}
	return true;
}

/** Full standing height of a species, measured off the primitives rather than assumed. */
function speciesHeightMeters(trunkMesh, foliageMesh) {
	const bounds = new THREE.Box3();
	for (const mesh of [trunkMesh, foliageMesh]) {
		mesh.geometry.computeBoundingBox();
		bounds.union(mesh.geometry.boundingBox);
	}
	return bounds.max.y;
}

/**
 * Which of the three models belongs at this spot, from the owner map's own fields.
 *
 * `resolvePropBiome` answers `null` for ground too steep or too low for anything to stand on. A tree
 * is already standing there — `world/vegetation.js` placed it against its own, looser rules — so a
 * null is not a reason to leave a gap; it falls through to the temperate model, which is what the
 * whole near field used before this run.
 *
 * `nearSeatMeters` is passed as `Infinity` on purpose: that argument exists so barrels and carts
 * become 'roadside' clutter near a castle, and a tree is neither.
 *
 * @param {number} x
 * @param {number} z
 * @param {(x: number, z: number) => {heightAboveSeaMeters: number, slopeDegrees: number}} sampleGround
 * @returns {string} a key of `VEGETATION_NEAR_DETAIL_POLICY.biomeModels`.
 */
function resolveTreeModelKey(x, z, sampleGround) {
	const P = VEGETATION_NEAR_DETAIL_POLICY;
	if (!sampleGround) return P.defaultModel;
	const { heightAboveSeaMeters, slopeDegrees } = sampleGround(x, z);
	const { nx, ny } = normalizedMapPoint(x, z);
	// Latitude first: the North is conifer forest because it is cold, not because it is high, and
	// `resolvePropBiome` has no notion of latitude at all.
	if (ny <= P.coldNorthNy) return 'conifer';
	const biome = resolvePropBiome({
		heightAboveSeaMeters,
		slopeDegrees,
		forest01: sampleMapForest01(nx, ny),
		aridity01: sampleMapAridity01(nx, ny),
		nearSeatMeters: Infinity,
	});
	return P.biomeToModel[biome] ?? P.defaultModel;
}

function readSpeciesPairs(vegetationGroup) {
	const pairs = [];
	const children = vegetationGroup?.children ?? [];
	for (let index = 0; index + 1 < children.length; index += 2) {
		const trunkMesh = children[index];
		const foliageMesh = children[index + 1];
		if (!trunkMesh?.isInstancedMesh || !foliageMesh?.isInstancedMesh) continue;
		if (trunkMesh.count !== foliageMesh.count) continue;
		pairs.push({ trunkMesh, foliageMesh });
	}
	return pairs;
}

/**
 * @param {object} options
 * @param {THREE.Group} options.vegetationGroup The group `createVegetation` returned.
 * @param {boolean} [options.isMobileClass]
 * @param {(x: number, z: number) => number} [options.sampleHeightMeters] The same ground field every
 *   other world system reads. Without it every tree falls back to the temperate model, which is the
 *   run-417 behaviour — so this stays optional and the layer never fails for want of it.
 * @param {number} [options.seaLevelMeters]
 * @returns {{group: THREE.Group, ready: Promise<boolean>, stats: object}}
 */
export function createVegetationNearDetail({ vegetationGroup, isMobileClass = false, sampleHeightMeters = null, seaLevelMeters = 0 }) {
	const group = new THREE.Group();
	group.name = 'vegetation-near-detail';
	const budget = isMobileClass ? VEGETATION_NEAR_DETAIL_POLICY.mobile : VEGETATION_NEAR_DETAIL_POLICY.desktop;
	const stats = { policyId: VEGETATION_NEAR_DETAIL_POLICY.id, active: false, detailedCount: 0, ...budget };
	group.userData.vegetationNearDetail = stats;

	const pairs = readSpeciesPairs(vegetationGroup);
	if (!pairs.length) return { group, ready: Promise.resolve(false), stats };

	// Slope from the same four-neighbour stencil the prop scatter uses, so both systems call the same
	// ground the same way and cannot disagree about what counts as a mountainside.
	const SLOPE_STENCIL_METERS = 6;
	const resolveBiomeAt = sampleHeightMeters
		? (x, z) => {
			const height = sampleHeightMeters(x, z);
			const east = sampleHeightMeters(x + SLOPE_STENCIL_METERS, z);
			const north = sampleHeightMeters(x, z + SLOPE_STENCIL_METERS);
			const rise = Math.max(Math.abs(east - height), Math.abs(north - height));
			return {
				heightAboveSeaMeters: height - seaLevelMeters,
				slopeDegrees: (Math.atan2(rise, SLOPE_STENCIL_METERS) * 180) / Math.PI,
			};
		}
		: null;

	// One flat list of every placed tree, read once. `count` is the real placed count, so the unused
	// trailing capacity `createVegetation` allocates is never walked.
	//
	// Each tree's biome is resolved here, once, rather than on every re-selection: it is a property of
	// the ground, and the ground does not move. Three height samples and two owner-map lookups per
	// tree, at build time, for a world of a few thousand trees.
	const matrix = new THREE.Matrix4();
	const heightScale = new THREE.Matrix4();
	const trees = [];
	for (let speciesIndex = 0; speciesIndex < pairs.length; speciesIndex += 1) {
		const { trunkMesh, foliageMesh } = pairs[speciesIndex];
		// The geometry is normalised to one metre, so the species' real standing height goes into the
		// matrix — composed on the right, so it scales the model before the tree's own yaw and scale.
		const speciesHeight = speciesHeightMeters(trunkMesh, foliageMesh);
		heightScale.makeScale(speciesHeight, speciesHeight, speciesHeight);
		for (let instanceIndex = 0; instanceIndex < trunkMesh.count; instanceIndex += 1) {
			trunkMesh.getMatrixAt(instanceIndex, matrix);
			const x = matrix.elements[12];
			const z = matrix.elements[14];
			trees.push({
				speciesIndex,
				instanceIndex,
				x,
				z,
				modelKey: resolveTreeModelKey(x, z, resolveBiomeAt),
				matrix: matrix.clone().multiply(heightScale),
			});
		}
	}

	const hiddenFlags = pairs.map(({ trunkMesh, foliageMesh }) => attachHiddenFlag(trunkMesh, foliageMesh));
	/** @type {Map<string, THREE.InstancedMesh[]>} */
	const detailByModel = new Map();
	let selection = [];
	const lastCamera = new THREE.Vector3(Infinity, Infinity, Infinity);

	const clearSelection = () => {
		for (const tree of selection) hiddenFlags[tree.speciesIndex].array[tree.instanceIndex] = 0;
		for (const flag of hiddenFlags) flag.needsUpdate = true;
		selection = [];
		for (const meshes of detailByModel.values()) for (const mesh of meshes) mesh.count = 0;
	};

	const select = (cameraPosition) => {
		clearSelection();
		const radiusSq = budget.nearRadiusMeters * budget.nearRadiusMeters;
		const near = [];
		for (const tree of trees) {
			const dx = tree.x - cameraPosition.x;
			const dz = tree.z - cameraPosition.z;
			const distanceSq = dx * dx + dz * dz;
			if (distanceSq <= radiusSq) near.push({ tree, distanceSq });
		}
		near.sort((a, b) => a.distanceSq - b.distanceSq);
		const slots = new Map();
		for (const key of detailByModel.keys()) slots.set(key, 0);
		for (const candidate of near) {
			if (selection.length >= budget.maxDetailTrees) break;
			const { modelKey, speciesIndex, instanceIndex } = candidate.tree;
			const meshes = detailByModel.get(modelKey);
			if (!meshes?.length) continue;
			const slot = slots.get(modelKey);
			// Each model has its own instance buffer sized to the whole budget, so a near field that is
			// entirely one biome still fills; the shared `maxDetailTrees` above is what bounds the total.
			if (slot >= budget.maxDetailTrees) continue;
			for (const mesh of meshes) mesh.setMatrixAt(slot, candidate.tree.matrix);
			slots.set(modelKey, slot + 1);
			hiddenFlags[speciesIndex].array[instanceIndex] = 1;
			selection.push(candidate.tree);
		}
		for (const [key, meshes] of detailByModel) {
			for (const mesh of meshes) {
				mesh.count = slots.get(key);
				mesh.instanceMatrix.needsUpdate = true;
			}
		}
		for (const flag of hiddenFlags) flag.needsUpdate = true;
		stats.detailedCount = selection.length;
		stats.byModel = Object.fromEntries(slots);
	};

	// Driven off a render hook rather than the game loop: `world/windGrass.js` already re-centres
	// itself this way, and it keeps this module out of `game3d.js`, which is at its line cap.
	group.onBeforeRender = (renderer, scene, camera) => {
		if (!stats.active) return;
		if (lastCamera.distanceToSquared(camera.position) < VEGETATION_NEAR_DETAIL_POLICY.rebuildAfterCameraMoveMeters ** 2) return;
		lastCamera.copy(camera.position);
		select(camera.position);
	};
	// `onBeforeRender` only fires for objects the renderer actually visits, so the group carries a
	// mesh whose sole job is to be visited. It cannot simply be `visible: false` — three.js drops a
	// material that is not visible before the render list, and then this hook never runs, which is
	// exactly how the first version of this module selected nothing. Instead it is a single degenerate
	// triangle that writes neither colour nor depth: rasterises nothing, still gets visited.
	const tickerGeometry = new THREE.BufferGeometry();
	tickerGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
	const ticker = new THREE.Mesh(tickerGeometry, new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }));
	ticker.frustumCulled = false;
	ticker.renderOrder = -1;
	ticker.onBeforeRender = (renderer, scene, camera) => group.onBeforeRender(renderer, scene, camera);
	group.add(ticker);

	const loader = new GLTFLoader();
	const shadowSource = pairs[0].trunkMesh;
	const modelKeys = Object.keys(VEGETATION_NEAR_DETAIL_POLICY.biomeModels);
	const ready = Promise.all(modelKeys.map(async (key) => {
		const url = VEGETATION_NEAR_DETAIL_POLICY.biomeModels[key];
		// Loaded straight through `GLTFLoader`, not `assetLoader.loadModel`, on purpose: that one
		// answers a missing file with a magenta placeholder box, and a box standing where a tree should
		// be is worse than the primitive this replaces. A rejection here leaves the layer inactive and
		// the world exactly as `world/vegetation.js` drew it.
		const gltf = await loader.loadAsync(url);
		const parts = collectModelParts(gltf.scene);
		if (!parts.length || !normalizeParts(parts, 1)) return null;
		return [key, parts.map((part) => {
			const mesh = new THREE.InstancedMesh(part.geometry, part.material, budget.maxDetailTrees);
			mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
			mesh.count = 0;
			mesh.frustumCulled = false;
			mesh.castShadow = shadowSource.castShadow;
			mesh.receiveShadow = shadowSource.receiveShadow;
			return mesh;
		})];
	})).then((built) => {
		if (built.some((entry) => !entry)) return false;
		for (const [key, meshes] of built) {
			detailByModel.set(key, meshes);
			for (const mesh of meshes) group.add(mesh);
		}
		stats.active = true;
		return true;
	}).catch((error) => {
		console.warn('[vegetationNearDetail] real tree models unavailable, keeping primitives.', error);
		return false;
	});

	return { group, ready, stats };
}

/** Same single-argument teardown convention as `disposeVegetation`. */
export function disposeVegetationNearDetail(group) {
	for (const child of [...(group?.children ?? [])]) {
		group.remove(child);
		child.geometry?.dispose?.();
		const materials = Array.isArray(child.material) ? child.material : [child.material];
		for (const material of materials) material?.dispose?.();
	}
}
