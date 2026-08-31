#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
	FIREBASE_DEPLOY_LFS_POLICY,
	assertMaterializedDeployState,
	classifyCelestialBuffer,
	classifyLfsBuffer,
	parseLfsTrackedPaths,
} from './firebaseDeployLfsReadiness.mjs';

function makeGlb(bytes = 640, { version = 2, declaredLength = bytes } = {}) {
	const buffer = Buffer.alloc(bytes);
	buffer.write('glTF', 0, 'ascii');
	buffer.writeUInt32LE(version, 4);
	buffer.writeUInt32LE(declaredLength, 8);
	return buffer;
}

function makeBinaryFbx(bytes = 2048) {
	const buffer = Buffer.alloc(bytes);
	Buffer.from('Kaydara FBX Binary  \x00\x1a\x00', 'binary').copy(buffer, 0);
	return buffer;
}

const pointer = Buffer.from([
	'version https://git-lfs.github.com/spec/v1',
	'oid sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
	'size 2008660',
	'',
].join('\n'));
const pointerState = classifyLfsBuffer(pointer);
assert.equal(pointerState.kind, 'lfs-pointer');
assert.equal(pointerState.declaredSize, 2008660);
assert.match(pointerState.oid, /^[0-9a-f]{64}$/);
assert.throws(
	() => assertMaterializedDeployState('winter.glb', pointerState, { winter: true }),
	/still a Git-LFS pointer/,
	'Firebase deployment must fail closed while a tracked file is still a pointer',
);
assert.throws(
	() => assertMaterializedDeployState('moon.fbx', classifyCelestialBuffer(pointer), { celestial: true }),
	/still a Git-LFS pointer/,
	'celestial hydration must reject the repository pointer state before browser QA',
);

const goodGlb = classifyLfsBuffer(makeGlb());
assert.equal(goodGlb.kind, 'glb');
assert.doesNotThrow(() => assertMaterializedDeployState('winter.glb', goodGlb, { winter: true }));

const oldGlb = classifyLfsBuffer(makeGlb(640, { version: 1 }));
assert.throws(
	() => assertMaterializedDeployState('winter.glb', oldGlb, { winter: true }),
	/glTF binary version 2/,
);

const truncatedGlb = classifyLfsBuffer(makeGlb(640, { declaredLength: 900 }));
assert.throws(
	() => assertMaterializedDeployState('winter.glb', truncatedGlb, { winter: true }),
	/header length must equal/,
);

const tooSmallGlb = classifyLfsBuffer(makeGlb(128));
assert.throws(
	() => assertMaterializedDeployState('winter.glb', tooSmallGlb, { winter: true }),
	/pointer-rejection threshold/,
);

const ordinaryBinary = classifyLfsBuffer(Buffer.from([0x46, 0x42, 0x58, 0x00, 0x01]));
assert.equal(ordinaryBinary.kind, 'materialized');
assert.doesNotThrow(() => assertMaterializedDeployState('asset.fbx', ordinaryBinary));

const goodFbx = classifyCelestialBuffer(makeBinaryFbx());
assert.equal(goodFbx.kind, 'fbx-binary');
assert.doesNotThrow(() => assertMaterializedDeployState('moon.fbx', goodFbx, { celestial: true }));

const asciiFbx = classifyCelestialBuffer(Buffer.from(`; FBX 7.4.0 project file\n${'x'.repeat(2048)}`));
assert.equal(asciiFbx.kind, 'fbx-ascii');
assert.doesNotThrow(() => assertMaterializedDeployState('moon.fbx', asciiFbx, { celestial: true }));

const invalidFbx = classifyCelestialBuffer(Buffer.alloc(2048, 7));
assert.equal(invalidFbx.kind, 'invalid-fbx');
assert.throws(
	() => assertMaterializedDeployState('moon.fbx', invalidFbx, { celestial: true }),
	/must materialize as a valid FBX/,
);

const tinyFbx = classifyCelestialBuffer(makeBinaryFbx(128));
assert.throws(
	() => assertMaterializedDeployState('moon.fbx', tinyFbx, { celestial: true }),
	/pointer-rejection threshold/,
);

const tracked = parseLfsTrackedPaths([
	'assets/models/vegetation/pine_Zt62gceKXZ.glb',
	'assets/models/vegetation/winter_tree.glb',
	'assets/models/vegetation/dead_trees_with_snow_iEuwXWner0.glb',
	'',
].join('\n'));
assert.deepEqual([...tracked], [...FIREBASE_DEPLOY_LFS_POLICY.winterAssets]);
assert.equal(new Set(FIREBASE_DEPLOY_LFS_POLICY.winterAssets).size, FIREBASE_DEPLOY_LFS_POLICY.winterAssets.length,
	'winter deployment candidates must remain unique');
assert.equal(FIREBASE_DEPLOY_LFS_POLICY.winterAssets[0], 'assets/models/vegetation/pine_Zt62gceKXZ.glb',
	'Firebase winter hydration must include the preferred textured pine before visual/runtime QA');
assert.deepEqual([...FIREBASE_DEPLOY_LFS_POLICY.celestialAssets], ['assets/models/Ay/Moon 2K.fbx'],
	'celestial hydration must target the exact Moon asset referenced by runtime lighting');
assert(FIREBASE_DEPLOY_LFS_POLICY.minimumCelestialFbxBytes >= 1024,
	'celestial deployment validation must reject tiny pointer/error payloads');

const firebase = JSON.parse(await readFile(new URL('../firebase.json', import.meta.url), 'utf8'));
const predeploy = Array.isArray(firebase.hosting?.predeploy)
	? firebase.hosting.predeploy
	: [firebase.hosting?.predeploy].filter(Boolean);
assert(predeploy.includes('node scripts/firebaseDeployLfsReadiness.mjs --scope=all'),
	'Firebase Hosting must fail-fast through the all-LFS readiness check before every direct deploy');

console.log('[checkFirebaseDeployLfsReadiness] PASS', JSON.stringify({
	policy: FIREBASE_DEPLOY_LFS_POLICY.id,
	winterAssets: FIREBASE_DEPLOY_LFS_POLICY.winterAssets.length,
	celestialAssets: FIREBASE_DEPLOY_LFS_POLICY.celestialAssets.length,
	minimumWinterGlbBytes: FIREBASE_DEPLOY_LFS_POLICY.minimumWinterGlbBytes,
	minimumCelestialFbxBytes: FIREBASE_DEPLOY_LFS_POLICY.minimumCelestialFbxBytes,
	predeployGuarded: true,
}));