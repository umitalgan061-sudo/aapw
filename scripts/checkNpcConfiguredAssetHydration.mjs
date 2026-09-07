#!/usr/bin/env node
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const configPath = path.join(root, 'src/3d/gameplay/npcConfig.js');
const playerConfigPath = path.join(root, 'src/3d/gameplay/playerConfig.js');
const configSource = fs.readFileSync(configPath, 'utf8');
const playerConfigSource = fs.readFileSync(playerConfigPath, 'utf8');
const manifestSource = fs.readFileSync(path.join(root, 'assets_manifest.json'), 'utf8');

const configuredModels = [...new Set(
	[...configSource.matchAll(/modelUrl:\s*'([^']+\.fbx)'/g)].map((match) => match[1]),
)].sort();

function resolveNpcAnimationPath(npcKey, playerKey) {
	const npcReference = new RegExp(`${npcKey}:\\s*PLAYER_CONFIG\\.ANIMATION_URLS\\.${playerKey}\\b`);
	assert.match(configSource, npcReference, `${npcKey} must continue to reuse PLAYER_CONFIG.ANIMATION_URLS.${playerKey}`);
	const playerLiteral = new RegExp(`\\b${playerKey}:\\s*'([^']+\\.fbx)'`).exec(playerConfigSource);
	assert.ok(playerLiteral, `PLAYER_CONFIG.ANIMATION_URLS.${playerKey} must resolve to an FBX asset`);
	return playerLiteral[1];
}

const animationPaths = [...new Set([
	resolveNpcAnimationPath('IDLE_ANIMATION_URL', 'idle'),
	resolveNpcAnimationPath('WALK_ANIMATION_URL', 'walking'),
])].sort();

assert.equal(configuredModels.length, 6, `expected six configured character FBX files, got ${configuredModels.length}`);
assert.equal(animationPaths.length, 2, `expected idle + walking FBX animation files, got ${animationPaths.length}`);

function inspectHydratedFbx(relativePath, kind) {
	const absolutePath = path.join(root, relativePath);
	assert.ok(fs.existsSync(absolutePath), `${kind} file missing: ${relativePath}`);
	const bytes = fs.readFileSync(absolutePath);
	assert.ok(bytes.length >= 1024, `${kind} file is too small to be hydrated: ${relativePath} (${bytes.length} bytes)`);
	const prefix = bytes.subarray(0, Math.min(256, bytes.length)).toString('latin1');
	assert.ok(!prefix.includes('version https://git-lfs.github.com/spec/v1'), `${kind} remained a Git LFS pointer: ${relativePath}`);
	const looksLikeFbx = prefix.includes('Kaydara FBX Binary') || prefix.includes('FBX') || prefix.trimStart().startsWith(';');
	assert.equal(looksLikeFbx, true, `${kind} does not expose an FBX signature/header: ${relativePath}`);
	const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
	assert.match(sha256, /^[0-9a-f]{64}$/);
	assert.ok(manifestSource.includes(relativePath), `${kind} is not represented in assets_manifest.json: ${relativePath}`);
	return Object.freeze({ path: relativePath, bytes: bytes.length, sha256, binary: prefix.includes('Kaydara FBX Binary') });
}

const modelEvidence = configuredModels.map((modelPath) => inspectHydratedFbx(modelPath, 'character model'));
const animationEvidence = animationPaths.map((animationPath) => inspectHydratedFbx(animationPath, 'animation clip'));
const modelHashes = new Set(modelEvidence.map((entry) => entry.sha256));
assert.equal(modelHashes.size, modelEvidence.length, 'two configured character model paths hydrate to identical bytes unexpectedly');

for (const entry of modelEvidence) {
	assert.ok(entry.bytes > 100 * 1024, `configured character model is implausibly small after hydration: ${entry.path} (${entry.bytes} bytes)`);
}
for (const entry of animationEvidence) {
	assert.ok(entry.bytes > 20 * 1024, `configured animation clip is implausibly small after hydration: ${entry.path} (${entry.bytes} bytes)`);
}

console.log('NPC_CONFIGURED_ASSET_HYDRATION_PASS', JSON.stringify({
	models: modelEvidence,
	animations: animationEvidence,
	totalHydratedBytes: [...modelEvidence, ...animationEvidence].reduce((sum, entry) => sum + entry.bytes, 0),
}));