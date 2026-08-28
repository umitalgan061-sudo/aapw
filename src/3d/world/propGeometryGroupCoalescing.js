import * as THREE from 'three';

/**
 * Collapses an imported model's geometry groups down to one per material (run 405).
 *
 * **The unit the GPU counts is the geometry group, not the mesh.** A mesh whose `material` is an array
 * is submitted once per entry in `geometry.groups`, so a model's cost is the sum of its group counts —
 * which is how run 400 found `world-props` holding 706 meshes but **9,277 groups**, and why merging
 * sub-meshes by material in run 395 moved the draw calls by ten (1,437 -> 1,427): the fragmentation
 * was never *between* meshes, it was *inside* a single mesh's group list.
 *
 * Measured on the nine models run 400 had to withhold under `tooManyDrawCallsForOnePlacement`, the
 * group lists are wildly redundant — the same handful of materials repeating hundreds of times:
 *
 * | mesh | groups | distinct material indexes |
 * |---|---|---|
 * | `tower22_tower.fbx` `TOWER` | 990 | **7** |
 * | `FreeBuilding_building.fbx` `lamp19` | 281 | **2** |
 * | `Free_temple_temple.fbx` `structure1` | 245 | **4** |
 * | `FreeBuilding_building.fbx` `structure` | 124 | **6** |
 *
 * Sorting each mesh's triangles by material index and emitting one group per material is enough to
 * recover all of that, and it is a pure reordering: the same triangles, the same vertex data, the same
 * material array, the same material index per triangle. Nothing is merged, decimated or dropped.
 *
 * **What this is worth today: nothing, and that is stated rather than glossed.** Run 400 had already
 * withheld the nine models carrying 95% of the fragmentation, so on the catalogue as it ships
 * `checkMobilePerfBudget` reads **235 draw calls / 465,174 triangles / 205 geometries with this module
 * and bit-identical without it**. It earns its place by removing the barrier that keeps those nine out,
 * not by moving today's number — and run 405 established that a second barrier is now the binding one:
 * putting five of them back measured 530,392 triangles against a 500,000 ceiling. See
 * `worldPropExclusions.js`'s `tooManyDrawCallsForOnePlacement` for that measurement.
 *
 * **What it deliberately will not touch.** A mesh is skipped rather than guessed at when its material
 * is not an array (three.js ignores groups there and already submits it once), when its groups do not
 * tile the draw range exactly, when it carries morph targets, or when an attribute is interleaved —
 * each of those makes the reorder either pointless or unsafe, and a skipped mesh renders exactly as
 * it did before.
 *
 * @module world/propGeometryGroupCoalescing
 */

/** Attribute data can be copied range-by-range only when it is this mesh's own, not a shared interleave. */
const isPlainAttribute = (attribute) => !!attribute && !attribute.isInterleavedBufferAttribute && !!attribute.array;

/**
 * Do this geometry's groups tile `[0, drawCount)` exactly once, in order?
 *
 * Anything else — overlapping groups, gaps, a partial cover — means the group list is describing
 * something this reorder does not model, so the mesh is left alone.
 */
function groupsTileDrawRange(groups, drawCount) {
	let cursor = 0;
	for (const group of groups) {
		if (group.start !== cursor || !(group.count > 0)) return false;
		cursor += group.count;
	}
	return cursor === drawCount;
}

/** Groups rewritten as one per material index, in first-seen order, with the source ranges to copy. */
function planCoalescedGroups(groups) {
	const byMaterial = new Map();
	for (const group of groups) {
		const materialIndex = group.materialIndex ?? 0;
		if (!byMaterial.has(materialIndex)) byMaterial.set(materialIndex, []);
		byMaterial.get(materialIndex).push(group);
	}
	return byMaterial;
}

/** Copies `[start, start + count)` element ranges of `attribute` into `destination`, in plan order. */
function rewriteAttribute(attribute, ranges) {
	const { array, itemSize } = attribute;
	const destination = new array.constructor(array.length);
	let cursor = 0;
	for (const [start, count] of ranges) {
		destination.set(array.subarray(start * itemSize, (start + count) * itemSize), cursor * itemSize);
		cursor += count;
	}
	return new THREE.BufferAttribute(destination, itemSize, attribute.normalized);
}

/**
 * Rewrites one geometry so each material index owns a single contiguous group.
 * @returns {boolean} Whether the geometry was rewritten.
 */
function coalesceGeometry(geometry) {
	const groups = geometry.groups ?? [];
	const index = geometry.index;
	const drawCount = index ? index.count : (geometry.attributes.position?.count ?? 0);
	if (groups.length < 2 || !drawCount) return false;
	if (geometry.morphAttributes && Object.keys(geometry.morphAttributes).length) return false;
	if (!groupsTileDrawRange(groups, drawCount)) return false;

	const plan = planCoalescedGroups(groups);
	if (plan.size >= groups.length) return false;

	const ranges = [];
	const coalesced = [];
	let cursor = 0;
	for (const [materialIndex, sourceGroups] of plan) {
		let count = 0;
		for (const group of sourceGroups) {
			ranges.push([group.start, group.count]);
			count += group.count;
		}
		coalesced.push({ start: cursor, count, materialIndex });
		cursor += count;
	}

	if (index) {
		if (!isPlainAttribute(index)) return false;
		geometry.setIndex(rewriteAttribute(index, ranges));
	} else {
		const attributes = Object.entries(geometry.attributes);
		if (!attributes.every(([, attribute]) => isPlainAttribute(attribute))) return false;
		for (const [name, attribute] of attributes) geometry.setAttribute(name, rewriteAttribute(attribute, ranges));
	}

	geometry.clearGroups();
	for (const group of coalesced) geometry.addGroup(group.start, group.count, group.materialIndex);
	return true;
}

/**
 * Coalesces every eligible mesh under `model`, in place.
 *
 * @param {THREE.Object3D} model Mutated in place.
 * @returns {{ meshes: number, rewritten: number, groupsBefore: number, groupsAfter: number }} What it
 *   did, so a caller — or a check — can assert the reduction rather than assume it.
 */
export function coalesceGeometryGroups(model) {
	const report = { meshes: 0, rewritten: 0, groupsBefore: 0, groupsAfter: 0 };
	const seen = new Set();
	model.traverse((node) => {
		if (!node.isMesh || !Array.isArray(node.material) || !node.geometry) return;
		report.meshes += 1;
		// Clones share geometry with their cached source; rewriting one twice would be wasted work and
		// would double-count the reduction.
		if (seen.has(node.geometry)) return;
		seen.add(node.geometry);
		const before = node.geometry.groups?.length ?? 0;
		report.groupsBefore += before;
		if (coalesceGeometry(node.geometry)) report.rewritten += 1;
		report.groupsAfter += node.geometry.groups?.length ?? 0;
	});
	return report;
}
