#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const visual = fs.readFileSync(path.join(root, 'src/3d/world/worldReferenceSurfaceTerrainVisual.js'), 'utf8');
const game3d = fs.readFileSync(path.join(root, 'game3d.html'), 'utf8');

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
  "import { installRuntimePindexTerrainPolish } from './src/3d/world/worldReferenceSurfaceTerrainVisual.js';",
  'installRuntimePindexTerrainPolish();',
  'initGame3D();',
]) {
  if (!game3d.includes(token)) throw new Error(`Iteration #08 shipped-game activation missing: ${token}`);
}

const polishStart = visual.indexOf('// Terrain Polish Iteration #08');
if (polishStart < 0) throw new Error('Iteration #08 additive section missing');
const polishSection = visual.slice(polishStart);
if (polishSection.includes('position.setY(')) throw new Error('Iteration #08 must not mutate terrain height/physics geometry');
if (polishSection.includes('Math.random(')) throw new Error('Iteration #08 runtime polish must remain deterministic');
if (game3d.indexOf('installRuntimePindexTerrainPolish();') > game3d.indexOf('initGame3D();')) {
  throw new Error('Iteration #08 installer must run before shipped 3D initialization');
}

console.log('[checkTerrainPolishIteration08] PASS: shipped game deliberately enables deterministic Pindex-01..09 terrain color polish without height mutation');
