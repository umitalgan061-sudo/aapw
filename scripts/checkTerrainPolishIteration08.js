#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const visual = fs.readFileSync(path.join(root, 'src/3d/world/worldReferenceSurfaceTerrainVisual.js'), 'utf8');
// Pre-existing drift, found 2026-08-19: this guard read game3d.html, but Iteration #08's activation
// moved into sceneManager.createScene at some point and the guard was never updated — so it had been
// failing on its own terms, independently of any change. The activation is asserted where it actually
// lives; the contract it encodes (the polish is installed by the shipped game, not only by tests) is
// unchanged.
const sceneManager = fs.readFileSync(path.join(root, 'src/3d/sceneManager.js'), 'utf8');

const requiredVisualTokens = [
  "id: 'terrain-polish-iteration-008-visible-pindex-runtime-2026-08-12-v1'",
  'export function applyRuntimePindexTerrainPolishToMesh(mesh)',
  'export function installRuntimePindexTerrainPolish()',
  'semanticBlendBySurface',
  'wetLowHeightBoost',
  'detailTouchedVertices',
  'activePindexes',
  'applyPindex01DetailToTerrainMesh',
  'applyPindex02DetailToTerrainMesh',
  'applyPindex03DetailToTerrainMesh',
  'applyPindex04DetailToTerrainMesh',
  'applyPindex05DetailToTerrainMesh',
  'applyPindex06DetailToTerrainMesh',
  'applyPindex07DetailToTerrainMesh',
  'applyPindex08DetailToTerrainMesh',
  'applyPindex09DetailToTerrainMesh',
  "Symbol.for('westeros.runtime-pindex-terrain-polish.iteration-008')",
];
for (const token of requiredVisualTokens) {
  if (!visual.includes(token)) throw new Error(`Iteration #08 runtime visual contract missing: ${token}`);
}

for (const token of [
  "import { installRuntimePindexTerrainPolish } from './world/worldReferenceSurfaceTerrainVisual.js';",
  'installRuntimePindexTerrainPolish()',
]) {
  if (!sceneManager.includes(token)) throw new Error(`Iteration #08 shipped-game activation missing: ${token}`);
}

const polishStart = visual.indexOf('// Terrain Polish Iteration #08');
if (polishStart < 0) throw new Error('Iteration #08 additive section missing');
const polishSection = visual.slice(polishStart);
if (polishSection.includes('position.setY(')) throw new Error('Iteration #08 must not mutate terrain height/physics geometry');
if (polishSection.includes('Math.random(')) throw new Error('Iteration #08 runtime polish must remain deterministic');
// The installer monkey-patches ChunkManager.prototype.loadChunk, so it has to run before any chunk
// manager exists — otherwise the first chunks stream in unpolished. This is the ordering the original
// game3d.html assertion was protecting, expressed against the real call site.
if (sceneManager.indexOf('installRuntimePindexTerrainPolish()') > sceneManager.indexOf('new ChunkManager(')) {
  throw new Error('Iteration #08 installer must run before any ChunkManager is constructed');
}

console.log('[checkTerrainPolishIteration08] PASS: shipped game deliberately enables deterministic Pindex-01..09 terrain color polish without height mutation');
