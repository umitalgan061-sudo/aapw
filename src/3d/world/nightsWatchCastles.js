/**
 * The Night's Watch castles on the Wall.
 *
 * **The Wall had nobody on it.** Run 375 built three hundred miles of ice across the top of the world
 * and left it bare — no gate, no stair, no garrison, and nothing at Castle Black but the Kingsroad
 * arriving at empty ground. The owner asked for the castle to be put where the map puts it, on the
 * Wall north of Winterfell.
 *
 * **Castle Black is not a castle, and that decides how it is built.** The books are specific: it has no
 * walls to defend it to the west, east, or south — only the Wall stands to the north. It is a cluster
 * of stone towers and timber keeps at the Wall's foot. Building a walled enclosure here would be wrong
 * in the one way that is obvious from ground level, so nothing in this module draws a curtain wall.
 * See `docs/westeros-lore-reference.md` for the sourced detail behind every number below.
 *
 * **Three castles, not nineteen.** Nineteen were raised along the Wall and the Watch dwindled until
 * only three were still manned: the Shadow Tower near the western end, Castle Black at the centre where
 * the Kingsroad arrives, and Eastwatch-by-the-Sea at the eastern end where the Wall meets the sea. That
 * is what stands here. The other sixteen are ruins in the story and would be ruins here; they are a
 * later job, not silently forgotten.
 *
 * **Placement comes from the Wall itself, not from a second transcription.** Each castle is positioned
 * by a parameter along `theWall.js`'s own centreline, so a castle cannot drift off the Wall if the
 * Wall ever moves. Castle Black's parameter is not a guess either: it is the point on the centreline
 * closest to the `jon` kingdom seat, which `world/settlements.js` already places from the owner map and
 * which `scripts/checkTheWall.js` already holds to within 400 m of the Wall's line.
 *
 * **Geometry, not terrain.** Same reasoning as the Wall: these sit on the height field and change
 * nothing about it.
 *
 * **Deterministic.** Every dimension is fixed policy; the only variation is an integer-free hash of
 * world position for stone tone. No `Math.random()`.
 *
 * @module world/nightsWatchCastles
 */

import * as THREE from 'three';
import { THE_WALL_POLICY, sampleWallCentreline } from './theWall.js';
import { KINGDOM_SEATS } from './settlements.js';
import { WORLD_SCALE } from '../config.js';

export const NIGHTS_WATCH_POLICY = Object.freeze({
	id: 'nights-watch-castles-2026-08-21-v1',
	/** Metres south of the Wall's centreline that the castle yard is laid out in. */
	yardOffsetMeters: 34,
	/** The King's Tower is a hundred feet, per the books. */
	kingsTowerHeightMeters: 30,
	kingsTowerRadiusMeters: 5.5,
	/** Merlons around the King's Tower's crown. */
	merlonCount: 12,
	merlonHeightMeters: 1.8,
	/** The Lord Commander's Tower — square, stone, shorter than the King's Tower. */
	commandersTowerHeightMeters: 22,
	commandersTowerSideMeters: 9,
	/** The common hall: a great timbered keep, long and low, where the brothers eat. */
	commonHallLengthMeters: 26,
	commonHallWidthMeters: 12,
	commonHallHeightMeters: 9,
	/**
	 * The wooden stair switching back up the Wall's south face.
	 *
	 * Fourteen flights, not eight. The climb is the Wall's full height above the yard — about 220 m —
	 * so eight flights put each one at a 46-degree pitch, which reads as a ladder rather than a stair.
	 * Fourteen brings it to roughly 31 degrees: steep, as a stair up seven hundred feet of ice ought to
	 * be, but a stair.
	 */
	stairFlightCount: 14,
	stairWidthMeters: 3.2,
	stairRunMeters: 26,
	/** The winch cage that rides the Wall's face, and the frame at the top that works it. */
	cageSideMeters: 3,
	cageHangMeters: 26,
	winchFrameLengthMeters: 9,
	/** Colours: cold northern stone, dark weathered timber, black iron. */
	stoneColor: 0x6f7681,
	timberColor: 0x4a3a2c,
	ironColor: 0x2b2b30,
	roofColor: 0x3a3f46,
	stoneMottle: 0.09,
});

/** The three castles still manned, as a parameter along the Wall from its west end to its east end. */
export const NIGHTS_WATCH_CASTLES = Object.freeze([
	Object.freeze({ id: 'shadow-tower', name: 'The Shadow Tower', along: 0.08, kind: 'watchtower' }),
	/** `along` is resolved from the `jon` seat at build time — see `castleBlackAlong`. */
	Object.freeze({ id: 'castle-black', name: 'Castle Black', along: null, kind: 'garrison' }),
	Object.freeze({ id: 'eastwatch', name: 'Eastwatch-by-the-Sea', along: 0.93, kind: 'watchtower' }),
]);

/** Deterministic [0,1) hash of a quantised world position — the same family every `world/` module uses. */
function positionHash01(x, y, z) {
	const value = Math.sin(Math.round(x) * 127.1 + Math.round(y) * 311.7 + Math.round(z) * 74.7) * 43758.5453;
	return value - Math.floor(value);
}

/** A stone/timber material whose tone varies a little with where the piece stands. */
function buildMaterial(color, x, y, z, roughness) {
	const mottle = 1 + (positionHash01(x, y, z) - 0.5) * 2 * NIGHTS_WATCH_POLICY.stoneMottle;
	const tone = new THREE.Color(color).multiplyScalar(mottle);
	return new THREE.MeshStandardMaterial({ color: tone, roughness, metalness: 0 });
}

/**
 * `standsOnGround` marks the pieces that rest on the terrain, as opposed to the ones mounted on another
 * piece (merlons on a tower crown, a roof on a hall) or hanging on the Wall's face (stair, winch, cage).
 * `scripts/checkNightsWatchCastles.js` only holds the first kind to the height field. Without the
 * distinction it measured a merlon 30 m up a tower as a structure floating 30 m in the air, which is
 * true and completely uninteresting; the flag keeps the intent in the source that knows it.
 */
function addMesh(group, geometry, material, x, y, z, rotationY = 0, standsOnGround = false) {
	const mesh = new THREE.Mesh(geometry, material);
	mesh.position.set(x, y, z);
	mesh.rotation.y = rotationY;
	mesh.castShadow = true;
	mesh.receiveShadow = true;
	mesh.userData.standsOnGround = standsOnGround;
	group.add(mesh);
	return mesh;
}

/**
 * Where along the Wall Castle Black stands: the centreline point nearest the `jon` seat.
 *
 * Derived rather than transcribed, so the castle follows the seat and the seat follows the owner map.
 * @param {{x: number, z: number}[]} centreline
 * @returns {number} Parameter in [0, 1] along the centreline.
 */
export function castleBlackAlong(centreline) {
	const { MAP_BOUNDS, METERS_PER_MAP_UNIT } = WORLD_SCALE;
	const jon = KINGDOM_SEATS.find((seat) => seat.id === 'jon');
	const jonX = (jon.mapX - (MAP_BOUNDS.minX + MAP_BOUNDS.maxX) * 0.5) * METERS_PER_MAP_UNIT;
	const jonZ = (jon.mapY - (MAP_BOUNDS.minY + MAP_BOUNDS.maxY) * 0.5) * METERS_PER_MAP_UNIT;
	let bestIndex = 0;
	let bestDistanceSquared = Infinity;
	for (let i = 0; i < centreline.length; i += 1) {
		const dx = centreline[i].x - jonX;
		const dz = centreline[i].z - jonZ;
		const distanceSquared = dx * dx + dz * dz;
		if (distanceSquared < bestDistanceSquared) {
			bestDistanceSquared = distanceSquared;
			bestIndex = i;
		}
	}
	return bestIndex / (centreline.length - 1);
}

/**
 * Builds one castle's structures at a point on the Wall.
 *
 * `southX`/`southZ` is the unit vector pointing away from the Wall on the inhabited side — everything
 * a castle has stands on that side, because the north face is the one nothing is supposed to cross.
 */
function buildCastle(group, castle, anchor, southX, southZ, alongX, alongZ, crownY, sampleHeightMeters) {
	const P = NIGHTS_WATCH_POLICY;
	const yardX = anchor.x + southX * P.yardOffsetMeters;
	const yardZ = anchor.z + southZ * P.yardOffsetMeters;
	const yardY = sampleHeightMeters(yardX, yardZ);
	const facing = Math.atan2(southX, southZ);

	// The King's Tower: round, a hundred feet, merlons around its crown, overlooking the stair's foot.
	const towerX = yardX - alongX * 13;
	const towerZ = yardZ - alongZ * 13;
	const towerBaseY = sampleHeightMeters(towerX, towerZ);
	addMesh(
		group,
		new THREE.CylinderGeometry(P.kingsTowerRadiusMeters, P.kingsTowerRadiusMeters * 1.12, P.kingsTowerHeightMeters, 14),
		buildMaterial(P.stoneColor, towerX, towerBaseY, towerZ, 0.85),
		towerX, towerBaseY + P.kingsTowerHeightMeters / 2 - 1, towerZ, 0, true,
	);
	const merlonGeometry = new THREE.BoxGeometry(1.4, P.merlonHeightMeters, 1.1);
	const merlonMaterial = buildMaterial(P.stoneColor, towerX + 1, towerBaseY, towerZ, 0.85);
	for (let i = 0; i < P.merlonCount; i += 1) {
		const angle = (i / P.merlonCount) * Math.PI * 2;
		addMesh(
			group, merlonGeometry, merlonMaterial,
			towerX + Math.cos(angle) * P.kingsTowerRadiusMeters,
			towerBaseY + P.kingsTowerHeightMeters - 1 + P.merlonHeightMeters / 2,
			towerZ + Math.sin(angle) * P.kingsTowerRadiusMeters,
			-angle,
		);
	}

	if (castle.kind === 'garrison') {
		// The Lord Commander's Tower — square stone, set across the yard from the King's Tower.
		const lcX = yardX + alongX * 15 + southX * 6;
		const lcZ = yardZ + alongZ * 15 + southZ * 6;
		const lcY = sampleHeightMeters(lcX, lcZ);
		addMesh(
			group,
			new THREE.BoxGeometry(P.commandersTowerSideMeters, P.commandersTowerHeightMeters, P.commandersTowerSideMeters),
			buildMaterial(P.stoneColor, lcX, lcY, lcZ, 0.85),
			lcX, lcY + P.commandersTowerHeightMeters / 2 - 1, lcZ, facing, true,
		);

		// The common hall: a great timbered keep, long along the Wall, with a pitched roof.
		const hallX = yardX + alongX * 2 + southX * 22;
		const hallZ = yardZ + alongZ * 2 + southZ * 22;
		const hallY = sampleHeightMeters(hallX, hallZ);
		addMesh(
			group,
			new THREE.BoxGeometry(P.commonHallLengthMeters, P.commonHallHeightMeters, P.commonHallWidthMeters),
			buildMaterial(P.timberColor, hallX, hallY, hallZ, 0.95),
			hallX, hallY + P.commonHallHeightMeters / 2 - 0.6, hallZ, facing, true,
		);
		// A three-sided prism laid on its side is a pitched roof. The Euler order matters: yaw the hall
		// into place first, *then* tip the prism onto its side, or the ridge ends up running diagonally
		// across the keep instead of along it. Assigning `.rotation.y` and `.rotation.z` separately used
		// the default XYZ order and did exactly that.
		const roof = new THREE.CylinderGeometry(P.commonHallWidthMeters * 0.62, P.commonHallWidthMeters * 0.62, P.commonHallLengthMeters, 3, 1);
		const roofMesh = addMesh(
			group, roof, buildMaterial(P.roofColor, hallX, hallY + 9, hallZ, 0.9),
			hallX, hallY + P.commonHallHeightMeters - 0.4, hallZ, facing,
		);
		roofMesh.rotation.set(0, facing, Math.PI / 2, 'YZX');

		// Two smaller timber keeps, so the yard reads as a settlement rather than three lone objects.
		for (const [offsetAlong, offsetSouth, side] of [[-24, 26, 8], [24, 30, 7]]) {
			const kx = yardX + alongX * offsetAlong + southX * offsetSouth;
			const kz = yardZ + alongZ * offsetAlong + southZ * offsetSouth;
			const ky = sampleHeightMeters(kx, kz);
			addMesh(
				group, new THREE.BoxGeometry(side, 6.5, side * 0.8),
				buildMaterial(P.timberColor, kx, ky, kz, 0.95),
				kx, ky + 3.25 - 0.5, kz, facing, true,
			);
		}
	}

	// The wooden stair, switching back up the Wall's south face from the yard to the crown.
	//
	// Every flight shares the same horizontal centre — that is what a switchback *is*: you climb one
	// way, turn on a landing, climb back the other way over your own head. An earlier revision offset
	// alternate flights sideways by half a run, which put them at two fixed positions instead of one
	// and rendered as a ladder of disconnected planks hanging in front of the ice.
	const stairMaterial = buildMaterial(P.timberColor, yardX, yardY, yardZ, 0.95);
	const climb = crownY - yardY;
	const flightRise = climb / P.stairFlightCount;
	// The face is `thicknessMeters / 2` out from the centreline; the stair hangs just clear of it.
	const faceOffset = THE_WALL_POLICY.thicknessMeters / 2 + P.stairWidthMeters / 2;
	const flightLength = Math.hypot(P.stairRunMeters, flightRise);
	const flightGeometry = new THREE.BoxGeometry(flightLength, 0.7, P.stairWidthMeters);
	const landingGeometry = new THREE.BoxGeometry(P.stairWidthMeters * 1.6, 0.7, P.stairWidthMeters * 1.4);
	const wallAngle = Math.atan2(alongX, alongZ) + Math.PI / 2;
	for (let i = 0; i < P.stairFlightCount; i += 1) {
		const direction = i % 2 === 0 ? 1 : -1;
		const flightY = yardY + flightRise * (i + 0.5);
		const sx = anchor.x + southX * faceOffset;
		const sz = anchor.z + southZ * faceOffset;
		const flight = new THREE.Mesh(flightGeometry, stairMaterial);
		flight.position.set(sx, flightY, sz);
		flight.rotation.y = wallAngle;
		flight.rotateZ(Math.atan2(flightRise, P.stairRunMeters) * direction);
		flight.castShadow = true;
		flight.receiveShadow = true;
		group.add(flight);

		// A landing at the end each flight arrives at, so the turns read as joined rather than floating.
		//
		// The sign is negative, and that is not a fudge. `rotation.y = wallAngle` maps the flight box's
		// local +X onto **minus** the along-Wall direction, and `rotateZ(+angle)` lifts that same local
		// +X end — so a flight climbing with `direction = +1` arrives on the `-along` side. Placing the
		// landing at `+direction` put every one of them at the opposite end from the flight that was
		// supposed to reach it, which rendered as slabs hanging in the air beside the stair.
		const landingAlong = -direction * (P.stairRunMeters / 2);
		addMesh(
			group, landingGeometry, stairMaterial,
			sx + alongX * landingAlong, yardY + flightRise * (i + 1), sz + alongZ * landingAlong,
			wallAngle,
		);
	}

	// The winch and its cage: a frame on the crown, and the iron cage hanging down the face.
	const winchX = anchor.x + southX * 3;
	const winchZ = anchor.z + southZ * 3;
	addMesh(
		group,
		new THREE.BoxGeometry(P.winchFrameLengthMeters, 1.1, 1.1),
		buildMaterial(P.timberColor, winchX, crownY, winchZ, 0.95),
		winchX, crownY + 2.4, winchZ, Math.atan2(alongX, alongZ) + Math.PI / 2,
	);
	for (const side of [-1, 1]) {
		const px = winchX + alongX * side * (P.winchFrameLengthMeters / 2 - 0.5);
		const pz = winchZ + alongZ * side * (P.winchFrameLengthMeters / 2 - 0.5);
		addMesh(
			group, new THREE.BoxGeometry(0.9, 3.4, 0.9),
			buildMaterial(P.timberColor, px, crownY, pz, 0.95),
			px, crownY + 1.1, pz,
		);
	}
	const cageY = crownY - P.cageHangMeters;
	addMesh(
		group,
		new THREE.BoxGeometry(P.cageSideMeters, P.cageSideMeters, P.cageSideMeters),
		buildMaterial(P.ironColor, winchX, cageY, winchZ, 0.6),
		winchX, cageY, winchZ,
	);

	return { id: castle.id, name: castle.name, x: yardX, z: yardZ, groundY: yardY };
}

/**
 * Builds the manned Night's Watch castles along the Wall.
 *
 * @param {object} options
 * @param {(x: number, z: number) => number} options.sampleHeightMeters
 * @returns {{group: THREE.Group, castles: {id: string, name: string, x: number, z: number, groundY: number}[], crownY: number}}
 */
export function createNightsWatchCastles({ sampleHeightMeters }) {
	const centreline = sampleWallCentreline(sampleHeightMeters);
	let highestGround = -Infinity;
	for (const point of centreline) highestGround = Math.max(highestGround, point.groundY);
	const crownY = highestGround + THE_WALL_POLICY.heightMeters;

	const west = centreline[0];
	const east = centreline[centreline.length - 1];
	const dx = east.x - west.x;
	const dz = east.z - west.z;
	const length = Math.hypot(dx, dz) || 1;
	const alongX = dx / length;
	const alongZ = dz / length;
	// The Wall runs roughly east-west and the inhabited side is the south — larger z in this projection.
	let southX = -alongZ;
	let southZ = alongX;
	if (southZ < 0) {
		southX = -southX;
		southZ = -southZ;
	}

	const group = new THREE.Group();
	group.name = 'nights-watch-castles';
	const built = [];
	for (const castle of NIGHTS_WATCH_CASTLES) {
		const along = castle.along ?? castleBlackAlong(centreline);
		const index = Math.min(centreline.length - 1, Math.max(0, Math.round(along * (centreline.length - 1))));
		built.push(buildCastle(group, castle, centreline[index], southX, southZ, alongX, alongZ, crownY, sampleHeightMeters));
	}
	return { group, castles: built, crownY };
}

/**
 * Builds them and adds them to the live scene — the `world/worldDressing.js` layer signature.
 *
 * @param {object} options
 * @param {object} options.state Needs `scene` and `groundCollider`.
 * @returns {Promise<THREE.Group>}
 */
export async function initNightsWatchCastles({ state }) {
	const { group, castles, crownY } = createNightsWatchCastles({
		sampleHeightMeters: state.groundCollider.getGroundHeight,
	});
	state.scene.add(group);
	console.info(
		`[game3d] Night's Watch: ${castles.map((castle) => castle.name).join(', ')} — ` +
			`${group.children.length} structures, Wall crown at ${crownY.toFixed(0)} m.`,
	);
	return group;
}

/** Disposes them — same single-argument convention as every other `world/` disposer. */
export function disposeNightsWatchCastles(group) {
	group.traverse((node) => {
		if (!node.isMesh) return;
		node.geometry?.dispose?.();
		const materials = Array.isArray(node.material) ? node.material : [node.material];
		for (const material of materials) material?.dispose?.();
	});
	group.clear();
}
