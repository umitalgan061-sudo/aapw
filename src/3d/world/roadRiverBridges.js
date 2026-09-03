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
	 */
	deckFreeboardMeters: 1.5,
	/**
	 * A wet run shorter than this is a ford, not a bridge. Two metres of water across a road is a
	 * puddle at the edge of a course, and putting a stone arch over it would look far stranger than
	 * leaving it — the same judgement `world/rivers.js` makes when it declines to ribbon a two-point
	 * path.
	 */
	minimumWaterMeters: 6,
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
			walk.push({ x, z, meters: runMeters / steps, river: riverAt(x, z, riverCourses, sampleHeightMeters, policy) });
		}
	}
	return walk;
}

/** Groups a walked edge's wet samples into contiguous runs. */
function contiguousWetRuns(walk) {
	const runs = [];
	let current = null;
	for (let index = 0; index < walk.length; index += 1) {
		const sample = walk[index];
		if (sample.river) {
			if (!current) current = { river: sample.river.name, firstIndex: index, waterMeters: 0, surfaceY: -Infinity };
			current.waterMeters += sample.meters;
			current.lastIndex = index;
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
			crossingIndex += 1;
			crossings.push(Object.freeze({
				id: `${edgeId}#${crossingIndex}`,
				edgeId,
				river: run.river,
				waterMeters: Number(run.waterMeters.toFixed(2)),
				spanMeters: Number(Math.hypot(end.x - start.x, end.z - start.z).toFixed(2)),
				startX: Number(start.x.toFixed(3)),
				startZ: Number(start.z.toFixed(3)),
				endX: Number(end.x.toFixed(3)),
				endZ: Number(end.z.toFixed(3)),
				startGroundY: Number(startGroundY.toFixed(3)),
				endGroundY: Number(endGroundY.toFixed(3)),
				waterSurfaceY: Number(run.surfaceY.toFixed(3)),
				deckY: Number(deckY.toFixed(3)),
				deckAboveWaterMeters: Number((deckY - run.surfaceY).toFixed(3)),
				deckAboveHigherBankMeters: Number((deckY - Math.max(startGroundY, endGroundY)).toFixed(3)),
			}));
		}
	}
	return crossings;
}
