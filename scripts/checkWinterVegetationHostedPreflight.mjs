#!/usr/bin/env node
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
	WINTER_VEGETATION_ASSET_POLICY,
	probeHostedWinterAsset,
	upgradeWinterVegetationAssets,
} from '../src/3d/world/winterVegetationAsset.js';

function headers(values = {}) {
	const normalized = new Map(Object.entries(values).map(([key, value]) => [key.toLowerCase(), String(value)]));
	return { get(name) { return normalized.get(String(name).toLowerCase()) ?? null; } };
}

function response({ status = 200, contentLength, contentType = 'model/gltf-binary' } = {}) {
	return {
		status,
		ok: status >= 200 && status < 300,
		headers: headers({
			...(contentLength == null ? {} : { 'content-length': contentLength }),
			...(contentType == null ? {} : { 'content-type': contentType }),
		}),
	};
}

async function probeWith(fakeResponse, options = {}) {
	const calls = [];
	const result = await probeHostedWinterAsset('/tree.glb', {
		...options,
		fetchImpl: async (url, init) => {
			calls.push({ url, init });
			if (fakeResponse instanceof Error) throw fakeResponse;
			return fakeResponse;
		},
	});
	return { result, calls };
}

{
	const { result, calls } = await probeWith(response({ contentLength: 132, contentType: 'application/octet-stream' }));
	assert.equal(result.shouldLoad, false);
	assert.equal(result.status, 'rejected');
	assert.equal(result.reason, 'pointer-sized-response');
	assert.equal(result.contentLength, 132);
	assert.equal(calls.length, 1);
	assert.equal(calls[0].init.method, 'HEAD');
	assert.equal(calls[0].init.cache, WINTER_VEGETATION_ASSET_POLICY.hostedPreflightCache);
}

{
	const { result } = await probeWith(response({ contentLength: 1_400_000, contentType: 'model/gltf-binary' }));
	assert.equal(result.shouldLoad, true);
	assert.equal(result.status, 'accepted');
	assert.equal(result.reason, 'hosted-binary-candidate');
}

{
	const { result } = await probeWith(response({ contentLength: null, contentType: 'text/plain; charset=utf-8' }));
	assert.equal(result.shouldLoad, false);
	assert.equal(result.reason, 'text-response');
}

{
	const { result } = await probeWith(response({ status: 404, contentLength: 0 }));
	assert.equal(result.shouldLoad, false);
	assert.equal(result.reason, 'http-error');
	assert.equal(result.statusCode, 404);
}

{
	const { result } = await probeWith(response({ status: 405, contentLength: 0 }));
	assert.equal(result.shouldLoad, true, 'unsupported HEAD must fail open to the validated AssetLoader path');
	assert.equal(result.status, 'unknown');
	assert.equal(result.reason, 'head-unsupported');
}

{
	const { result } = await probeWith(new Error('offline'));
	assert.equal(result.shouldLoad, true, 'network/preflight failure must not remove the proven loader fallback');
	assert.equal(result.status, 'unknown');
	assert.equal(result.reason, 'head-failed');
}

{
	const controller = new AbortController();
	controller.abort();
	const result = await probeHostedWinterAsset('/tree.glb', {
		signal: controller.signal,
		fetchImpl: async () => { throw new DOMException('aborted', 'AbortError'); },
	});
	assert.equal(result.shouldLoad, false);
	assert.equal(result.status, 'cancelled');
	assert.equal(result.reason, 'abort-signal');
}

function makeProceduralGroup(count = 2) {
	const group = new THREE.Group();
	const trunk = new THREE.InstancedMesh(
		new THREE.CylinderGeometry(0.2, 0.35, 3.2, 6),
		new THREE.MeshStandardMaterial({ color: 0x4f443b }),
		count,
	);
	const foliage = new THREE.InstancedMesh(
		new THREE.ConeGeometry(2.2, 5.9, 7),
		new THREE.MeshStandardMaterial({ color: 0xdbe5e4 }),
		count,
	);
	trunk.name = WINTER_VEGETATION_ASSET_POLICY.proceduralTrunkName;
	foliage.name = WINTER_VEGETATION_ASSET_POLICY.proceduralFoliageName;
	for (let i = 0; i < count; i += 1) {
		const matrix = new THREE.Matrix4().makeTranslation(i * 12, 4, i * -7);
		trunk.setMatrixAt(i, matrix);
		foliage.setMatrixAt(i, matrix);
	}
	trunk.count = count;
	foliage.count = count;
	group.add(trunk, foliage);
	return group;
}

function makeValidWinterModel() {
	const root = new THREE.Group();
	const trunk = new THREE.Mesh(new THREE.BoxGeometry(0.8, 3.2, 0.8), new THREE.MeshStandardMaterial());
	trunk.position.y = 1.6;
	const crown = new THREE.Mesh(new THREE.ConeGeometry(2, 5.5, 7), new THREE.MeshStandardMaterial());
	crown.position.y = 5.25;
	root.add(trunk, crown);
	root.updateMatrixWorld(true);
	return root;
}

{
	const group = makeProceduralGroup();
	const loadCalls = [];
	const probeCalls = [];
	const status = await upgradeWinterVegetationAssets(group, {
		candidates: ['pointer.glb', 'real.glb'],
		assetProbe: async (url) => {
			probeCalls.push(url);
			return url === 'pointer.glb'
				? { status: 'rejected', shouldLoad: false, reason: 'pointer-sized-response', contentLength: 132 }
				: { status: 'accepted', shouldLoad: true, reason: 'hosted-binary-candidate', contentLength: 900_000 };
		},
		assetLoader: {
			async loadModel(url) {
				loadCalls.push(url);
				return makeValidWinterModel();
			},
		},
	});
	assert.equal(status.status, 'active');
	assert.equal(status.assetUrl, 'real.glb');
	assert.deepEqual(probeCalls, ['pointer.glb', 'real.glb']);
	assert.deepEqual(loadCalls, ['real.glb'], 'hosted pointer must never reach GLTFLoader/AssetLoader');
	assert.equal(status.rejected[0].reason, 'preflight-pointer-sized-response');
	assert.equal(status.rejected[0].contentLength, 132);
}

{
	const group = makeProceduralGroup(1);
	let loadCalls = 0;
	const status = await upgradeWinterVegetationAssets(group, {
		candidates: ['missing.glb', 'pointer.glb'],
		assetProbe: async (url) => url === 'missing.glb'
			? { status: 'rejected', shouldLoad: false, reason: 'http-error', statusCode: 404 }
			: { status: 'rejected', shouldLoad: false, reason: 'pointer-sized-response', contentLength: 128 },
		assetLoader: { async loadModel() { loadCalls += 1; return makeValidWinterModel(); } },
	});
	assert.equal(status.status, 'procedural-fallback');
	assert.equal(loadCalls, 0, 'all preflight-rejected assets must leave the procedural tree visible without loader work');
	assert.equal(group.children[0].visible, true);
	assert.equal(group.children[1].visible, true);
}

console.log('[checkWinterVegetationHostedPreflight] PASS', JSON.stringify({
	policy: WINTER_VEGETATION_ASSET_POLICY.id,
	minHostedBytes: WINTER_VEGETATION_ASSET_POLICY.hostedPreflightMinBytes,
}));
