/**
 * `gameplay/cartBrain.js` — the horse-drawn cart ("at arabası"/kağnı), FAZ 6's last named gap
 * (GOVERNANCE.md §17: "Tek kalan FAZ 6 maddesi **araba** — at arabası/kağnı, bir taşıt, bir canlı
 * değil; ayrı bir tasarım/mekanik kapsamı gerektirir"). Every other FAZ 6 item is a *creature*
 * (`gameplay/creatureBrain.js` wanders/reacts to the player); a cart is a *vehicle* — it has no
 * wander/flee behaviour of its own, it simply travels back and forth along one real road-network
 * edge (`world/roads.js`'s cart-road tier — the same "at arabası yolu" the road system has been
 * named after since it was first built) at a fixed pace, the way medieval road traffic would.
 *
 * **Asset-first visual with procedural fallback.** The repository now contains the owner-approved
 * `ancient_horse_chariot_mauryan_era.glb`, so a hydrated, materially-distinct copy replaces the old
 * primitive silhouette after shared material/placement validation. The primitive wagon-plus-horse
 * remains visible while that async load is pending and remains the deterministic fallback when the
 * LFS binary is unavailable or the imported material/bounds fail validation.
 *
 * **Movement — path-following, not wander/flee.** A cart is bound to one `world/roads.js` cart-road
 * edge (`{points: {x,y,z}[]}`, already routed slope-aware and terrain-sampled by
 * `world/roadPathfinder.js` — this module does no ground sampling of its own, it only interpolates
 * the edge's own points) and ping-pongs between the edge's two endpoints: travel forward until the
 * far end, pause briefly (loading/unloading flavor), reverse, travel back, pause, repeat. Still no
 * `playerCollider` consultation and no player-awareness — a cart never reacts to, flees, or notices
 * the player, purely background road traffic on a committed path. It is, however, itself a *solid*
 * obstacle as of run 337: `getCollisionCircle()` (below) feeds `physics.js`'s
 * `createDynamicCircleCollider` so the player can no longer walk through a cart — the one-way
 * "player notices the cart, the cart never notices the player" split is deliberate, not an
 * oversight (a self-driving cart reacting to being bumped would need its own AI, out of scope here).
 *
 * Determinism: each cart's starting position along its edge and initial travel direction come from a
 * `mulberry32(hashSeedString(cartId) ^ tag)` stream (same "string id -> FNV-1a -> mulberry32" shape
 * `creatureBrain.js` already established), so the same seed always starts every cart at the same
 * point moving the same way (GOVERNANCE.md §8.9). Per-frame movement is an ordinary `delta`
 * integration, same frame-rate-independence ceiling as every other gameplay system here.
 * @module gameplay/cartBrain
 */

import * as THREE from 'three';
import { ROAD_COMFORT_GRADE_DEGREES } from '../world/roadPathfinder.js';
import { beginCartVisualAssetUpgrade } from './cartVisualAsset.js';

/** Wood/iron/horse palette — kept in its own warm, muted family so a cart reads as "medieval cargo
 * traffic" against `world/roads.js`'s tan `ROAD_COLOR` (0x9c7b4a) without matching it exactly (a
 * cart the same color as the road under it would be hard to spot). */
const CART_BED_COLOR = 0x6b4a2f;
const CART_RAIL_COLOR = 0x54371f;
const WHEEL_COLOR = 0x241a10;
const HORSE_BODY_COLOR = 0x4a3222;
const HORSE_MANE_COLOR = 0x241a10;

/** Every dimension below is this pass's own first-pass proportion judgment (no real reference asset
 * to match), same "temporary default, no real playtest yet" category `creatureBrain.js`'s own
 * `CREATURE_BEHAVIOR_PROFILES` doc comment already logs — scaled against `world/roads.js`'s own
 * 8m-wide cart road (a ~1.3m track width comfortably fits two carts passing) and the player's own
 * ~1.8m body height (`PLAYER_CONFIG`) for a proportionate wagon. */
const BASE_CART_CONFIG = {
	speedMps: 2.0,
	turnRateRadiansPerSecond: 1.6,
	pauseAtEndSeconds: 2.5,
	wheelRadiusMeters: 0.42,
	wheelThicknessMeters: 0.12,
	trackWidthMeters: 1.3,
	wheelbaseMeters: 1.8,
	bedWidthMeters: 1.2,
	bedLengthMeters: 2.0,
	bedHeightMeters: 0.4,
	railHeightMeters: 0.35,
	horseBodyLengthMeters: 1.7,
	horseBodyWidthMeters: 0.55,
	horseBodyHeightMeters: 0.75,
	horseLegHeightMeters: 0.95,
	horseLegThicknessMeters: 0.14,
	harnessGapMeters: 0.6,
	/** Minimum road-edge length, in meters, for an edge to be worth putting a cart on — short enough
	 * an edge and a full stop-turn-stop cycle reads as pointless jitter rather than real travel. */
	minEdgeLengthMeters: 60,
};

/** Front/back extent of the whole wagon-plus-horse rig along its own local +Z (forward), derived
 * from the same offsets `createCartMesh` places each part at — the wagon's back rail sits at
 * `-bedLengthMeters/2`, the horse's own front (body + a small head/mane margin) sits at
 * `wheelbaseMeters/2 + harnessGapMeters + horseBodyLengthMeters + 0.2`. Used below to size and
 * center run 337's player-cart collision circle (see `getCollisionCircle()`) — `physics.js`
 * deliberately has no rotated-box math (see its own doc comment on why castles/houses use cheap
 * analytic shapes instead), and this asymmetric rig is even less rectangle-shaped than a house, so a
 * single circle shifted forward off the wagon's own tracked axle point (which sits well behind the
 * rig's true geometric middle, close to the horse) covers the whole footprint far more tightly than
 * a circle centered on the axle would — same "generous at the edges, never under-blocks" precedent
 * `createCircleCollider`'s own doc comment already established for village houses. */
/** Grade-aware speed calibration (run 338, closing run 336/ADR-0282's own named gap: "the cart moves
 * at one constant speedMps regardless of a given road segment's real grade"). A horse leans into an
 * uphill pull and eases off downhill rather than holding one pace regardless of slope — this scales
 * `CART_CONFIG.speedMps` by the *signed* grade of the polyline segment currently under the cart, in
 * its direction of travel (uphill when moving from a lower point to a higher one, downhill the
 * reverse — the same edge is uphill one way and downhill the other, so this is direction-of-travel
 * dependent, not a per-edge constant).
 *
 * Reuses `world/roadPathfinder.js`'s own `ROAD_COMFORT_GRADE_DEGREES` (10°) as the "still comfortable"
 * reference rather than inventing a second grade constant — the road network already treats grades at
 * or under this as effectively free to route, so a cart crossing one should barely need to slow. The
 * upper reference, `STEEP_GRADE_DEGREES`, is this pass's own first-pass judgment (no prior reference
 * value in this codebase, same "temporary default, no real playtest yet" category as `CART_CONFIG`'s
 * own doc comment already logs for speed/dimensions/count) — set just under
 * `scripts/terrainSeatSafetyCheck.js`'s 35° foot-walkable ceiling, since a laden cart should struggle
 * on ground a person can still climb, not merely be inconvenienced by it. Grades at/beyond it clamp to
 * this pass's own minimum/maximum multiplier rather than slowing/speeding without bound. */
const STEEP_GRADE_DEGREES = 30;
/** Speed multiplier at/beyond `STEEP_GRADE_DEGREES` uphill — a labouring walk, not a stop (this world's
 * roads are always routable per `world/roadPathfinder.js`'s own module doc, so a cart is never asked
 * to climb something impassable, just something slow). */
const UPHILL_MIN_SPEED_FRACTION = 0.35;
/** Speed multiplier at/beyond `STEEP_GRADE_DEGREES` downhill — capped well under "runaway wagon" so the
 * effect reads as "eases off the brake" rather than a physically-simulated freewheel. */
const DOWNHILL_MAX_SPEED_FRACTION = 1.3;

/**
 * Signed grade, in degrees, of the straight segment from `a` to `b` (positive = `b` higher than `a`).
 * Matches `world/roadPathfinder.js`'s own horizontal-distance convention for "run" (XZ only, ignoring
 * the rise itself in the denominator) so this reads the same physical angle the road network's own
 * routing cost already reasons about.
 * @param {{x: number, y: number, z: number}} a
 * @param {{x: number, y: number, z: number}} b
 * @returns {number}
 */
function segmentGradeDegrees(a, b) {
	const runMeters = Math.hypot(b.x - a.x, b.z - a.z);
	if (runMeters < 1e-6) return 0; // degenerate/zero-length segment — no defined slope, treat as flat
	return (Math.atan2(b.y - a.y, runMeters) * 180) / Math.PI;
}

/**
 * Converts a signed direction-of-travel grade into a speed multiplier: exactly 1 (no slowdown) at or
 * under `ROAD_COMFORT_GRADE_DEGREES` — matching the road network's own "effectively free" threshold —
 * then eases down when climbing / eases up (capped) when descending, linear out to
 * `STEEP_GRADE_DEGREES` in each direction, clamped beyond it.
 * @param {number} travelGradeDegrees Positive = climbing in the cart's current direction of travel.
 * @returns {number}
 */
function gradeSpeedMultiplier(travelGradeDegrees) {
	const absGrade = Math.abs(travelGradeDegrees);
	if (absGrade <= ROAD_COMFORT_GRADE_DEGREES) return 1;
	const t = Math.min(1, (absGrade - ROAD_COMFORT_GRADE_DEGREES) / (STEEP_GRADE_DEGREES - ROAD_COMFORT_GRADE_DEGREES));
	return travelGradeDegrees >= 0 ? 1 - t * (1 - UPHILL_MIN_SPEED_FRACTION) : 1 + t * (DOWNHILL_MAX_SPEED_FRACTION - 1);
}

const RIG_BACK_METERS = -(BASE_CART_CONFIG.bedLengthMeters / 2);
const RIG_FRONT_METERS = BASE_CART_CONFIG.wheelbaseMeters / 2 + BASE_CART_CONFIG.harnessGapMeters + BASE_CART_CONFIG.horseBodyLengthMeters + 0.2;

export const CART_CONFIG = Object.freeze({
	...BASE_CART_CONFIG,
	/** Local +Z offset (meters, forward) from the cart's tracked position to the collision circle's
	 * center — see `RIG_FRONT_METERS`/`RIG_BACK_METERS` above. */
	collisionForwardOffsetMeters: (RIG_FRONT_METERS + RIG_BACK_METERS) / 2,
	/** Collision circle radius (meters) — half the rig's own front-to-back span, so the circle just
	 * covers both the wagon's back rail and the horse's front once shifted by
	 * `collisionForwardOffsetMeters` above. */
	collisionRadiusMeters: (RIG_FRONT_METERS - RIG_BACK_METERS) / 2,
});

/** FNV-1a 32-bit string hash — same "string id -> numeric seed" step `creatureBrain.js`'s
 * `hashSeedString` already uses, duplicated rather than imported (this project's own established
 * precedent for a function this small — see that module's own header on why). */
function hashSeedString(text) {
	let hash = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) {
		hash ^= text.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return hash >>> 0;
}

/**
 * Builds the cumulative-arc-length table for a polyline, using XZ (ground-plane) distance only —
 * matching `world/roads.js`'s own `lengthMeters` convention (2D distance; grade/slope is tracked
 * separately as `maxGradeDegrees`), so a cart's travelled-distance accounting agrees with the road
 * network's own reported edge length.
 * @param {{x: number, y: number, z: number}[]} points
 * @returns {number[]} `cumulative[i]` = XZ distance travelled from `points[0]` through `points[i]`.
 */
function buildArcLengthTable(points) {
	const cumulative = [0];
	for (let i = 1; i < points.length; i++) {
		cumulative.push(cumulative[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z));
	}
	return cumulative;
}

/**
 * Samples a position + forward tangent at arc-length `distanceMeters` along `points` (clamped to
 * `[0, total]`). Linear interpolation between the bracketing waypoints — the same fidelity
 * `appendRoadRibbon` already renders the road surface itself at, so a cart never visually strays off
 * the rendered ribbon.
 * @param {{x: number, y: number, z: number}[]} points
 * @param {number[]} cumulative `buildArcLengthTable(points)`'s output for the same `points`.
 * @param {number} distanceMeters
 * @returns {{x: number, y: number, z: number, tangentX: number, tangentZ: number, gradeDegrees: number}}
 *   `gradeDegrees` (run 338) is the bracketing segment's own signed grade from its lower-index point
 *   to its higher-index point (see `segmentGradeDegrees`) — direction-of-travel sign is the caller's
 *   job, since the same segment is uphill one travel direction and downhill the other.
 */
function sampleAlongPath(points, cumulative, distanceMeters) {
	const total = cumulative[cumulative.length - 1];
	const clamped = Math.max(0, Math.min(total, distanceMeters));
	let low = 0;
	let high = cumulative.length - 1;
	while (low < high - 1) {
		const mid = (low + high) >> 1;
		if (cumulative[mid] <= clamped) low = mid;
		else high = mid;
	}
	const segStart = cumulative[low];
	const segEnd = cumulative[high] ?? segStart;
	const segLength = Math.max(segEnd - segStart, 1e-6);
	const t = Math.min(1, Math.max(0, (clamped - segStart) / segLength));
	const a = points[low];
	const b = points[high] ?? points[low];
	return {
		x: a.x + (b.x - a.x) * t,
		y: a.y + (b.y - a.y) * t,
		z: a.z + (b.z - a.z) * t,
		tangentX: b.x - a.x,
		tangentZ: b.z - a.z,
		gradeDegrees: segmentGradeDegrees(a, b),
	};
}

/**
 * Builds one procedural wagon-plus-draught-horse mesh group. Every part is a primitive box/cylinder
 * (no skinned rig — nothing here animates except the four wheel pivots this function also returns),
 * kept as a single small tree of meshes rather than merged into one buffer since the whole group is
 * only ~15 draw calls per cart and this project's existing per-creature `THREE.SkinnedMesh` beings
 * already cost one draw call each anyway (see `creatureSpawner.js`'s own doc comment on that budget).
 * @returns {{object3D: THREE.Group, wheelPivots: THREE.Group[], dispose: () => void}} `wheelPivots`
 *   are the four per-wheel groups `createCartBeing` spins each frame to animate rolling.
 */
function createCartMesh() {
	const c = CART_CONFIG;
	const disposables = [];
	function track(geometry, material) {
		disposables.push(geometry, material);
		return new THREE.Mesh(geometry, material);
	}

	const group = new THREE.Group();

	const bedMaterial = new THREE.MeshStandardMaterial({ color: CART_BED_COLOR, roughness: 0.9, metalness: 0 });
	const railMaterial = new THREE.MeshStandardMaterial({ color: CART_RAIL_COLOR, roughness: 0.9, metalness: 0 });
	const wheelMaterial = new THREE.MeshStandardMaterial({ color: WHEEL_COLOR, roughness: 0.85, metalness: 0.1 });
	const horseMaterial = new THREE.MeshStandardMaterial({ color: HORSE_BODY_COLOR, roughness: 0.8, metalness: 0 });
	const maneMaterial = new THREE.MeshStandardMaterial({ color: HORSE_MANE_COLOR, roughness: 0.8, metalness: 0 });

	// --- wagon bed + side/back rails --------------------------------------------------------------
	const axleHeight = c.wheelRadiusMeters * 1.6;
	const bed = track(new THREE.BoxGeometry(c.bedWidthMeters, c.bedHeightMeters, c.bedLengthMeters), bedMaterial);
	bed.position.set(0, axleHeight + c.bedHeightMeters / 2, 0);
	group.add(bed);

	const railThickness = 0.08;
	const leftRail = track(new THREE.BoxGeometry(railThickness, c.railHeightMeters, c.bedLengthMeters), railMaterial);
	leftRail.position.set(-c.bedWidthMeters / 2, axleHeight + c.bedHeightMeters + c.railHeightMeters / 2, 0);
	group.add(leftRail);
	const rightRail = track(new THREE.BoxGeometry(railThickness, c.railHeightMeters, c.bedLengthMeters), railMaterial);
	rightRail.position.set(c.bedWidthMeters / 2, axleHeight + c.bedHeightMeters + c.railHeightMeters / 2, 0);
	group.add(rightRail);
	const backRail = track(new THREE.BoxGeometry(c.bedWidthMeters, c.railHeightMeters, railThickness), railMaterial);
	backRail.position.set(0, axleHeight + c.bedHeightMeters + c.railHeightMeters / 2, -c.bedLengthMeters / 2);
	group.add(backRail);

	// --- four wheels, each its own spin pivot ------------------------------------------------------
	const wheelPivots = [];
	const wheelHalfTrack = c.trackWidthMeters / 2;
	const wheelHalfBase = c.wheelbaseMeters / 2;
	for (const [sideX, endZ] of [
		[-wheelHalfTrack, wheelHalfBase], [wheelHalfTrack, wheelHalfBase],
		[-wheelHalfTrack, -wheelHalfBase], [wheelHalfTrack, -wheelHalfBase],
	]) {
		const pivot = new THREE.Group();
		pivot.position.set(sideX, c.wheelRadiusMeters, endZ);
		const wheelMesh = track(
			new THREE.CylinderGeometry(c.wheelRadiusMeters, c.wheelRadiusMeters, c.wheelThicknessMeters, 12),
			wheelMaterial,
		);
		wheelMesh.rotation.z = Math.PI / 2; // cylinder's default axis (Y) -> aligned with the axle (X)
		pivot.add(wheelMesh);
		group.add(pivot);
		wheelPivots.push(pivot);
	}

	// --- draught horse, harnessed in front (+Z, matches `turnToward`'s forward-facing convention) --
	const horseGroup = new THREE.Group();
	const horseCenterZ = wheelHalfBase + c.harnessGapMeters + c.horseBodyLengthMeters / 2;
	horseGroup.position.set(0, 0, horseCenterZ);

	const body = track(
		new THREE.BoxGeometry(c.horseBodyWidthMeters, c.horseBodyHeightMeters, c.horseBodyLengthMeters),
		horseMaterial,
	);
	body.position.set(0, c.horseLegHeightMeters + c.horseBodyHeightMeters / 2, 0);
	horseGroup.add(body);

	const headSize = 0.32;
	const head = track(new THREE.BoxGeometry(headSize, headSize, headSize * 1.6), horseMaterial);
	head.position.set(0, c.horseLegHeightMeters + c.horseBodyHeightMeters + headSize * 0.3, c.horseBodyLengthMeters / 2 + headSize * 0.6);
	horseGroup.add(head);

	const mane = track(new THREE.BoxGeometry(0.1, headSize * 1.4, c.horseBodyLengthMeters * 0.5), maneMaterial);
	mane.position.set(0, c.horseLegHeightMeters + c.horseBodyHeightMeters + headSize * 0.2, c.horseBodyLengthMeters * 0.1);
	horseGroup.add(mane);

	for (const [legX, legZ] of [
		[-c.horseBodyWidthMeters / 2 + 0.06, c.horseBodyLengthMeters / 2 - 0.15],
		[c.horseBodyWidthMeters / 2 - 0.06, c.horseBodyLengthMeters / 2 - 0.15],
		[-c.horseBodyWidthMeters / 2 + 0.06, -c.horseBodyLengthMeters / 2 + 0.15],
		[c.horseBodyWidthMeters / 2 - 0.06, -c.horseBodyLengthMeters / 2 + 0.15],
	]) {
		const leg = track(
			new THREE.BoxGeometry(c.horseLegThicknessMeters, c.horseLegHeightMeters, c.horseLegThicknessMeters),
			horseMaterial,
		);
		leg.position.set(legX, c.horseLegHeightMeters / 2, legZ);
		horseGroup.add(leg);
	}
	group.add(horseGroup);

	// --- shafts connecting the horse's harness to the cart's front, so the two read as one rig -----
	for (const shaftX of [-0.3, 0.3]) {
		const shaft = track(new THREE.BoxGeometry(0.06, 0.06, c.harnessGapMeters + 0.2), railMaterial);
		shaft.position.set(shaftX, axleHeight, wheelHalfBase + (c.harnessGapMeters + 0.2) / 2 - 0.1);
		group.add(shaft);
	}

	return {
		object3D: group,
		wheelPivots,
		dispose() {
			for (const disposable of disposables) disposable.dispose();
		},
	};
}

/**
 * Builds one live cart being bound to a single road-network edge. Shape matches
 * `gameplay/creatureBrain.js`'s `createCreatureBeing` return contract (`{object3D, update, dispose}`)
 * so it slots into `game3d.js`'s existing `updateEntitiesSafely` loop unchanged — no `isFleeing`
 * (a cart has no reactive behaviour, see this module's own header).
 * @param {object} options
 * @param {string} options.cartId Unique id, also seeds this cart's own start-position/direction RNG.
 * @param {{fromId: string, toId: string, points: {x: number, y: number, z: number}[]}} options.edge
 *   One `world/roads.js` cart-road edge (`state.roadEdges` entry) — the cart travels back and forth
 *   along its real, already slope-aware-routed and terrain-sampled `points` polyline.
 * @param {(seed: number) => () => number} options.mulberry32
 * @returns {{object3D: THREE.Object3D, update: (delta: number) => void, dispose: () => void,
 *   visualReady: Promise<object>, getCollisionCircle: () => {x: number, z: number, radius: number}}}
 *   `visualReady` resolves after the optional real-asset upgrade; movement never waits on it.
 */
export function createCartBeing({ cartId, edge, mulberry32 }) {
	const points = edge.points;
	const cumulative = buildArcLengthTable(points);
	const totalLengthMeters = cumulative[cumulative.length - 1];

	const { object3D, wheelPivots, dispose: disposeMesh } = createCartMesh();
	object3D.name = cartId;
	object3D.userData.cartVisualMode = 'procedural-fallback';
	const rng = mulberry32(hashSeedString(cartId) ^ 0x43415254); // "CART"-ish tag
	let direction = rng() < 0.5 ? 1 : -1;
	let distanceTravelledMeters = rng() * totalLengthMeters;
	let pauseTimerSeconds = 0;
	let wheelSpinRadians = 0;

	/** Shortest-path yaw turn — same shape `creatureBrain.js`'s own `turnToward` uses (small,
	 * per-being controller; this project's precedent prefers a local copy over a shared helper for a
	 * function this small — see that module's header). */
	function turnToward(targetYawRadians, delta) {
		const turnStep = CART_CONFIG.turnRateRadiansPerSecond * delta;
		object3D.rotation.y +=
			(((targetYawRadians - object3D.rotation.y + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI) *
			Math.min(1, turnStep);
	}

	// Initial pose set once, synchronously, snapped exactly to the path (no turn-smoothing lag on the
	// very first frame) so a freshly spawned cart never renders off its road edge for even one frame.
	{
		const sample = sampleAlongPath(points, cumulative, distanceTravelledMeters);
		object3D.position.set(sample.x, sample.y, sample.z);
		const tangentX = sample.tangentX * direction;
		const tangentZ = sample.tangentZ * direction;
		if (Math.hypot(tangentX, tangentZ) > 1e-6) object3D.rotation.y = Math.atan2(tangentX, tangentZ);
	}

	const visualUpgrade = beginCartVisualAssetUpgrade({
		cartRoot: object3D,
		cartId,
		edge,
		targetLengthMeters: RIG_FRONT_METERS - RIG_BACK_METERS - 0.1,
		targetWidthMeters: CART_CONFIG.trackWidthMeters + 0.65,
		maxHeightMeters: 2.6,
		forwardOffsetMeters: CART_CONFIG.collisionForwardOffsetMeters,
	});

	return {
		object3D,
		visualReady: visualUpgrade.ready,
		update(delta) {
			if (totalLengthMeters < 1e-6) return; // degenerate edge (shouldn't happen — spawnConfiguredCarts filters these out)

			if (pauseTimerSeconds > 0) {
				pauseTimerSeconds -= delta;
				return;
			}

			// Grade-aware speed (run 338, ADR-0284): read the segment grade under the cart's *current*
			// position — before moving — in its current direction of travel, so this frame's motion
			// already reflects whatever slope the cart is on right now rather than lagging a frame
			// behind. See `gradeSpeedMultiplier`'s own doc comment for the calibration.
			const currentSample = sampleAlongPath(points, cumulative, distanceTravelledMeters);
			const travelGradeDegrees = direction * currentSample.gradeDegrees;
			const effectiveSpeedMps = CART_CONFIG.speedMps * gradeSpeedMultiplier(travelGradeDegrees);

			distanceTravelledMeters += direction * effectiveSpeedMps * delta;
			if (distanceTravelledMeters >= totalLengthMeters) {
				distanceTravelledMeters = totalLengthMeters;
				direction = -1;
				pauseTimerSeconds = CART_CONFIG.pauseAtEndSeconds;
			} else if (distanceTravelledMeters <= 0) {
				distanceTravelledMeters = 0;
				direction = 1;
				pauseTimerSeconds = CART_CONFIG.pauseAtEndSeconds;
			}

			const sample = sampleAlongPath(points, cumulative, distanceTravelledMeters);
			object3D.position.set(sample.x, sample.y, sample.z);
			const tangentX = sample.tangentX * direction;
			const tangentZ = sample.tangentZ * direction;
			if (Math.hypot(tangentX, tangentZ) > 1e-6) {
				turnToward(Math.atan2(tangentX, tangentZ), delta);
			}

			// Rolling wheels: angular speed = linear speed / radius, same real-wheel relationship,
			// signed by travel direction so the wheels visibly reverse when the cart turns around, and
			// now scaled by this frame's own grade-eased speed so the wheels visibly labour uphill
			// instead of spinning at a constant rate regardless of slope.
			wheelSpinRadians += (direction * effectiveSpeedMps * delta) / CART_CONFIG.wheelRadiusMeters;
			for (const pivot of wheelPivots) pivot.rotation.x = wheelSpinRadians;
		},
		dispose() {
			visualUpgrade.dispose();
			disposeMesh();
		},
		/**
		 * Run 337's player-cart collision (`QUESTIONS_FOR_OWNER.md`'s run-336 cart entry's "no
		 * player-cart collision" gap, same category `world/villages.js`'s house-collision gap already
		 * closed at ADR-0277): a live `{x, z, radius}` circle for `physics.js`'s
		 * `createDynamicCircleCollider`, re-queried every frame (unlike a house or a castle tower, a
		 * cart's position changes continuously) rather than baked once at scene build. Shifted forward
		 * off `object3D.position` by `CART_CONFIG.collisionForwardOffsetMeters` along the cart's own
		 * current heading (`object3D.rotation.y`, the same `atan2(tangentX, tangentZ)` yaw convention
		 * `update()`/the initial-pose block above already use) so the circle centers on the rig's true
		 * geometric middle instead of the wagon's own tracked axle point, which sits well behind it
		 * (see `CART_CONFIG`'s own doc comment).
		 * @returns {{x: number, z: number, radius: number}}
		 */
		getCollisionCircle() {
			const yaw = object3D.rotation.y;
			return {
				x: object3D.position.x + Math.sin(yaw) * CART_CONFIG.collisionForwardOffsetMeters,
				z: object3D.position.z + Math.cos(yaw) * CART_CONFIG.collisionForwardOffsetMeters,
				radius: CART_CONFIG.collisionRadiusMeters,
			};
		},
	};
}

/**
 * Deterministically selects up to `count` cart-road edges (`options.roadEdges` — `world/roads.js`'s
 * cart-road tier, `state.roadEdges`, not the narrower "patika" footpath tier) and spawns one cart on
 * each, longest edges first — a cart on a 60m stub edge would stop-turn-stop almost immediately,
 * while the network's longer backbone edges give real travel distance to actually watch. Selection
 * itself needs no RNG (a pure sort — see `CART_CONFIG.minEdgeLengthMeters`'s own doc comment for why
 * "longest first" instead of a random pick is the deliberate choice here); each individual cart's own
 * start position/direction still comes from a seeded stream (`createCartBeing`).
 *
 * **Named scope boundary (not a bug):** carts still do not consult `playerCollider` — a cart never
 * reacts to the player (see this module's own header). The *reverse* direction (the player colliding
 * with a cart) closed at run 337 via `getCollisionCircle()`; see `gameplay/livingWorldSpawner.js`'s
 * own wiring of that into `physics.js`'s `createDynamicCircleCollider`. Desktop-only for the same
 * reason mobile skips several other desktop-disc systems (`gameplay/creatureSpawner.js`'s own doc
 * comment) — mobile's small `STREAM_RADIUS_CHUNKS` world-coverage footprint means a cart bound to a
 * full-map-scale road edge would very often be outside the streamed chunk radius entirely, popping
 * in/out with chunk streaming instead of reading as a real presence; revisit once mobile's own
 * coverage grows.
 * @param {object} options
 * @param {{fromId: string, toId: string, points: {x:number,y:number,z:number}[], lengthMeters: number}[]} options.roadEdges
 * @param {(seed: number) => () => number} options.mulberry32
 * @param {number} [options.count]
 * @returns {ReturnType<typeof createCartBeing>[]}
 */
export function spawnConfiguredCarts({ roadEdges, mulberry32, count = 3 }) {
	const eligible = roadEdges
		.filter((edge) => edge.points?.length >= 2 && edge.lengthMeters >= CART_CONFIG.minEdgeLengthMeters)
		.slice()
		.sort((a, b) => b.lengthMeters - a.lengthMeters);

	if (eligible.length < count) {
		console.warn(
			`[gameplay/cartBrain] only ${eligible.length}/${count} cart-road edge(s) meet the ` +
				`${CART_CONFIG.minEdgeLengthMeters}m minimum length — spawning ${eligible.length} cart(s).`,
		);
	}

	const beings = [];
	for (const edge of eligible.slice(0, count)) {
		beings.push(createCartBeing({ cartId: `cart-${edge.fromId}-${edge.toId}`, edge, mulberry32 }));
	}
	return beings;
}
