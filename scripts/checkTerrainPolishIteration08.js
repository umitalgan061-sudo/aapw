#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const visual = fs.readFileSync(path.join(root, 'src/3d/world/worldReferenceSurfaceTerrainVisual.js'), 'utf8');
const sceneManager = fs.readFileSync(path.join(root, 'src/3d/sceneManager.js'), 'utf8');
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
  "import { installRuntimePindexTerrainPolish } from './world/worldReferenceSurfaceTerrainVisual.js';",
  'const canonicalMapSurface = installRuntimePindexTerrainPolish();',
  "if (!canonicalMapSurface?.installed) throw new Error('[sceneManager] canonical map surface installation failed');",
]) {
  if (!sceneManager.includes(token)) throw new Error(`Iteration #08 scene activation missing: ${token}`);
}
if (!game3d.includes('initGame3D();')) throw new Error('Iteration #08 shipped game entry no longer initializes 3D');

const polishStart = visual.indexOf('// Terrain Polish Iteration #08');
if (polishStart < 0) throw new Error('Iteration #08 additive section missing');
const polishSection = visual.slice(polishStart);
if (polishSection.includes('position.setY(')) throw new Error('Iteration #08 must not mutate terrain height/physics geometry');
if (polishSection.includes('Math.random(')) throw new Error('Iteration #08 runtime polish must remain deterministic');
const installIndex = sceneManager.indexOf('const canonicalMapSurface = installRuntimePindexTerrainPolish();');
const chunkLoadIndex = sceneManager.indexOf('chunkManager.loadSquare(');
if (installIndex < 0 || chunkLoadIndex < 0 || installIndex > chunkLoadIndex) {
  throw new Error('Iteration #08 installer must run before the first scene terrain chunk load');
}

console.log('[checkTerrainPolishIteration08] PASS: createScene deliberately enables deterministic Pindex-01..09 terrain color polish before terrain loading without height mutation');
