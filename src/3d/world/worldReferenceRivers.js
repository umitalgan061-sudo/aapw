/**
 * Canonical owner-map headwaters for the world's named rivers.
 *
 * The source positions are a bounded transcription of `resimler/map.png`; the courses are NOT
 * transcribed polylines. Runtime uses the existing deterministic downhill tracer against the actual
 * canonical terrain so water cannot be forced uphill merely to imitate a hand-drawn stroke.
 *
 * Keeping headwater authority separate from `rivers.js` also lets the river material/animation evolve
 * independently from geography topology. `rivers.js` owns how a river looks; this module owns which
 * map-read rivers exist and roughly where they rise.
 *
 * @module world/worldReferenceRivers
 */

import { WORLD_SCALE } from '../config.js';
import { normalizedReferenceToWorldXZ } from './worldReferenceAlignment.js';

export const REFERENCE_RIVERS_POLICY = Object.freeze({
	id: 'owner-map-named-rivers-2026-08-31-v2-fresh-main',
	sourceMapId: 'owner-world-map-2026-08-08',
	sourceMapSha256: '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1',
	method: 'gridded-visual-headwater-transcription',
	readingToleranceNormalized: 0.015,
	sourcePolicy: 'headwater-from-owner-map-course-from-live-terrain',
	geographyAuthority: 'resimler/map.png + world/terrain.js',
	materialAuthority: 'world/rivers.js',
	deterministic: true,
});

/**
 * Map-read headwaters in owner-map normalized coordinates.
 * `searchRadiusMeters` is deliberately broad because a map symbol locates the headwater region, not
 * a single 40 m terrain sample. The existing river tracer chooses the actual high point inside it.
 */
export const REFERENCE_RIVERS = Object.freeze([
	Object.freeze({ id: 'green-fork', name: 'Green Fork', nx: 0.158, ny: 0.393, searchRadiusMeters: 700, widthMeters: 20 }),
	Object.freeze({ id: 'red-fork', name: 'Red Fork', nx: 0.148, ny: 0.451, searchRadiusMeters: 700, widthMeters: 19 }),
	Object.freeze({ id: 'blue-fork', name: 'Blue Fork', nx: 0.166, ny: 0.424, searchRadiusMeters: 600, widthMeters: 18 }),
	Object.freeze({ id: 'blackwater-rush', name: 'Blackwater Rush', nx: 0.158, ny: 0.489, searchRadiusMeters: 700, widthMeters: 20 }),
	Object.freeze({ id: 'mander', name: 'The Mander', nx: 0.150, ny: 0.545, searchRadiusMeters: 800, widthMeters: 27 }),
	Object.freeze({ id: 'greenblood', name: 'The Greenblood', nx: 0.163, ny: 0.630, searchRadiusMeters: 700, widthMeters: 17 }),
	Object.freeze({ id: 'white-knife', name: 'The White Knife', nx: 0.171, ny: 0.291, searchRadiusMeters: 700, widthMeters: 18 }),
	Object.freeze({ id: 'rhoyne', name: 'The Rhoyne', nx: 0.300, ny: 0.470, searchRadiusMeters: 900, widthMeters: 34 }),
	Object.freeze({ id: 'skahazadhan', name: 'The Skahazadhan', nx: 0.560, ny: 0.610, searchRadiusMeters: 800, widthMeters: 24 }),
	Object.freeze({ id: 'sarne', name: 'The Sarne', nx: 0.440, ny: 0.430, searchRadiusMeters: 800, widthMeters: 22 }),
]);

function assertRiverDefinition(river) {
	if (!river || typeof river.id !== 'string' || !river.id) throw new TypeError('river.id must be a non-empty string');
	if (typeof river.name !== 'string' || !river.name) throw new TypeError(`river ${river.id}: name must be non-empty`);
	if (!Number.isFinite(river.nx) || river.nx < 0 || river.nx > 1) throw new RangeError(`river ${river.id}: nx outside [0,1]`);
	if (!Number.isFinite(river.ny) || river.ny < 0 || river.ny > 1) throw new RangeError(`river ${river.id}: ny outside [0,1]`);
	if (!(river.searchRadiusMeters > 0)) throw new RangeError(`river ${river.id}: searchRadiusMeters must be > 0`);
	if (!(river.widthMeters >= 12 && river.widthMeters <= 40)) throw new RangeError(`river ${river.id}: widthMeters outside natural runtime envelope`);
}

for (const river of REFERENCE_RIVERS) assertRiverDefinition(river);
if (new Set(REFERENCE_RIVERS.map((river) => river.id)).size !== REFERENCE_RIVERS.length) {
	throw new Error('REFERENCE_RIVERS contains duplicate ids');
}

/** @returns {{id:string,name:string,x:number,z:number,searchRadiusMeters:number,widthMeters:number,nx:number,ny:number}} */
export function riverHeadwaterWorldPoint(river) {
	assertRiverDefinition(river);
	const point = normalizedReferenceToWorldXZ(
		river.nx,
		river.ny,
		WORLD_SCALE.MAP_BOUNDS,
		WORLD_SCALE.METERS_PER_MAP_UNIT,
	);
	return Object.freeze({
		id: river.id,
		name: river.name,
		x: point.x,
		z: point.z,
		nx: river.nx,
		ny: river.ny,
		searchRadiusMeters: river.searchRadiusMeters,
		widthMeters: river.widthMeters,
	});
}

export function allRiverHeadwaters() {
	return REFERENCE_RIVERS.map(riverHeadwaterWorldPoint);
}

export function referenceRiverById(id) {
	return REFERENCE_RIVERS.find((river) => river.id === id) ?? null;
}
