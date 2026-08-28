/**
 * The owner map's own highways, built into the world.
 *
 * `world/worldReferenceRoadRoutes.js` holds the routes read off `resimler/map.png`; this module turns
 * them into geometry. Each route's waypoints are projected into world space and then joined leg by leg
 * with the *same* slope-aware A* `world/roads.js` uses for the seat network, so a canonical road obeys
 * the ground it crosses instead of being drawn as a straight line over it. The map could rule a
 * Valyrian road dead straight across Essos; this world has a real height field under it, and a
 * straight line would bridge ravines the drawing never had to acknowledge.
 *
 * **Additive.** `roads.js`'s minimum spanning tree over the fourteen seats is untouched — it remains
 * the gameplay connectivity guarantee that `scripts/roadNetworkSafetyCheck.js` asserts at 13 edges and
 * 18.29 km. These highways are a second, separate group. They share the ribbon geometry helper rather
 * than reimplementing it, so the two networks look like the same kind of road.
 *
 * **Cut-and-fill.** Like every road in this world since ADR-0304, these get a bed: the returned
 * polylines are fed through `world/roadCorridorSmoothing.js` by `sceneManager.js`, so a canonical
 * highway is cut into the hillside rather than draped over its every ripple.
 *
 * @module world/worldReferenceRoadNetwork
 */

import * as THREE from 'three';
import { appendRoadRibbon } from './roads.js';
import { findSlopeAwarePath } from './roadPathfinder.js';
import { REFERENCE_ROAD_ROUTES, expandRouteWaypoints } from './worldReferenceRoadRoutes.js';
import { WORLD_REFERENCE_ALIGNMENT } from './worldReferenceAlignment.js';
import { WORLD_DEFAULTS } from '../config.js';

/** Widths, in metres, by the `kind` a route records. A Valyrian road is a monumental highway; a
 * mountain pass is a track. */
const WIDTH_BY_KIND = Object.freeze({ highway: 7, valyrian: 9, pass: 3.5 });
/** Colours, so the map's road classes stay visually distinguishable on the ground. */
const COLOR_BY_KIND = Object.freeze({
	highway: new THREE.Color(0x9c7b4a),
	valyrian: new THREE.Color(0x8d8578),
	pass: new THREE.Color(0xbfae82),
});

/**
 * Projects a normalized owner-map coordinate to world X/Z, using the same alignment every other
 * canonical consumer uses.
 */
function normalizedToWorld(nx, ny, mapBounds, metersPerMapUnit) {
	const mapX = nx * WORLD_REFERENCE_ALIGNMENT.mapCanvasWidthUnits;
	const mapY = ny * WORLD_REFERENCE_ALIGNMENT.mapCanvasHeightUnits;
	return {
		x: (mapX - (mapBounds.minX + mapBounds.maxX) * 0.5) * metersPerMapUnit,
		z: (mapY - (mapBounds.minY + mapBounds.maxY) * 0.5) * metersPerMapUnit,
	};
}

/**
 * Routes every canonical highway over real terrain.
 *
 * Returns polylines only — no geometry — so `sceneManager.js` can build their cut-and-fill bed from
 * these and *then* build the mesh on the bedded ground, the same two-phase order the seat network uses.
 *
 * @param {object} options
 * @param {{id: string, mapX: number, mapY: number}[]} options.seats `KINGDOM_SEATS`.
 * @param {(x: number, z: number) => number} options.sampleHeightMeters Phase-1 terrain.
 * @param {{minX: number, maxX: number, minY: number, maxY: number}} options.mapBounds
 * @param {number} options.metersPerMapUnit
 *
 * **No road is ever drawn through water.** `roadPathfinder.js` now charges `UNDERWATER_PENALTY` for a
 * wet step and refuses to smooth a corner into the sea, which keeps every route that *can* stay dry
 * dry. A route that still comes back with a submerged point has no land path in this world's height
 * field between the waypoints read off the map — that is a transcription or a terrain fact, not
 * something to paper over — so it is dropped here and named in `droppedRoutes` rather than rendered as
 * a highway along the seabed.
 *
 * @returns {{routed: {id: string, kind: string, points: {x: number, y: number, z: number}[], lengthMeters: number}[],
 *   droppedRoutes: {id: string, wetPoints: number, deepestBelowSeaMeters: number}[]}}
 */
export function routeReferenceRoads({ seats, sampleHeightMeters, mapBounds, metersPerMapUnit }) {
	const seatsById = new Map(seats.map((seat) => [seat.id, {
		nx: seat.mapX / WORLD_REFERENCE_ALIGNMENT.mapCanvasWidthUnits,
		ny: seat.mapY / WORLD_REFERENCE_ALIGNMENT.mapCanvasHeightUnits,
	}]));

	const routed = [];
	const droppedRoutes = [];
	const seaLevel = WORLD_DEFAULTS.WATER_LEVEL_METERS;
	for (const route of REFERENCE_ROAD_ROUTES) {
		const waypoints = expandRouteWaypoints(route, seatsById);
		if (waypoints.length < 2) continue;
		const world = waypoints.map((point) => normalizedToWorld(point.nx, point.ny, mapBounds, metersPerMapUnit));

		/** @type {{x: number, y: number, z: number}[]} */
		const points = [];
		for (let leg = 1; leg < world.length; leg += 1) {
			const { points: legPoints } = findSlopeAwarePath({
				sampleHeightMeters,
				start: { x: world[leg - 1].x, z: world[leg - 1].z },
				end: { x: world[leg].x, z: world[leg].z },
			});
			// Drop the first point of every leg after the first — it repeats the previous leg's end.
			for (let i = points.length === 0 ? 0 : 1; i < legPoints.length; i += 1) points.push(legPoints[i]);
		}
		if (points.length < 2) continue;

		let wetPoints = 0;
		let deepestBelowSeaMeters = 0;
		for (const point of points) {
			if (point.y > seaLevel) continue;
			wetPoints += 1;
			deepestBelowSeaMeters = Math.max(deepestBelowSeaMeters, seaLevel - point.y);
		}
		if (wetPoints > 0) {
			droppedRoutes.push({ id: route.id, wetPoints, deepestBelowSeaMeters });
			continue;
		}

		let lengthMeters = 0;
		for (let i = 1; i < points.length; i += 1) {
			lengthMeters += Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z);
		}
		routed.push({ id: route.id, kind: route.kind, points, lengthMeters });
	}
	return { routed, droppedRoutes };
}

/**
 * Builds one group holding every canonical highway's ribbon.
 *
 * @param {ReturnType<typeof routeReferenceRoads>} routedRoads Polylines, already on bedded ground.
 * @param {(x: number, z: number) => number} [sampleHeightMeters] Grounds each edge of the ribbon on
 *   its own terrain instead of on the centreline's — see `appendRoadRibbon`, where a centreline-only
 *   ribbon was found floating off every cross-slope.
 * @returns {{group: import('three').Group, totalLengthMeters: number, roadCount: number}}
 */
export function createReferenceRoadMeshes(routedRoads, sampleHeightMeters = null) {
	const group = new THREE.Group();
	group.name = 'owner-map-roads';
	const buffers = { positions: [], colors: [], indices: [] };
	let totalLengthMeters = 0;

	for (const road of routedRoads) {
		appendRoadRibbon(buffers, road.points, WIDTH_BY_KIND[road.kind] ?? 6, COLOR_BY_KIND[road.kind] ?? COLOR_BY_KIND.highway, sampleHeightMeters);
		totalLengthMeters += road.lengthMeters;
	}
	if (buffers.positions.length === 0) return { group, totalLengthMeters: 0, roadCount: 0 };

	// One mesh for every canonical road: they share a material, so merging them costs nothing and
	// keeps this whole layer at a single draw call.
	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(buffers.positions), 3));
	geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(buffers.colors), 3));
	geometry.setIndex(buffers.indices);
	geometry.computeVertexNormals();
	const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, side: THREE.DoubleSide });
	const mesh = new THREE.Mesh(geometry, material);
	mesh.name = 'owner-map-roads-mesh';
	mesh.userData.ownerMapRoads = Object.freeze({ roadCount: routedRoads.length, totalLengthMeters });
	group.add(mesh);
	return { group, totalLengthMeters, roadCount: routedRoads.length };
}

/** Disposes a `createReferenceRoadMeshes` group — same single-argument convention as every other
 * `world/` disposer. */
export function disposeReferenceRoadNetwork(group) {
	for (const child of group.children) {
		child.geometry?.dispose?.();
		child.material?.dispose?.();
	}
}
