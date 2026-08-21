#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
	FIREBASE_DEPLOY_LFS_POLICY,
	assertMaterializedDeployState,
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

const tracked = parseLfsTrackedPaths([
	'assets/models/vegetation/winter_tree.glb',
	'assets/models/vegetation/dead_trees_with_snow_iEuwXWner0.glb',
	'',
].join('\n'));
assert.deepEqual([...tracked], [...FIREBASE_DEPLOY_LFS_POLICY.winterAssets]);
assert.equal(new Set(FIREBASE_DEPLOY_LFS_POLICY.winterAssets).size, FIREBASE_DEPLOY_LFS_POLICY.winterAssets.length,
	'winter deployment candidates must remain unique');

const firebase = JSON.parse(await readFile(new URL('../firebase.json', import.meta.url), 'utf8'));
const predeploy = Array.isArray(firebase.hosting?.predeploy)
	? firebase.hosting.predeploy
	: [firebase.hosting?.predeploy].filter(Boolean);
assert(predeploy.includes('node scripts/firebaseDeployLfsReadiness.mjs --scope=all'),
	'Firebase Hosting must fail-fast through the all-LFS readiness check before every direct deploy');

console.log('[checkFirebaseDeployLfsReadiness] PASS', JSON.stringify({
	policy: FIREBASE_DEPLOY_LFS_POLICY.id,
	winterAssets: FIREBASE_DEPLOY_LFS_POLICY.winterAssets.length,
	minimumWinterGlbBytes: FIREBASE_DEPLOY_LFS_POLICY.minimumWinterGlbBytes,
	predeployGuarded: true,
}));
