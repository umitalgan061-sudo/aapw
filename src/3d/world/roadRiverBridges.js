/**
 * Where the roads the game draws cross the rivers the game draws — and how high a deck has to sit.
 *
 * **Why this exists.** Run 439 established that the playable world contains no bridge at all: the
 * whole run-191 stone-arch system lives in `world/worldReferenceStoneBridgeShadow.js` and its
 * adapters, which `sceneManager.js` never imports. Meanwhile three live roads run straight through
 * drawn river geometry — `stannis->robin` through four named rivers, `doran->ziya` through the
 * Mander, `robin->berkalp` through the Blue Fork. A player walking `stannis->robin` fords all four.
 *
 * **Why not just call the shadow planner.** It answers a different question. It recomputes its own
 * MST and its own routes over a *canonical* height sampler and asks `hydrologyAtWorld` where the
 * water is; the live world routes over the live sampler and draws rivers from `generateRiverPath`.
 * The two have drifted apart until they no longer name a single crossing in common. This module asks
 * only about what is actually drawn: the routed edges `buildRoadNetwork` returns, against the river
 * courses `sceneManager.js` already assembles for the village and vegetation placement rules.
 *
 * **And the shadow's deck formula does not survive the move.** It floors the deck at
 * `seaLevel + archRise + 0.8`, which is right for a crossing at the coast and wrong everywhere else:
 * measured on the eight live crossings, seven of them sit at 36-75 m altitude, and that formula puts
 * the deck 0.2-1.4 m *under* the water it is supposed to span. A deck clears the water it crosses,
 * not the sea — so the floor here is the local water surface plus `deckFreeboardMeters`.
 *
 * Pure and deterministic: fixed-step sampling of fixed inputs, no RNG, no time. Builds no geometry
 * and mutates nothing — it reports crossings, and the caller decides what to do with them.
 *
 * @module world/roadRiverBridges
 */

export const ROAD_RIVER_BRIDGE_POLICY = Object.freeze({
	id: 'road-river-bridge-v1',
	/**
	 * Metres between wet/dry samples along a road. The narrowest river ribbon is 14 m across, so at 2 m
	 * a crossing cannot be stepped over even where a road meets the water at a very shallow angle.
	 */
	sampleStepMeters: 2,
	/**
	 * Half the river ribbon's width, in metres — `world/rivers.js`'s `createRiverMesh` defaults to 14 m
	 * and every live course uses that default. Kept as a policy number rather than imported so that a
	 * future per-river width arrives here as an explicit decision instead of silently changing which
	 * crossings exist.
	 */
	riverHalfWidthMeters: 7,
	/** Dry ground kept either side of the wet run before the deck starts. The shadow policy's figure. */
	bankMarginMeters: 6,
	/**
	 * Metres the water surface sits above the ground its banks stand on — `createRiverMesh`'s own
	 * `verticalOffset`. The surface height has to be *derived* this way rather than read off the
	 * course's own `y`: those points carry the traced path's height from before the valley was carved,
	 * and on the live world they run up to 23 m away from the ribbon the player actually sees. Taking
	 * them at face value put one deck at 31.7 m over water drawn at 7.8 m.
	 */
	surfaceAboveBankMeters: 0.3,
	/**
	 * Headroom between the water surface and the underside of the deck. Enough that the arch has
	 * somewhere to spring from and the water clearly passes beneath rather than touching the stone.
	 *
	 * 2.4 m is not a taste: `deckThicknessMeters` is 1.2, so this leaves 1.8 m between the water and
	 * the underside of the deck for the arch to rise through. The run-191 policy's own
	 * `minimumArchRiseMeters` of 3.4 cannot be honoured here and is deliberately not used — an arch
	 * springing 3.4 m below a deck only 1.5 m above the water would start under the river. The rise is
	 * fitted to the headroom that exists instead, which is what a segmental arch is.
	 */
	deckFreeboardMeters: 2.4,
	/**
	 * A wet run shorter than this is a ford, not a bridge. Two metres of water across a road is a
	 * puddle at the edge of a course, and putting a stone arch over it would look far stranger than
	 * leaving it — the same judgement `world/rivers.js` makes when it declines to ribbon a two-point
	 * path.
	 */
	minimumWaterMeters: 6,
	/**
	 * Metres either side of a crossing over which the road climbs to the deck. The decks measured on
	 * the live world stand 1.56-2.71 m above their higher bank; over 20 m that is a 4.5-7.7 degree
	 * ramp before the deck freeboard is added; at the 2.4 m freeboard this module settles on, a 24 m
	 * approach keeps every ramp under 10 degrees, inside the 12 the run-192 shadow gate allows its own.
	 * Squeezed into the 6 m bank margin instead it would be far steeper than any cart could take.
	 */
	approachMeters: 24,
	/**
	 * How much of the water the crossing geometry implies must actually lie along the deck's own chord
	 * before a deck is justified, as a fraction.
	 *
	 * **Why a deck needs this test.** A deck is a straight chord from one bank to the other. That is
	 * right where the road crosses the river, and wrong where the road runs *along* the channel: the
	 * chord then cuts across the meander and the bridge spans a field. Measured on the eight live
	 * crossings, chord-over-water was 53.8, 57.7, 57.7, 61.5, 68.8, 74.5 and 76.3 per cent — and
	 * 32.9 per cent for `stannis->robin#2`, whose 78 m deck had two thirds of its length over dry
	 * ground. That one is the road travelling 71.6 m inside a 14 m river, five river-widths.
	 *
	 * The comparison is against what the geometry implies rather than a flat percentage, because the
	 * expected share depends on the crossing: `water / (water + 2 * bankMargin)` is 53.8% for a
	 * perpendicular crossing of a 14 m river and 85.6% for a 71.6 m run. Against that expectation the
	 * seven good crossings score 0.96 to 1.09 and the bad one scores 0.38, so 0.7 separates them with
	 * room on both sides and is not a number tuned to make one case pass.
	 *
	 * A rejected run is not hidden: it stays in the list with `decked: false` so the gate and the scene
	 * both report it. The road is left as it was — a ford, which is what it already is — rather than
	 * carrying a viaduct over a meadow.
	 */
	minimumChordWetShareOfExpected: 0.7,
	renderOnly: false,
});

/** Distance from a point to a segment in the XZ plane. */
function distanceToSegmentXZ(px, pz, a, b) {
	const dx = b.x - a.x;
	const dz = b.z - a.z;
	const lengthSquared = dx * dx + dz * dz;
	if (!lengthSquared) return Math.hypot(px - a.x, pz - a.z);
	let t = ((px - a.x) * dx + (pz - a.z) * dz) / lengthSquared;
	t = Math.max(0, Math.min(1, t));
	return Math.hypot(px - (a.x + dx * t), pz - (a.z + dz * t));
}

/**
 * Which river course, if any, covers this point — and how high its water is drawn there.
 *
 * The surface is *derived* the way `world/rivers.js`'s `createRiverMesh` derives it — each bank
 * founded on its own ground, plus `surfaceAboveBankMeters`, and the higher of the two wins — rather
 * than read off the course's `y`. See `surfaceAboveBankMeters` for what taking those at face value
 * cost. Both banks are sampled because a channel on a cross-slope has one bank well above the other,
 * and a deck has to clear the water at its highest edge.
 */
function riverAt(px, pz, riverCourses, sampleHeightMeters, policy) {
	for (const course of riverCourses) {
		const points = course.points;
		for (let index = 1; index < points.length; index += 1) {
			const a = points[index - 1];
			const b = points[index];
			if (distanceToSegmentXZ(px, pz, a, b) > policy.riverHalfWidthMeters) continue;
			const flowX = b.x - a.x;
			const flowZ = b.z - a.z;
			const flowLength = Math.hypot(flowX, flowZ) || 1;
			// Perpendicular to the flow, exactly as the ribbon's own left/right offsets are built.
			const acrossX = (-flowZ / flowLength) * policy.riverHalfWidthMeters;
			const acrossZ = (flowX / flowLength) * policy.riverHalfWidthMeters;
			const leftBank = sampleHeightMeters(px + acrossX, pz + acrossZ);
			const rightBank = sampleHeightMeters(px - acrossX, pz - acrossZ);
			return {
				name: course.name ?? 'river',
				surfaceY: Math.max(leftBank, rightBank) + policy.surfaceAboveBankMeters,
			};
		}
	}
	return null;
}

/** Walks one routed edge at a fixed step, tagging every sample wet or dry. */
function sampleEdge(points, riverCourses, sampleHeightMeters, policy) {
	const walk = [];
	for (let index = 1; index < points.length; index += 1) {
		const a = points[index - 1];
		const b = points[index];
		const runMeters = Math.hypot(b.x - a.x, b.z - a.z);
		const steps = Math.max(1, Math.ceil(runMeters / policy.sampleStepMeters));
		for (let step = 0; step < steps; step += 1) {
			const t = (step + 0.5) / steps;
			const x = a.x + (b.x - a.x) * t;
			const z = a.z + (b.z - a.z) * t;
			walk.push({
				x, z, meters: runMeters / steps,
				// Which routed point this sample came from, so a crossing can name the ribbon vertices it
				// covers: `appendRoadRibbon` emits exactly two vertices per point, in order.
				pointIndex: index - 1,
				river: riverAt(x, z, riverCourses, sampleHeightMeters, policy),
			});
		}
	}
	return walk;
}

/**
 * Fraction of a deck's straight chord that lies over water.
 *
 * Walked at the same fixed step the edges are, so the two measurements are comparable, and through
 * the same `riverAt` so "water" means the same thing in both.
 */
function wetShareAlongChord(start, end, spanMeters, riverCourses, sampleHeightMeters, policy) {
	const steps = Math.max(2, Math.ceil(spanMeters / policy.sampleStepMeters));
	let wet = 0;
	for (let step = 0; step <= steps; step += 1) {
		const t = step / steps;
		const x = start.x + (end.x - start.x) * t;
		const z = start.z + (end.z - start.z) * t;
		if (riverAt(x, z, riverCourses, sampleHeightMeters, policy)) wet += 1;
	}
	return wet / (steps + 1);
}

/** Groups a walked edge's wet samples into contiguous runs. */
function contiguousWetRuns(walk) {
	const runs = [];
	let current = null;
	for (let index = 0; index < walk.length; index += 1) {
		const sample = walk[index];
		if (sample.river) {
			if (!current) {
				current = {
					river: sample.river.name,
					firstIndex: index,
					// The routed point this run starts at. `appendRoadRibbon` emits two vertices per point
					// in order, so this and `lastPointIndex` name the ribbon vertices a deck has to carry.
					firstPointIndex: sample.pointIndex,
					waterMeters: 0,
					surfaceY: -Infinity,
				};
			}
			current.waterMeters += sample.meters;
			current.lastIndex = index;
			current.lastPointIndex = sample.pointIndex + 1;
			current.surfaceY = Math.max(current.surfaceY, sample.river.surfaceY);
		} else if (current) {
			runs.push(current);
			current = null;
		}
	}
	if (current) runs.push(current);
	return runs;
}

/**
 * Every place a routed road edge crosses a drawn river course.
 *
 * @param {object} options
 * @param {{fromId: string, toId: string, points: {x: number, y: number, z: number}[]}[]} options.roadEdges
 *   `buildRoadNetwork`'s own `edges` — the routes it actually ribboned, not a recomputation of them.
 * @param {{name?: string, points: {x: number, y: number, z: number}[]}[]} options.riverCourses
 *   The courses `sceneManager.js` already assembles: the historical river plus every named river.
 * @param {(worldX: number, worldZ: number) => number} options.sampleHeightMeters Live ground field.
 * @returns {{id: string, edgeId: string, river: string, waterMeters: number, deckY: number,
 *   startX: number, startZ: number, endX: number, endZ: number, startGroundY: number,
 *   endGroundY: number, waterSurfaceY: number, deckAboveWaterMeters: number,
 *   deckAboveHigherBankMeters: number}[]} One entry per crossing, source order, so the same world
 *   always produces the same list.
 */
export function findRoadRiverCrossings({ roadEdges, riverCourses, sampleHeightMeters }) {
	const policy = ROAD_RIVER_BRIDGE_POLICY;
	if (!Array.isArray(roadEdges) || !Array.isArray(riverCourses) || !riverCourses.length) return [];
	const marginSamples = Math.round(policy.bankMarginMeters / policy.sampleStepMeters);
	const crossings = [];

	for (const edge of roadEdges) {
		const edgeId = `${edge.fromId}->${edge.toId}`;
		const walk = sampleEdge(edge.points, riverCourses, sampleHeightMeters, policy);
		let crossingIndex = 0;
		for (const run of contiguousWetRuns(walk)) {
			if (run.waterMeters < policy.minimumWaterMeters) continue;
			const start = walk[Math.max(0, run.firstIndex - marginSamples)];
			const end = walk[Math.min(walk.length - 1, run.lastIndex + marginSamples)];
			const startGroundY = sampleHeightMeters(start.x, start.z);
			const endGroundY = sampleHeightMeters(end.x, end.z);
			// The deck clears whichever is higher, the banks it lands on or the water it spans. Flooring
			// on the water rather than on sea level is the correction this module exists to carry — see
			// the module doc for the seven crossings the sea-level floor put underwater.
			const deckY = Math.max(startGroundY, endGroundY, run.surfaceY + policy.deckFreeboardMeters);
			// Is this a crossing at all, or the road travelling along the channel? A deck is a straight
			// chord from bank to bank, so it is only justified where the water actually lies along that
			// chord. See `minimumChordWetShareOfExpected` for the measurement.
			const spanMeters = Math.hypot(end.x - start.x, end.z - start.z);
			const chordWetShare = wetShareAlongChord(start, end, spanMeters, riverCourses, sampleHeightMeters, policy);
			const expectedWetShare = run.waterMeters / (run.waterMeters + 2 * policy.bankMarginMeters);
			const decked = chordWetShare >= expectedWetShare * policy.minimumChordWetShareOfExpected;
			crossingIndex += 1;
			crossings.push(Object.freeze({
				id: `${edgeId}#${crossingIndex}`,
				edgeId,
				river: run.river,
				waterMeters: Number(run.waterMeters.toFixed(2)),
				spanMeters: Number(spanMeters.toFixed(2)),
				// Whether a deck is justified here at all, and the two numbers behind that call.
				decked,
				chordWetSharePercent: Number((chordWetShare * 100).toFixed(1)),
				expectedWetSharePercent: Number((expectedWetShare * 100).toFixed(1)),
				startX: Number(start.x.toFixed(3)),
				startZ: Number(start.z.toFixed(3)),
				endX: Number(end.x.toFixed(3)),
				endZ: Number(end.z.toFixed(3)),
				startGroundY: Number(startGroundY.toFixed(3)),
				endGroundY: Number(endGroundY.toFixed(3)),
				waterSurfaceY: Number(run.surfaceY.toFixed(3)),
				// Inclusive range of routed points the water covers. `appendRoadRibbon` emits two vertices
				// per point in order, so this names the ribbon vertices a deck has to carry.
				firstPointIndex: run.firstPointIndex,
				lastPointIndex: Math.min(run.lastPointIndex, edge.points.length - 1),
				deckY: Number(deckY.toFixed(3)),
				deckAboveWaterMeters: Number((deckY - run.surfaceY).toFixed(3)),
				deckAboveHigherBankMeters: Number((deckY - Math.max(startGroundY, endGroundY)).toFixed(3)),
			}));
		}
	}
	return crossings;
}

/**
 * Name of the per-vertex attribute marking how much of a bridge deck a road vertex carries: 0 on
 * ordinary road, 1 on the deck itself, and the ramp fraction in between. `scripts/
 * checkRoadRibbonGrounding.js` reads it to know which vertices are *meant* to stand off the ground.
 */
export const ROAD_BRIDGE_DECK_ATTRIBUTE = 'roadBridgeDeck';

/** Along-path distance to each routed point, so an approach can be measured in metres not indices. */
function arcLengths(points) {
	const arc = [0];
	for (let index = 1; index < points.length; index += 1) {
		const a = points[index - 1];
		const b = points[index];
		arc.push(arc[index - 1] + Math.hypot(b.x - a.x, b.z - a.z));
	}
	return arc;
}

/**
 * Raises a road ribbon onto its bridge decks, with a graded approach at each end.
 *
 * **Why this mutates the built mesh instead of building it differently.** `appendRoadRibbon` emits
 * exactly two vertices per routed point, edge after edge in order, and `buildRoadNetwork` hands back
 * the very same `points` arrays it ribboned. So the mapping from a crossing's routed-point range to
 * its ribbon vertices is exact and can be reconstructed afterwards — which means the roads keep being
 * built the way they always were, and nothing that reads `roads.js` has to learn about rivers.
 *
 * **The profile.** Flat at `deckY` across the crossing, then a straight ramp back down to the road's
 * own height over `approachMeters` at each end. A vertex is only ever raised, never lowered: the road
 * already climbs and falls with the ground, and pulling it *down* onto a deck would bury it.
 *
 * Measured on the eight live crossings, the deck stands 1.56-2.71 m above the higher bank, so a 20 m
 * approach puts every ramp between 4.5 and 7.7 degrees — well inside what a cart road takes.
 *
 * @param {object} options
 * @param {import('three').Mesh} options.roadMesh The cart-road ribbon, `roads.js`'s `group.children[0]`.
 * @param {{fromId: string, toId: string, points: object[]}[]} options.roadEdges The same `edges` those
 *   ribbon vertices were built from, in the same order.
 * @param {ReturnType<typeof findRoadRiverCrossings>} options.crossings
 * @returns {{raisedVertices: number, maxLiftMeters: number, maxApproachGradeDegrees: number}} What it did.
 */
export function applyBridgeDecks({ roadMesh, roadEdges, crossings }) {
	const summary = { raisedVertices: 0, maxLiftMeters: 0, maxApproachGradeDegrees: 0 };
	const position = roadMesh?.geometry?.getAttribute('position');
	if (!position || !crossings?.length) return summary;

	// Vertex offset of each edge, in the order `routeEdges` appended them.
	const offsets = new Map();
	let vertex = 0;
	for (const edge of roadEdges) {
		offsets.set(`${edge.fromId}->${edge.toId}`, { vertex, edge });
		vertex += edge.points.length * 2;
	}
	if (vertex > position.count) return summary; // Not the mesh these edges built; leave it alone.

	const deck = new Float32Array(position.count);
	const approachMeters = ROAD_RIVER_BRIDGE_POLICY.approachMeters;

	for (const crossing of crossings) {
		const entry = offsets.get(crossing.edgeId);
		if (!entry) continue;
		const { edge, vertex: base } = entry;
		const arc = arcLengths(edge.points);
		const spanStart = arc[crossing.firstPointIndex];
		const spanEnd = arc[crossing.lastPointIndex];
		// A crossing whose point range does not land on this edge cannot be decked, and must not be
		// guessed at. Getting this wrong once already cost a road vertex a 1772 m lift: an undefined
		// index made `spanStart` NaN, both range tests fell through to the trailing-ramp branch, and
		// `1 - (here - spanEnd) / approach` on a point 960 m *before* the span returned a carry of 41
		// instead of a fraction. Silent, and visible only as a road standing in the stratosphere.
		if (!Number.isFinite(spanStart) || !Number.isFinite(spanEnd)) continue;
		for (let index = 0; index < edge.points.length; index += 1) {
			const here = arc[index];
			// 1 across the span, falling linearly to 0 over the approach at either end.
			let carry = 0;
			if (here >= spanStart && here <= spanEnd) carry = 1;
			else if (here < spanStart) carry = Math.max(0, 1 - (spanStart - here) / approachMeters);
			else carry = Math.max(0, 1 - (here - spanEnd) / approachMeters);
			// Belt as well as braces: the profile is a fraction by construction, and clamping says so.
			carry = Math.min(1, Math.max(0, carry));
			if (!(carry > 0)) continue;
			deck[base + index * 2] = Math.max(deck[base + index * 2], carry);
			deck[base + index * 2 + 1] = Math.max(deck[base + index * 2 + 1], carry);
			for (const side of [0, 1]) {
				const target = base + index * 2 + side;
				const naturalY = position.getY(target);
				// Only ever raised. The ramp interpolates between the road's own height and the deck.
				const raisedY = Math.max(naturalY, naturalY + (crossing.deckY - naturalY) * carry);
				if (raisedY <= naturalY) continue;
				position.setY(target, raisedY);
				summary.raisedVertices += 1;
				summary.maxLiftMeters = Math.max(summary.maxLiftMeters, raisedY - naturalY);
			}
		}
		const lift = crossing.deckAboveHigherBankMeters;
		if (lift > 0) {
			summary.maxApproachGradeDegrees = Math.max(
				summary.maxApproachGradeDegrees,
				(Math.atan(lift / approachMeters) * 180) / Math.PI,
			);
		}
	}

	position.needsUpdate = true;
	// Built through the position attribute's own constructor rather than by importing three: this
	// module is otherwise pure arithmetic over plain objects, and it is worth keeping it that way.
	const BufferAttribute = Object.getPrototypeOf(position).constructor;
	roadMesh.geometry.setAttribute(ROAD_BRIDGE_DECK_ATTRIBUTE, new BufferAttribute(deck, 1));
	roadMesh.geometry.computeVertexNormals();
	summary.maxLiftMeters = Number(summary.maxLiftMeters.toFixed(3));
	summary.maxApproachGradeDegrees = Number(summary.maxApproachGradeDegrees.toFixed(2));
	return summary;
}

/**
 * Turns a crossing into the descriptor `world/worldReferenceStoneBridgeMedievalArtV2.js` draws from.
 *
 * The arch geometry is fitted to the headroom that actually exists rather than to the run-191
 * policy's `minimumArchRiseMeters` of 3.4 m. That figure was written for a shadow world whose decks
 * were floored on sea level; here a deck stands `deckFreeboardMeters` above its own river, so an arch
 * rising 3.4 m beneath it would spring from under the water. What is left between the water and the
 * underside of the deck is the rise, and an arch of that rise over this span is a segmental arch —
 * which is the form a medieval mason reaches for over a wide, shallow river anyway.
 *
 * @param {ReturnType<typeof findRoadRiverCrossings>[number]} crossing
 * @param {{deckThicknessMeters: number, bridgeWidthMeters: number, targetArchSpanMeters: number}} stonePolicy
 *   `STONE_BRIDGE_OWNER_POLICY`, passed in so this module keeps no dependency on the shadow tree.
 */
export function toStoneBridgeDescriptor(crossing, stonePolicy) {
	const spanMeters = crossing.spanMeters;
	const archCount = Math.max(1, Math.round(spanMeters / stonePolicy.targetArchSpanMeters));
	const deckBottomY = crossing.deckY - stonePolicy.deckThicknessMeters * 0.5;
	const archRiseMeters = Math.max(0.6, deckBottomY - crossing.waterSurfaceY);
	const dx = crossing.endX - crossing.startX;
	const dz = crossing.endZ - crossing.startZ;
	return Object.freeze({
		id: crossing.id,
		edgeId: crossing.edgeId,
		startX: crossing.startX,
		startZ: crossing.startZ,
		endX: crossing.endX,
		endZ: crossing.endZ,
		centerX: (crossing.startX + crossing.endX) * 0.5,
		centerZ: (crossing.startZ + crossing.endZ) * 0.5,
		// The same convention `yawForDirection` uses in the shadow planner, so the art module orients
		// these exactly as it orients its own.
		yawRadians: Math.atan2(-dz, dx),
		deckY: crossing.deckY,
		structuralSpanMeters: spanMeters,
		archCount,
		archSpanMeters: spanMeters / archCount,
		archRiseMeters,
		bridgeWidthMeters: stonePolicy.bridgeWidthMeters,
	});
}
