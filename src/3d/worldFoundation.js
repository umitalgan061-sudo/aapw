/**
 * World foundation — the ground, built in the order the layers on top of it require.
 *
 * **Why this is one function and not inline in `sceneManager.js`.** Four separate systems now override
 * or reshape the raw height field, and each one has to see the world the previous one produced:
 *
 *   1. Settlement flatten pads (ADR-0118) come off a throwaway *base* sampler, so a castle's pad is
 *      anchored to natural ground rather than to another pad.
 *   2. River valleys (ADR-0307) are traced over pads-flattened terrain. They are natural landform, so
 *      they go *under* pads and roads — a castle's pad still wins over the valley it sits in.
 *   3. The owner map's canonical highways (ADR-0308) are routed over valley-carved ground, because a
 *      road should be laid across the world as it actually is.
 *   4. The road cut-and-fill bed (ADR-0304) is built last, from both the seat network and those
 *      canonical highways, and applies on top of everything else.
 *
 * Getting that order wrong is not a cosmetic bug: it is the ADR-0118 failure mode, where the ground
 * that is drawn and the ground that is walked on disagree. Keeping the whole sequence in one place,
 * with the reasons attached, is how it stays right — and it keeps `sceneManager.js` under the
 * project's 600-line cap, which building it inline had just breached.
 *
 * @module worldFoundation
 */

import { createHeightSampler } from './world/terrain.js';
import { KINGDOM_SEATS, mapToWorldXZ, computeSettlementFlattenPads } from './world/settlements.js';
import { computeRoadCorridor } from './world/roadCorridorSmoothing.js';
import { computeRiverValleys } from './world/terrainValleyCarving.js';
import { routeReferenceRoads } from './world/worldReferenceRoadNetwork.js';
import { WORLD_DEFAULTS, WORLD_SCALE, SETTLEMENT_CONFIG } from './config.js';

/**
 * Builds every terrain-shaping layer, in dependency order.
 *
 * @returns {{flattenPads: object[], valleyField: object, roadCorridor: object,
 *   referenceRoads: object[], baseSampleHeightMeters: (x: number, z: number) => number}}
 */
export function buildWorldFoundation() {
		// Ground-flatten pads (DECISIONS.md ADR-0118) — computed once, up front, from a throwaway *base*
		// (unflattened) sampler, then threaded into both the chunk manager (so the rendered ground mesh
		// is flat under every castle) and the ground collider below (so every gameplay height query —
		// settlements/roads/rivers/NPCs/animals/dragons/the player — agrees with what's actually drawn).
		// See `world/settlements.js`'s `computeSettlementFlattenPads` doc comment for why the anchor
		// height must come from this clamped formula, not the raw terrain sample.
		const baseSampleHeightMeters = createHeightSampler(WORLD_DEFAULTS.WORLD_SEED);
		const flattenPads = computeSettlementFlattenPads({
			sampleHeightMeters: baseSampleHeightMeters,
			seaLevelMeters: WORLD_DEFAULTS.WATER_LEVEL_METERS,
			minGroundClearanceMeters: SETTLEMENT_CONFIG.MIN_GROUND_CLEARANCE_METERS,
			mapBounds: WORLD_SCALE.MAP_BOUNDS,
			metersPerMapUnit: WORLD_SCALE.METERS_PER_MAP_UNIT,
		});

		// Touch-primary devices get the mobile-budget STREAM_RADIUS_CHUNKS instead of the desktop-only
		// PHASE1_PREVIEW_RADIUS_CHUNKS boot preview — see this function's own doc comment / ADR-0010.
		// The same signal picks terrain mesh resolution, which is the property that decides whether fine
		// relief survives to the screen at all (see `CHUNK_CONFIG.TERRAIN_SEGMENTS_DESKTOP`).
		// Road cut-and-fill bed (DECISIONS.md ADR-0304), built with the same two-phase pattern as the
		// settlement pads above: route every cart edge over pads-flattened terrain, then lay a smoothed bed
		// along those routes. It has to exist *before* the chunk manager and the ground collider, because
		// both must see the same ground — a road drawn on one field and walked on another is the ADR-0118
		// failure mode. This is also what lets `world/terrainReliefDetail.js` carry real player-scale
		// roughness at all: without a bed, that roughness scores as impassable road grade (ADR-0303).
		const phase1SampleHeightMeters = createHeightSampler(WORLD_DEFAULTS.WORLD_SEED, undefined, flattenPads);

		// River valleys (DECISIONS.md ADR-0307), traced over that same phase-1 field. Built before the road
		// corridor on purpose: a valley is natural landform, so roads should be routed over a world that
		// already has it and then get their cut-and-fill on the result — not the other way round.
		const valleyField = computeRiverValleys({
			seed: WORLD_DEFAULTS.WORLD_SEED,
			baseSampleHeightMeters: phase1SampleHeightMeters,
			seaLevelMeters: WORLD_DEFAULTS.WATER_LEVEL_METERS,
		});
		const valleySampleHeightMeters = createHeightSampler(WORLD_DEFAULTS.WORLD_SEED, undefined, flattenPads, null, valleyField);

		// The owner map's own highways (DECISIONS.md ADR-0308), routed over the same valley-carved phase-1
		// terrain the seat network is. Routed here so their polylines can go into the cut-and-fill bed
		// below alongside the seat roads — a canonical highway gets the same treatment as any other road.
		const referenceRoads = routeReferenceRoads({
			seats: KINGDOM_SEATS,
			sampleHeightMeters: valleySampleHeightMeters,
			mapBounds: WORLD_SCALE.MAP_BOUNDS,
			metersPerMapUnit: WORLD_SCALE.METERS_PER_MAP_UNIT,
		});

		const roadCorridor = computeRoadCorridor({
			seats: KINGDOM_SEATS.map((seat) => {
				const { x, z } = mapToWorldXZ(seat.mapX, seat.mapY, WORLD_SCALE.MAP_BOUNDS, WORLD_SCALE.METERS_PER_MAP_UNIT);
				return { id: seat.id, x, z };
			}),
			baseSampleHeightMeters: valleySampleHeightMeters,
			extraRoutes: referenceRoads,
		});


	return { flattenPads, valleyField, roadCorridor, referenceRoads, baseSampleHeightMeters };
}
