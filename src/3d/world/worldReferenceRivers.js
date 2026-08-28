/**
 * The map's named rivers.
 *
 * **What was here before: one river.** The whole world had exactly one, traced downhill from whatever
 * happened to be the highest ground near the origin. `resimler/map.png` is covered in them — the
 * Trident and its three forks, the Blackwater Rush through King's Landing, the Mander through the
 * Reach, the Rhoyne and the Skahazadhan across Essos. Rivers are the single most legible feature of any
 * real map, and this world had one unnamed stream.
 *
 * **Sources from the map, courses from the terrain.** This is the same principle
 * `world/worldReferenceRoadRoutes.js` settled on for roads, and it matters more for water. A river
 * transcribed as a fixed polyline would run uphill wherever this world's height field disagrees with
 * the drawing, which is worse than absurd — it is unphysical, and the valley carver would then cut a
 * trench climbing a hillside. So each entry here gives a *headwater*: the place the map shows the river
 * rising. `world/rivers.js`'s existing downhill tracer takes it from there, and the course it finds is
 * guaranteed to run downhill on the terrain we actually have.
 *
 * **Coordinates** were read off `map.png` at 4x against the same 0.01 grid every other transcription in
 * this project uses, so they carry the same +/-0.015 caveat — about 200 m on the ground.
 *
 * @module world/worldReferenceRivers
 */

import { WORLD_SCALE } from '../config.js';
import { WORLD_REFERENCE_ALIGNMENT } from './worldReferenceAlignment.js';

/**
 * Named headwaters, in normalized owner-map coordinates.
 *
 * `searchRadiusMeters` is how far around the reading the tracer may look for the highest ground to
 * start from: a river rises in hills, and the exact pixel of a hand-drawn source is not meaningful at
 * this scale. Larger radii suit rivers the map draws rising in a broad upland.
 */
export const REFERENCE_RIVERS = Object.freeze([
	// ---- Westeros ---------------------------------------------------------------------------------
	/** The Green Fork: rises in the north and runs south-east past the Twins to join the Trident. */
	Object.freeze({ id: 'green-fork', name: 'Green Fork', nx: 0.158, ny: 0.393, searchRadiusMeters: 700 }),
	/** The Red Fork: rises in the western hills above Riverrun and runs east. */
	Object.freeze({ id: 'red-fork', name: 'Red Fork', nx: 0.148, ny: 0.451, searchRadiusMeters: 700 }),
	/** The Blue Fork, the northernmost of the three. */
	Object.freeze({ id: 'blue-fork', name: 'Blue Fork', nx: 0.166, ny: 0.424, searchRadiusMeters: 600 }),
	/** The Blackwater Rush: rises west of King's Landing and runs east into Blackwater Bay. */
	Object.freeze({ id: 'blackwater-rush', name: 'Blackwater Rush', nx: 0.158, ny: 0.489, searchRadiusMeters: 700 }),
	/** The Mander: the Reach's great river, rising in the south-west uplands. */
	Object.freeze({ id: 'mander', name: 'The Mander', nx: 0.150, ny: 0.545, searchRadiusMeters: 800 }),
	/** The Greenblood, Dorne's river, rising in the Red Mountains. */
	Object.freeze({ id: 'greenblood', name: 'The Greenblood', nx: 0.163, ny: 0.630, searchRadiusMeters: 700 }),
	/** The White Knife, running north out of the barrowlands to White Harbor. */
	Object.freeze({ id: 'white-knife', name: 'The White Knife', nx: 0.171, ny: 0.291, searchRadiusMeters: 700 }),

	// ---- Essos ------------------------------------------------------------------------------------
	/** The Rhoyne: the greatest river in the known world, running south past Volantis. */
	Object.freeze({ id: 'rhoyne', name: 'The Rhoyne', nx: 0.300, ny: 0.470, searchRadiusMeters: 900 }),
	/** The Skahazadhan, running east through Slaver's Bay past Meereen. */
	Object.freeze({ id: 'skahazadhan', name: 'The Skahazadhan', nx: 0.560, ny: 0.610, searchRadiusMeters: 800 }),
	/** The Sarne, draining the northern plains of Essos. */
	Object.freeze({ id: 'sarne', name: 'The Sarne', nx: 0.440, ny: 0.430, searchRadiusMeters: 800 }),
]);

export const REFERENCE_RIVERS_POLICY = Object.freeze({
	id: 'owner-map-rivers-2026-08-20-v1',
	method: 'gridded-visual-transcription',
	readingToleranceNormalized: 0.015,
	riverCount: REFERENCE_RIVERS.length,
	sourcePolicy: 'headwater-from-map-course-from-terrain',
});

/**
 * A named headwater in world metres, with the search radius the tracer should use.
 *
 * @param {typeof REFERENCE_RIVERS[number]} river
 * @returns {{id: string, name: string, x: number, z: number, searchRadiusMeters: number}}
 */
export function riverHeadwaterWorldPoint(river) {
	const { MAP_BOUNDS, METERS_PER_MAP_UNIT } = WORLD_SCALE;
	return {
		id: river.id,
		name: river.name,
		x: (river.nx * WORLD_REFERENCE_ALIGNMENT.mapCanvasWidthUnits - (MAP_BOUNDS.minX + MAP_BOUNDS.maxX) * 0.5) * METERS_PER_MAP_UNIT,
		z: (river.ny * WORLD_REFERENCE_ALIGNMENT.mapCanvasHeightUnits - (MAP_BOUNDS.minY + MAP_BOUNDS.maxY) * 0.5) * METERS_PER_MAP_UNIT,
		searchRadiusMeters: river.searchRadiusMeters,
	};
}

/** Every headwater, in world metres. */
export function allRiverHeadwaters() {
	return REFERENCE_RIVERS.map(riverHeadwaterWorldPoint);
}
