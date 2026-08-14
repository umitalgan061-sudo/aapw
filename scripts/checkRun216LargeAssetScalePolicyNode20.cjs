#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

async function loadPolicy() {
  const sourcePath = path.resolve(__dirname, '../src/3d/editor/EditorAssetScalePolicy.js');
  const source = fs.readFileSync(sourcePath, 'utf8');
  const url = `data:text/javascript;base64,${Buffer.from(source, 'utf8').toString('base64')}`;
  return import(url);
}

async function main() {
  const { computeEditorAssetImportScale, EDITOR_ASSET_SCALE_POLICY } = await loadPolicy();
  const cases = Object.freeze([
    { id: 'black-dragon', maxDimension: 160, target: 8, scale: 0.05 },
    { id: 'paladin', maxDimension: 200, target: 2, scale: 0.01 },
    { id: 'peasant-girl', maxDimension: 180, target: 1.8, scale: 0.01 }
  ]);

  for (const entry of cases) {
    const actual = computeEditorAssetImportScale({ id: entry.id, format: 'glb' }, entry.maxDimension);
    if (Math.abs(actual - entry.scale) > 1e-12) {
      throw new Error(`${entry.id} scale mismatch: expected ${entry.scale}, got ${actual}`);
    }
    if (EDITOR_ASSET_SCALE_POLICY.targetMaxDimensionByAsset[entry.id] !== entry.target) {
      throw new Error(`${entry.id} target dimension mismatch`);
    }
  }

  const explicit = computeEditorAssetImportScale({ id: 'custom', format: 'fbx', targetMaxDimension: 1.5 }, 150);
  if (Math.abs(explicit - 0.01) > 1e-12) throw new Error(`explicit target scale mismatch: ${explicit}`);
  if (computeEditorAssetImportScale({ id: 'black-dragon', format: 'glb' }, 20) !== 1) {
    throw new Error('reasonable-size imports must remain untouched');
  }

  console.log('PASS Run216 Node20 large asset policy: black dragon and human assets normalize deterministically.');
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
