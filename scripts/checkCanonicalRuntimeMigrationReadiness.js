#!/usr/bin/env node
/** Run 196: prove the real live-runtime ownership surface is known before any canonical activation. */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

async function main() {
	const inventoryUrl = new URL('../src/3d/world/canonicalRuntimeOwnershipInventoryShadow.js', `file://${__filename}`);
	const {
		buildCanonicalRuntimeOwnershipInventoryShadow,
		inspectCanonicalRuntimeRestoreSurfaceShadow,
	} = await import(inventoryUrl.href);

	const sceneManagerSource = read('src/3d/sceneManager.js');
	const chunkManagerSource = read('src/3d/world/chunkManager.js');
	const inputSource = read('src/3d/input.js');
	const playerSource = read('src/3d/gameplay/player.js');
	const run195Source = read('src/3d/world/worldReferenceOptInMigrationControllerShadow.js');

	for (const token of [
		'renderer, scene, camera, controls, freeCamera, chunkManager, groundCollider',
		'settlements: settlementsResult.group',
		'roads: roadsResult.group',
		'vegetation: vegetationResult.group',
	]) assert(sceneManagerSource.includes(token), `sceneManager live ownership token missing: ${token}`);
	assert(chunkManagerSource.includes('streamTowards(centerChunkX, centerChunkZ, radius)'), 'chunkManager streamTowards missing');
	assert(inputSource.includes('this._keys = new Set()'), 'KeyboardInput held-key state contract missing');
	assert(inputSource.includes('this._jumpRequested = false'), 'KeyboardInput jump-edge state contract missing');
	for (const token of ['let heightAboveGround = 0', 'let velocityY = 0', 'let isGrounded = true']) {
		assert(playerSource.includes(token), `player hidden physics state missing: ${token}`);
	}
	assert(run195Source.includes('currentGroundCollider'), 'Run195 current collider boundary missing');
	assert(!run195Source.includes('pauseStreaming'), 'Run195 unexpectedly owns streaming already');
	assert(!run195Source.includes('snapshotPhysicsState'), 'Run195 unexpectedly owns player physics already');

	const scene = { children: [] };
	const attach = (name) => {
		const root = { name, parent: scene };
		scene.children.push(root);
		return root;
	};
	const terrainA = attach('terrain-a');
	const terrainB = attach('terrain-b');
	const sceneState = {
		scene,
		chunkManager: { loaded: new Map([['0,0', terrainA], ['1,0', terrainB]]) },
		groundCollider: { getGroundHeight() { return 0; } },
		sky: attach('sky'),
		stars: attach('stars'),
		water: attach('water'),
		river: attach('river'),
		waterfalls: [attach('waterfall-0'), attach('waterfall-1')],
		settlements: attach('settlements'),
		roads: attach('roads'),
		vegetation: attach('vegetation'),
	};
	const inventory = buildCanonicalRuntimeOwnershipInventoryShadow(sceneState);
	assert(inventory.rootCount === 11, `unexpected inventory root count ${inventory.rootCount}`);
	assert(inventory.counts['terrain-chunk'] === 2, 'terrain chunk inventory mismatch');
	assert(inventory.counts.waterfalls === 2, 'waterfall inventory mismatch');
	assert(inventory.groundCollider === sceneState.groundCollider, 'ground collider identity drifted');

	const runtimeSurface = inspectCanonicalRuntimeRestoreSurfaceShadow({
		chunkManager: { streamTowards() {} },
		keyboardInput: { _keys: new Set(), _jumpRequested: false },
		player: { object3D: {} },
	});
	const expectedBlockers = [
		'streaming-pause-resume',
		'input-snapshot-restore',
		'player-physics-snapshot-restore',
	];
	assert(runtimeSurface.migrationReady === false, 'canonical runtime migration must remain blocked');
	assert(JSON.stringify(runtimeSurface.blockers) === JSON.stringify(expectedBlockers),
		`unexpected blocker set ${JSON.stringify(runtimeSurface.blockers)}`);

	// Source-level evidence prevents the mock from drifting away from the real current runtime.
	assert(!chunkManagerSource.includes('pauseStreaming('), 'chunkManager acquired pauseStreaming; update Run196 preflight');
	assert(!chunkManagerSource.includes('resumeStreaming('), 'chunkManager acquired resumeStreaming; update Run196 preflight');
	assert(!inputSource.includes('snapshotState('), 'KeyboardInput acquired snapshotState; update Run196 preflight');
	assert(!inputSource.includes('restoreState('), 'KeyboardInput acquired restoreState; update Run196 preflight');
	assert(!playerSource.includes('snapshotPhysicsState('), 'player acquired snapshotPhysicsState; update Run196 preflight');
	assert(!playerSource.includes('restorePhysicsState('), 'player acquired restorePhysicsState; update Run196 preflight');

	const deterministicReport = JSON.stringify({
		policy: inventory.policy,
		rootKinds: Object.keys(inventory.counts).sort().map((key) => [key, inventory.counts[key]]),
		blockers: runtimeSurface.blockers,
		migrationReady: runtimeSurface.migrationReady,
	});
	const checksum = sha256(deterministicReport);
	console.log(`[checkCanonicalRuntimeMigrationReadiness] INVENTORY: roots=${inventory.rootCount} terrain=${inventory.counts['terrain-chunk']} waterfalls=${inventory.counts.waterfalls}`);
	console.log(`[checkCanonicalRuntimeMigrationReadiness] PASS: migrationReady=false blockers=${runtimeSurface.blockers.join(',')} checksum=${checksum}`);
}

main().catch((error) => {
	console.error(`[checkCanonicalRuntimeMigrationReadiness] FAIL: ${error.stack || error}`);
	process.exitCode = 1;
});
