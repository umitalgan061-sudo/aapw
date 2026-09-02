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

/**
 * Model choice is per species and deliberately conservative: one narrow conifer to stand in for
 * `pine`, one round-crowned broadleaf for `round`, each a single tree rather than one of the
 * multi-tree cluster files, so an instance is one tree. Both are about 3,500 triangles.
 */
export const VEGETATION_NEAR_DETAIL_POLICY = Object.freeze({
	id: 'vegetation-near-detail-real-models-v1',
	speciesModels: Object.freeze([
		'assets/models/vegetation/pine_Zt62gceKXZ.glb',
		'assets/models/vegetation/tree_QVOop92WmG.glb',
	]),
	/**
	 * Radius and budget. Desktop's 220 m covers everything a standing player reads as an individual
	 * tree; past that the primitive silhouette is all the eye resolves anyway. The mobile pair is set
	 * from the triangle budget rather than from taste — `scripts/checkMobilePerfBudget.js` allows
	 * 500,000 triangles for the whole scene, and ten of these models is about 35,000 of it.
	 */
	desktop: Object.freeze({ nearRadiusMeters: 220, maxDetailTrees: 44 }),
	mobile: Object.freeze({ nearRadiusMeters: 90, maxDetailTrees: 10 }),
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
 * Rescales a model's parts so the tree's base sits at y=0, its trunk is centred on x=z=0 and its
 * height matches the primitive it replaces — which is what lets the primitive's own instance matrix
 * be reused verbatim, yaw, per-tree scale and all.
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
 * @returns {{group: THREE.Group, ready: Promise<boolean>, stats: object}}
 */
export function createVegetationNearDetail({ vegetationGroup, isMobileClass = false }) {
	const group = new THREE.Group();
	group.name = 'vegetation-near-detail';
	const budget = isMobileClass ? VEGETATION_NEAR_DETAIL_POLICY.mobile : VEGETATION_NEAR_DETAIL_POLICY.desktop;
	const stats = { policyId: VEGETATION_NEAR_DETAIL_POLICY.id, active: false, detailedCount: 0, ...budget };
	group.userData.vegetationNearDetail = stats;

	const pairs = readSpeciesPairs(vegetationGroup);
	if (!pairs.length) return { group, ready: Promise.resolve(false), stats };

	// One flat list of every placed tree, read once. `count` is the real placed count, so the unused
	// trailing capacity `createVegetation` allocates is never walked.
	const matrix = new THREE.Matrix4();
	const trees = [];
	for (let speciesIndex = 0; speciesIndex < pairs.length; speciesIndex += 1) {
		const { trunkMesh } = pairs[speciesIndex];
		for (let instanceIndex = 0; instanceIndex < trunkMesh.count; instanceIndex += 1) {
			trunkMesh.getMatrixAt(instanceIndex, matrix);
			trees.push({
				speciesIndex,
				instanceIndex,
				x: matrix.elements[12],
				z: matrix.elements[14],
				matrix: matrix.clone(),
			});
		}
	}

	const hiddenFlags = pairs.map(({ trunkMesh, foliageMesh }) => attachHiddenFlag(trunkMesh, foliageMesh));
	const detailBySpecies = [];
	let selection = [];
	const lastCamera = new THREE.Vector3(Infinity, Infinity, Infinity);

	const clearSelection = () => {
		for (const tree of selection) hiddenFlags[tree.speciesIndex].array[tree.instanceIndex] = 0;
		for (const flag of hiddenFlags) flag.needsUpdate = true;
		selection = [];
		for (const species of detailBySpecies) for (const mesh of species) mesh.count = 0;
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
		const perSpeciesCount = detailBySpecies.map(() => 0);
		for (const candidate of near) {
			if (selection.length >= budget.maxDetailTrees) break;
			const speciesIndex = candidate.tree.speciesIndex;
			const meshes = detailBySpecies[speciesIndex];
			if (!meshes?.length) continue;
			const slot = perSpeciesCount[speciesIndex];
			if (slot >= budget.maxDetailTrees) continue;
			for (const mesh of meshes) mesh.setMatrixAt(slot, candidate.tree.matrix);
			perSpeciesCount[speciesIndex] = slot + 1;
			hiddenFlags[speciesIndex].array[candidate.tree.instanceIndex] = 1;
			selection.push(candidate.tree);
		}
		for (let speciesIndex = 0; speciesIndex < detailBySpecies.length; speciesIndex += 1) {
			for (const mesh of detailBySpecies[speciesIndex] ?? []) {
				mesh.count = perSpeciesCount[speciesIndex];
				mesh.instanceMatrix.needsUpdate = true;
			}
		}
		for (const flag of hiddenFlags) flag.needsUpdate = true;
		stats.detailedCount = selection.length;
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
	const ready = Promise.all(pairs.map(async ({ trunkMesh, foliageMesh }, speciesIndex) => {
		const url = VEGETATION_NEAR_DETAIL_POLICY.speciesModels[speciesIndex];
		if (!url) return null;
		// Loaded straight through `GLTFLoader`, not `assetLoader.loadModel`, on purpose: that one
		// answers a missing file with a magenta placeholder box, and a box standing where a tree should
		// be is worse than the primitive this replaces. A rejection here leaves the layer inactive and
		// the world exactly as `world/vegetation.js` drew it.
		const gltf = await loader.loadAsync(url);
		const parts = collectModelParts(gltf.scene);
		if (!parts.length || !normalizeParts(parts, speciesHeightMeters(trunkMesh, foliageMesh))) return null;
		return parts.map((part) => {
			const mesh = new THREE.InstancedMesh(part.geometry, part.material, budget.maxDetailTrees);
			mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
			mesh.count = 0;
			mesh.frustumCulled = false;
			mesh.castShadow = trunkMesh.castShadow;
			mesh.receiveShadow = trunkMesh.receiveShadow;
			return mesh;
		});
	})).then((built) => {
		if (built.some((species) => !species)) return false;
		for (const species of built) {
			detailBySpecies.push(species);
			for (const mesh of species) group.add(mesh);
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
