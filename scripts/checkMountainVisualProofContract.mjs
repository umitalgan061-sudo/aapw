#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const proofPath = path.join(ROOT, 'scripts/captureLiveWorldMountainNaturalization.mjs');
const source = fs.readFileSync(proofPath, 'utf8');

const need = (needle, message) => assert(source.includes(needle), message);
const reject = (pattern, message) => assert(!pattern.test(source), message);

need('const WIDTH = 1536;', 'mountain proof width must stay 1536');
need('const HEIGHT = 1024;', 'mountain proof height must stay 1024');
need('sceneModule.createScene(runtimeCanvas)', 'proof must boot the shipped createScene stack');
need("import('/src/3d/world/water.js')", 'proof must use shipped water runtime');
need("import('/src/3d/sky.js')", 'proof must use shipped sky runtime');
need('skyModule.updateAuroraSky(state.sky, camera.position, elapsed, daylight)', 'proof must update the camera-relative shipped sky');
need('waterModule.updateWater(state.water, camera.position, elapsed)', 'proof must update shipped camera-relative water');
need('new THREE.OrthographicCamera', 'proof must include a 90-degree full-world audit camera');
need('new THREE.PerspectiveCamera', 'proof must include near-oblique mountain/pass cameras');
need("'proof-topdown'", 'full-world topdown proof canvas missing');
need("'proof-mountain'", 'highest-relief proof canvas missing');
need("'proof-pass'", 'authored-pass proof canvas missing');
need("'real-full-world-topdown.png'", 'full-world artifact filename missing');
need("'real-highest-relief-oblique.png'", 'highest-relief artifact filename missing');
need("'real-authored-pass-oblique.png'", 'authored-pass artifact filename missing');
need('state.chunkManager.loadChunk(x, z)', 'proof must load real shipped terrain chunks');
need('terrainMeshCount >= 550', 'proof must reject partial-world terrain');
need('terrainVertexCount > 2_000_000', 'proof must reject low-detail/partial terrain');
need('renderTriangles > 1_000_000', 'proof must require a substantive shipped render');
need("WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY.chains['vale-chain']", 'proof must anchor pass view to canonical relief policy');
need('frame.peak.h > 500', 'proof must verify the live scene still contains major relief');
need('stats.pixel.lumaStdDev > 0.012', 'proof must reject tonally flat images');
need('stats.pixel.edgeEnergy > 0.003', 'proof must reject structureless images');
need('stats.pixel.darkRatio < 0.92', 'proof must reject mostly-black images');
need("consoleErrors.length === 0 && pageErrors.length === 0 && requestFailures.length === 0", 'proof must fail on browser/runtime/request errors');
need('auditFog: true', 'full-world orthographic audit must explicitly scope its fog bypass');
need('const savedFog = state.scene.fog;', 'proof must preserve shipped fog state');
need('state.scene.fog = savedFog;', 'proof must restore shipped fog immediately after audit render');

reject(/state\.water\.scale\s*\./, 'proof must never enlarge or shrink shipped water to manufacture coverage');
reject(/state\.sky\.visible\s*=\s*false/, 'proof must never hide shipped sky for oblique visual evidence');
reject(/state\.stars\.visible\s*=\s*false/, 'proof must never hide shipped stars for oblique visual evidence');
reject(/state\.water\.material\s*=/, 'proof must never replace shipped water material');
reject(/state\.scene\.background\s*=/, 'proof must not replace the shipped background stack');
reject(/new\s+THREE\.PlaneGeometry/, 'proof must not invent a replacement terrain/water plane');
reject(/new\s+THREE\.MeshStandardMaterial/, 'proof must not invent a replacement terrain material');

const screenshots = [...source.matchAll(/'real-[^']+\.png'/g)].map((match) => match[0]);
assert.equal(new Set(screenshots).size, 3, `expected exactly three deterministic mountain proof images, found ${new Set(screenshots).size}`);
const cameraKinds = [...source.matchAll(/new THREE\.(OrthographicCamera|PerspectiveCamera)/g)].map((match) => match[1]);
assert(cameraKinds.includes('OrthographicCamera') && cameraKinds.includes('PerspectiveCamera'), 'proof camera matrix lost full-world or oblique coverage');

console.log('MOUNTAIN_VISUAL_PROOF_CONTRACT_OK', JSON.stringify({
	viewport: [1536, 1024],
	artifacts: [...new Set(screenshots)].map((name) => name.slice(1, -1)),
	cameraKinds: [...new Set(cameraKinds)],
	shippedScene: true,
	waterRescale: false,
	skyHidden: false,
	fogAuditOnly: true,
}));
