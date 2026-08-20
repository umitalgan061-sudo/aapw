/**
 * The Wall.
 *
 * **It was not here.** Every reference to the Wall in this repository was a comment. `roads.js` routes a
 * highway whose own docstring calls it "the Kingsroad: the Wall to King's Landing"; the road arrives at
 * Castle Black and there is nothing there. The most recognisable geographic feature in the entire story
 * — three hundred miles of ice across the top of the world — had never been built.
 *
 * **Where it goes, read off the map.** `resimler/map.png` at 4x shows a pale blue-white band labelled
 * "The Wall" running east-west with the Night's Watch castles strung along it, Castle Black immediately
 * south, Brandon's Gift and the New Gift below that, the Bay of Ice to the west and the Bay of Seals to
 * the east. Probing the live height field along that latitude, land runs unbroken from nx 0.152 to
 * nx 0.208 at ny 0.161 — sea on both sides, flat 18-33 m ground between. So the Wall is built coast to
 * coast across exactly that span, which is both what the map draws and what the story requires: it seals
 * the continent, and a wall with a way around it seals nothing.
 *
 * **Height comes from the books.** Seven hundred feet, so 213 m. That is enormous against 18-33 m
 * ground, and it is supposed to be — the Wall dominates the North and cannot be seen over. It is not
 * scaled down to look proportionate against this world's compressed horizontal distances, because the
 * whole point of the thing is that it is out of proportion with everything around it.
 *
 * **Geometry, not terrain.** A height field cannot express a vertical face: every sampler in this
 * project maps one (x, z) to a single height, so a wall built into the terrain would come out as a
 * ramp. It is also the safer choice — the Doom of Valyria took two runs partly because a height-field
 * change rippled into LOD cracks, the river source and two road routes. This touches none of that:
 * `scripts/terrainSeatSafetyCheck.js`, the road network and the river field all see exactly the terrain
 * they saw before.
 *
 * **Deterministic.** Vertex colours come from an integer-free hash of world position, like every other
 * surface in `world/`. No `Math.random()`.
 *
 * @module world/theWall
 */

import * as THREE from 'three';
import { WORLD_SCALE } from '../config.js';
import { WORLD_REFERENCE_ALIGNMENT } from './worldReferenceAlignment.js';

export const THE_WALL_POLICY = Object.freeze({
	id: 'the-wall-2026-08-20-v1',
	/** West and east ends in normalized owner-map coordinates, from the map reading above. */
	westEnd: Object.freeze({ nx: 0.152, ny: 0.1615 }),
	eastEnd: Object.freeze({ nx: 0.208, ny: 0.1600 }),
	/** Seven hundred feet. */
	heightMeters: 213,
	/** Wide enough that men ride along the top of it. */
	thicknessMeters: 14,
	/** Metres the base is sunk into the ground, so no gap shows where the terrain dips between samples. */
	footingMeters: 6,
	/** Spacing of the samples that follow the ground along the Wall's length. */
	sampleSpacingMeters: 12,
	/** The Wall is ice: pale, cold, and brighter toward the crown where the sun catches it. */
	baseColor: 0x9fb8cc,
	crownColor: 0xe8f2fa,
	/** Amplitude of the per-vertex tone variation that keeps 756 m of ice from reading as one flat slab. */
	mottleAmplitude: 0.1,
});

/** Deterministic [0,1) hash of a quantised world position — same family as every other `world/` hash. */
function positionHash01(x, y, z) {
	const value = Math.sin(Math.round(x) * 127.1 + Math.round(y) * 311.7 + Math.round(z) * 74.7) * 43758.5453;
	return value - Math.floor(value);
}

/** Normalized owner-map coordinates to world X/Z — the projection every canonical consumer uses. */
function normalizedToWorld(nx, ny) {
	const { MAP_BOUNDS, METERS_PER_MAP_UNIT } = WORLD_SCALE;
	return {
		x: (nx * WORLD_REFERENCE_ALIGNMENT.mapCanvasWidthUnits - (MAP_BOUNDS.minX + MAP_BOUNDS.maxX) * 0.5) * METERS_PER_MAP_UNIT,
		z: (ny * WORLD_REFERENCE_ALIGNMENT.mapCanvasHeightUnits - (MAP_BOUNDS.minY + MAP_BOUNDS.maxY) * 0.5) * METERS_PER_MAP_UNIT,
	};
}

/**
 * Samples the Wall's centreline, following the ground.
 *
 * Each sample carries the terrain height beneath it, so the base can be laid on the real ground rather
 * than on a single averaged plane — otherwise the Wall would float over the dips and sink into the rises.
 *
 * @param {(x: number, z: number) => number} sampleHeightMeters
 * @returns {{x: number, z: number, groundY: number}[]}
 */
export function sampleWallCentreline(sampleHeightMeters) {
	const P = THE_WALL_POLICY;
	const west = normalizedToWorld(P.westEnd.nx, P.westEnd.ny);
	const east = normalizedToWorld(P.eastEnd.nx, P.eastEnd.ny);
	const lengthMeters = Math.hypot(east.x - west.x, east.z - west.z);
	const steps = Math.max(2, Math.ceil(lengthMeters / P.sampleSpacingMeters));
	const points = [];
	for (let i = 0; i <= steps; i += 1) {
		const t = i / steps;
		const x = west.x + (east.x - west.x) * t;
		const z = west.z + (east.z - west.z) * t;
		points.push({ x, z, groundY: sampleHeightMeters(x, z) });
	}
	return points;
}

/**
 * Builds the Wall.
 *
 * One mesh: two long faces and a crown, indexed as a quad strip along the centreline. The base of each
 * cross-section is sunk `footingMeters` into its own ground sample and the crown is flat at the highest
 * ground plus `heightMeters`, so the top reads as a single level line across the whole span — which is
 * how the Wall is always described, and how ice would actually settle — while the bottom follows the
 * terrain and never floats.
 *
 * @param {object} options
 * @param {(x: number, z: number) => number} options.sampleHeightMeters
 * @returns {{group: THREE.Group, lengthMeters: number, crownY: number, sectionCount: number}}
 */
export function createTheWall({ sampleHeightMeters }) {
	const P = THE_WALL_POLICY;
	const centreline = sampleWallCentreline(sampleHeightMeters);
	const group = new THREE.Group();
	group.name = 'the-wall';

	let highestGround = -Infinity;
	for (const point of centreline) highestGround = Math.max(highestGround, point.groundY);
	const crownY = highestGround + P.heightMeters;

	const positions = [];
	const colors = [];
	const indices = [];
	const base = new THREE.Color(P.baseColor);
	const crown = new THREE.Color(P.crownColor);
	const scratch = new THREE.Color();
	const half = P.thicknessMeters * 0.5;

	for (let i = 0; i < centreline.length; i += 1) {
		const point = centreline[i];
		// Perpendicular to the local direction, so the Wall has thickness along its whole length.
		const previous = centreline[Math.max(0, i - 1)];
		const next = centreline[Math.min(centreline.length - 1, i + 1)];
		const dx = next.x - previous.x;
		const dz = next.z - previous.z;
		const length = Math.hypot(dx, dz) || 1;
		const sideX = -dz / length;
		const sideZ = dx / length;
		const footY = point.groundY - P.footingMeters;

		// Four vertices per cross-section: south foot, north foot, south crown, north crown.
		const corners = [
			[point.x - sideX * half, footY, point.z - sideZ * half, 0],
			[point.x + sideX * half, footY, point.z + sideZ * half, 0],
			[point.x - sideX * half, crownY, point.z - sideZ * half, 1],
			[point.x + sideX * half, crownY, point.z + sideZ * half, 1],
		];
		for (const [x, y, z, up] of corners) {
			positions.push(x, y, z);
			scratch.copy(base).lerp(crown, up);
			const mottle = 1 + (positionHash01(x, y, z) - 0.5) * 2 * P.mottleAmplitude;
			colors.push(
				Math.min(1, scratch.r * mottle),
				Math.min(1, scratch.g * mottle),
				Math.min(1, scratch.b * mottle),
			);
		}

		if (i === 0) continue;
		const a = (i - 1) * 4;
		const b = i * 4;
		// South face, north face, crown — three quads bridging this section to the previous one.
		indices.push(a + 0, b + 0, a + 2, b + 0, b + 2, a + 2);
		indices.push(a + 1, a + 3, b + 1, b + 1, a + 3, b + 3);
		indices.push(a + 2, b + 2, a + 3, b + 2, b + 3, a + 3);
	}

	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
	geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(colors), 3));
	geometry.setIndex(indices);
	geometry.computeVertexNormals();
	geometry.computeBoundingSphere();

	// Ice: smooth enough to catch light along the faces, not a mirror.
	const material = new THREE.MeshStandardMaterial({
		vertexColors: true, roughness: 0.35, metalness: 0, side: THREE.DoubleSide,
	});
	const mesh = new THREE.Mesh(geometry, material);
	mesh.name = 'the-wall-mesh';
	mesh.castShadow = true;
	mesh.receiveShadow = true;
	const west = centreline[0];
	const east = centreline[centreline.length - 1];
	const lengthMeters = Math.hypot(east.x - west.x, east.z - west.z);
	mesh.userData.theWall = Object.freeze({ lengthMeters, crownY, heightMeters: P.heightMeters });
	group.add(mesh);
	return { group, lengthMeters, crownY, sectionCount: centreline.length };
}

/**
 * Builds the Wall and adds it to the live scene — the `world/worldDressing.js` layer signature.
 *
 * @param {object} options
 * @param {object} options.state Needs `scene` and `groundCollider`.
 * @returns {Promise<THREE.Group>}
 */
export async function initTheWall({ state }) {
	const { group, lengthMeters, crownY, sectionCount } = createTheWall({
		sampleHeightMeters: state.groundCollider.getGroundHeight,
	});
	state.scene.add(group);
	console.info(`[game3d] The Wall: ${lengthMeters.toFixed(0)} m coast to coast, crown at ${crownY.toFixed(0)} m, ${sectionCount} sections.`);
	return group;
}

/** Disposes the Wall — same single-argument convention as every other `world/` disposer. */
export function disposeTheWall(group) {
	group.traverse((node) => {
		if (!node.isMesh) return;
		node.geometry?.dispose?.();
		const materials = Array.isArray(node.material) ? node.material : [node.material];
		for (const material of materials) material?.dispose?.();
	});
	group.clear();
}
