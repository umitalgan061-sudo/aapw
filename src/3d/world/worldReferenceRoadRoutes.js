/**
 * Canonical road routes, read off the owner map itself.
 *
 * **Why this module exists and why it could not before.** Every other geography contract in this
 * project — `worldReferenceMap.js`'s biome zones, water zones and mountain chains — was transcribed
 * from `resimler/map.png` long ago, but roads never were: the transcription simply has no road data.
 * That was not an oversight so much as an impossibility, because the image was gitignored and
 * therefore absent from every fresh clone, which is what a remote session always gets. Run 361
 * committed the file (SHA-256 `20702972…`, matching `WORLD_REFERENCE_MAP.sha256` exactly) so it can be
 * read, and this module is the first contract derived from actually looking at it.
 *
 * **How these coordinates were obtained.** The image was cropped by region and overlaid with a
 * normalized coordinate grid at 0.01 spacing, then each highway was followed by eye and its bends
 * recorded. That is the same "deterministic hand-audited anchors, not runtime OCR" method
 * `worldReferenceMap.js`'s own header describes, and it inherits the same accuracy caveat: readings
 * are good to roughly +/-0.01 in normalized space, i.e. about 130 m on the ground.
 *
 * **Endpoints come from the seats, not from the reading.** This project's fourteen kingdom seats sit
 * at their own authored coordinates, which are near but not identical to the castles the map draws —
 * Highgarden matched a reading exactly, while Castle Black was about 0.02 out. A road that terminated
 * on a *reading* would therefore stop a couple of hundred metres short of the castle it serves. So a
 * route names the seat it starts and ends at, and only the bends in between come from the image.
 * Shape from the map, endpoints from the world.
 *
 * **Not a replacement for the seat network.** `world/roads.js`'s minimum spanning tree over the
 * fourteen seats stays exactly as it is — it is the gameplay connectivity guarantee, and
 * `scripts/roadNetworkSafetyCheck.js` asserts its 13 edges and 18.29 km. These are the *map's own*
 * highways, carried additively alongside it. Reconciling the two into one network is a later
 * decision, and a real one, because it would change what "every seat is connected" is measured on.
 *
 * @module world/worldReferenceRoadRoutes
 */

import { WORLD_REFERENCE_MAP } from './worldReferenceMap.js';

/**
 * Canonical highways, in normalized owner-map space (x left→right, y top→bottom).
 *
 * `from`/`to`, when present, name a `world/settlements.js` `KINGDOM_SEATS` id; `via` carries the bends
 * read off the image. Routes that touch none of this world's seats — Essos's Valyrian trunk, the
 * Sarnath spur — carry no anchor at all and are simply the map's line. A consumer is expected to route
 * between consecutive points over real terrain rather than drawing straight lines, so the road still
 * obeys the ground it crosses.
 */
export const REFERENCE_ROAD_ROUTES = Object.freeze([
	// ---- Westeros ------------------------------------------------------------------------------
	/** The Kingsroad: the Wall to King's Landing, down the spine of the continent past Winterfell,
	 * Moat Cailin and the Twins. The longest single road the map draws. */
	Object.freeze({
		id: 'kingsroad', kind: 'highway', from: 'jon', to: 'cersei',
		via: Object.freeze([[0.157, 0.200], [0.152, 0.235], [0.156, 0.300], [0.157, 0.328],
			[0.156, 0.362], [0.155, 0.386], [0.162, 0.420], [0.172, 0.450], [0.180, 0.485]]),
		servesSeats: Object.freeze(['berkalp']),
	}),
	/** The Goldroad: King's Landing west to Casterly Rock and Lannisport. Runs almost straight. */
	Object.freeze({
		id: 'goldroad', kind: 'highway', from: 'cersei', to: 'twin',
		via: Object.freeze([[0.165, 0.512], [0.145, 0.508], [0.125, 0.503]]),
		servesSeats: Object.freeze([]),
	}),
	/** The Roseroad: King's Landing south-west to Highgarden and on toward Oldtown. */
	Object.freeze({
		id: 'roseroad', kind: 'highway', from: 'cersei', to: 'ziya',
		via: Object.freeze([[0.170, 0.530], [0.155, 0.548], [0.142, 0.565]]),
		servesSeats: Object.freeze([]),
	}),
	/** The Ocean Road: Lannisport down the western coast to Highgarden. */
	Object.freeze({
		id: 'ocean-road', kind: 'highway', from: 'twin', to: 'ziya',
		via: Object.freeze([[0.100, 0.505], [0.098, 0.525], [0.105, 0.548], [0.118, 0.567]]),
		servesSeats: Object.freeze([]),
	}),
	/** The Boneway / Prince's Pass: the Dornish Marches crossing of the Red Mountains, drawn on the
	 * map as a dotted mountain track rather than a made road — hence `kind: 'pass'`. */
	Object.freeze({
		id: 'dornish-marches', kind: 'pass', from: 'ziya', to: 'doran',
		via: Object.freeze([[0.148, 0.592], [0.160, 0.608], [0.170, 0.628]]),
		servesSeats: Object.freeze([]),
	}),
	/** The high road east out of the Vale, joining the Kingsroad in the Riverlands. */
	Object.freeze({
		id: 'high-road', kind: 'highway', from: 'robin', to: 'cersei',
		via: Object.freeze([[0.196, 0.420], [0.190, 0.450], [0.190, 0.480]]),
		servesSeats: Object.freeze([]),
	}),

	/** The Greenblood road: Dorne's river road, running east along the Greenblood from the Martell seat
	 * to the Sunspear coast. The map draws settlements strung along it the whole way. */
	Object.freeze({
		id: 'greenblood-road', kind: 'highway',
		via: Object.freeze([[0.163, 0.660], [0.175, 0.657], [0.188, 0.653], [0.196, 0.652]]),
		servesSeats: Object.freeze([]),
	}),

	// ---- Essos: the Valyrian roads ----------------------------------------------------------------
	// These are the dead-straight tan lines the map rules across Essos. They are the most legible
	// roads on the whole image precisely because they ignore terrain — Valyrian engineering — but they
	// are still routed over real ground here rather than drawn as straight lines, because this world's
	// height field is not the map's and a straight line would bridge ravines the map never had to.
	/** Pentos to Norvos, then the long diagonal down to Qohor, then east to Vaes Khadokh. Carried as
	 * one continuous eastern trunk since that is how the map draws it. */
	Object.freeze({
		// No seat anchor: this is Essos's own trunk and it touches none of this world's fourteen seats.
		// An earlier revision anchored it to King's Landing, which silently ran the first leg straight
		// across the Narrow Sea — see the segment sampling in scripts/checkOwnerMapAndRoadRoutes.js,
		// which now catches exactly that.
		id: 'valyrian-trunk-east', kind: 'valyrian',
		via: Object.freeze([[0.288, 0.501], [0.312, 0.478], [0.350, 0.495], [0.392, 0.512],
			[0.432, 0.502], [0.470, 0.505], [0.510, 0.512]]),
		servesSeats: Object.freeze([]),
	}),
	/** The Dothraki road west out of Vaes Dothrak, under the Mother of Mountains. */
	Object.freeze({
		id: 'vaes-dothrak-road', kind: 'valyrian',
		via: Object.freeze([[0.510, 0.462], [0.545, 0.458], [0.575, 0.456], [0.605, 0.455]]),
		servesSeats: Object.freeze([]),
	}),
	/**
	 * The Slaver's Bay road, following the Skahazadhan east from Meereen past Hesh and Kraaz.
	 *
	 * Corrected in run 365: the first reading sat at y 0.629-0.634, which is about 0.006 too far north —
	 * inside Slaver's Bay itself. It put eight of the routed road's points under water, the deepest
	 * 22.07 m below sea level, i.e. a highway along the seabed. Probing the real height field found dry
	 * ground at y 0.638-0.641 (57 m, 78 m, 170 m, 203 m above sea), which is where the bank actually is.
	 * The coarse 96x64 mask check had passed the original because its +/-1-cell coastal tolerance calls
	 * that whole strip "near land" — see the height-field validation added to
	 * `scripts/checkOwnerMapAndRoadRoutes.js`, which is what now catches this class of misreading.
	 */
	Object.freeze({
		id: 'slavers-bay-road', kind: 'highway',
		via: Object.freeze([[0.516, 0.638], [0.545, 0.641], [0.577, 0.641], [0.607, 0.641], [0.635, 0.640]]),
		servesSeats: Object.freeze([]),
	}),
	/** The Sarnath road: north from Vaes Khadokh to the Sarne cities. */
	Object.freeze({
		id: 'sarnath-road', kind: 'valyrian',
		via: Object.freeze([[0.432, 0.502], [0.440, 0.465], [0.443, 0.425]]),
		servesSeats: Object.freeze([]),
	}),
]);

export const REFERENCE_ROAD_ROUTES_POLICY = Object.freeze({
	id: 'owner-map-road-routes-2026-08-20-v1',
	sourceMapSha256: WORLD_REFERENCE_MAP.sha256,
	sourcePixelWidth: WORLD_REFERENCE_MAP.pixelWidth,
	sourcePixelHeight: WORLD_REFERENCE_MAP.pixelHeight,
	method: 'gridded-visual-transcription',
	/** Reading accuracy in normalized units, from the 0.01 grid the crops were read against. */
	readingToleranceNormalized: 0.015,
	routeCount: REFERENCE_ROAD_ROUTES.length,
});

/**
 * Expands one route into an ordered list of normalized waypoints, with seat positions substituted for
 * its endpoints.
 *
 * @param {typeof REFERENCE_ROAD_ROUTES[number]} route
 * @param {Map<string, {nx: number, ny: number}>} seatsById Normalized seat positions.
 * @returns {{nx: number, ny: number}[]}
 */
export function expandRouteWaypoints(route, seatsById) {
	const middle = route.via.map(([nx, ny]) => ({ nx, ny }));
	// An unanchored route is purely the map's own line — see the module header.
	if (!route.from && !route.to) return middle;
	const start = seatsById.get(route.from);
	const end = seatsById.get(route.to);
	if (!start || !end) return [];
	const servedSeats = route.servesSeats
		.map((id) => seatsById.get(id))
		.filter(Boolean);
	// Seats a route explicitly serves are inserted in the order the bends already imply, by nearest
	// bend, so the Kingsroad actually passes through Winterfell rather than beside it.
	const points = [start, ...middle, end];
	for (const seat of servedSeats) {
		let bestIndex = 1;
		let bestDistance = Infinity;
		for (let i = 1; i < points.length; i += 1) {
			const distance = Math.hypot(points[i].nx - seat.nx, points[i].ny - seat.ny);
			if (distance < bestDistance) {
				bestDistance = distance;
				bestIndex = i;
			}
		}
		points.splice(bestIndex, 0, seat);
	}
	return points;
}
