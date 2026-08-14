#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const EXPECTED_MAP_SHA = '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1';
const ROOT = process.cwd();
const VISUAL_ARG = process.argv.find((arg) => arg.startsWith('--visual-dir='));
const OUT_ARG = process.argv.find((arg) => arg.startsWith('--out='));
const visualDir = path.resolve(VISUAL_ARG ? VISUAL_ARG.slice('--visual-dir='.length) : 'artifacts/nw-g01-runtime-visual');
const outPath = path.resolve(OUT_ARG ? OUT_ARG.slice('--out='.length) : path.join(visualDir, 'g01-runtime-evidence-manifest.json'));
const bakePath = path.join(ROOT, 'godot/terrain-authoring/.terrain3d-proof/g01-runtime-bake.json');
const godotPreviewPath = path.join(ROOT, 'godot/terrain-authoring/.terrain3d-proof/g01-runtime-bake-topdown.png');

function fail(message) {
  console.error(`[checkNWG01RuntimeEvidenceManifest] FAIL: ${message}`);
  process.exit(1);
}

function requireCondition(condition, message) {
  if (!condition) fail(message);
}

function readJson(file) {
  requireCondition(fs.existsSync(file), `missing evidence file ${file}`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function digest(file, minimumBytes = 1) {
  requireCondition(fs.existsSync(file), `missing evidence file ${file}`);
  const bytes = fs.readFileSync(file);
  requireCondition(bytes.length >= minimumBytes, `evidence file too small ${file}: ${bytes.length}`);
  return Object.freeze({ bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') });
}

function requireSeamWithinLimits(continuity) {
  for (const [channel, limit] of Object.entries(continuity.internalSourceSeamLimits)) {
    const measured = continuity.internalSourceSeamMax[channel];
    requireCondition(Number.isFinite(measured), `missing internal seam metric ${channel}`);
    requireCondition(measured <= limit, `manifest observed ${channel} seam ${measured} above ${limit}`);
  }
}

const metricsPath = path.join(visualDir, 'metrics.json');
const continuityPath = path.join(visualDir, 'g01-runtime-surface-continuity.json');
const nearPath = path.join(visualDir, 'g01-runtime-near.png');
const farPath = path.join(visualDir, 'g01-runtime-far.png');
const fullPath = path.join(visualDir, 'g01-full-world-reference-topdown.png');
const metrics = readJson(metricsPath);
const continuity = readJson(continuityPath);
const bake = readJson(bakePath);
const images = {
  near: digest(nearPath, 1024),
  far: digest(farPath, 1024),
  fullWorldTopDown: digest(fullPath, 1024),
  terrain3dImportedTopDown: digest(godotPreviewPath, 1024),
};

requireCondition(bake.schema === 'westeros-g01-terrain3d-bake-v1', `unexpected bake schema ${bake.schema}`);
requireCondition(bake.sourceMapSha256 === EXPECTED_MAP_SHA, 'bake map.png provenance mismatch');
requireCondition(bake.regionCount >= 4 && bake.savedRegionFiles >= 4, 'manifest requires persisted multi-region Terrain3D bake');
requireCondition(bake.bakedVertices > 0, 'manifest requires non-empty Terrain3D LOD0 bake');
requireCondition(metrics.sourceMapSha256 === EXPECTED_MAP_SHA, 'visual metrics map.png provenance mismatch');
requireCondition(continuity.sourceMapSha256 === EXPECTED_MAP_SHA, 'surface continuity map.png provenance mismatch');
requireCondition(continuity.schema === 'westeros-g01-runtime-surface-continuity-v1', `unexpected continuity schema ${continuity.schema}`);
requireCondition(continuity.sourceSize === 65 && continuity.denseSize === 257, 'continuity evidence lost 65 -> 257 qualification density');
requireCondition(continuity.denseSampleCount === 66049, `unexpected dense sample count ${continuity.denseSampleCount}`);
requireCondition(continuity.worldParitySamples === 1089, `unexpected world parity sample count ${continuity.worldParitySamples}`);
requireCondition(continuity.sourceSeamPairs > 30000, `internal source seam coverage too small ${continuity.sourceSeamPairs}`);
requireCondition(continuity.gridNormalImprintRatio <= 5, `grid normal imprint ratio ${continuity.gridNormalImprintRatio}`);
requireCondition(typeof continuity.checksumSha256 === 'string' && continuity.checksumSha256.length === 64, 'continuity checksum missing');
requireSeamWithinLimits(continuity);

requireCondition(metrics.sourceWidth === 1536 && metrics.sourceHeight === 1024, 'full-world evidence lost canonical map dimensions');
requireCondition(Math.abs(metrics.sourceAspect - metrics.canvasAspect) <= 1e-12, 'full-world evidence distorted canonical aspect');
requireCondition(metrics.vertices === 4225 && metrics.triangles === 8192, 'Three.js G01 visual mesh density drifted');
requireCondition(metrics.maxWorldParityError <= 1e-7, `visual world parity error ${metrics.maxWorldParityError}`);
requireCondition(metrics.terrain3dRegionCount === bake.regionCount, 'visual/bake Terrain3D region count mismatch');
requireCondition(metrics.savedRegionFiles === bake.savedRegionFiles, 'visual/bake persisted region count mismatch');
requireCondition(metrics.bakedVertices === bake.bakedVertices, 'visual/bake LOD0 vertex count mismatch');
requireCondition(metrics.nearSha256 === images.near.sha256, 'near PNG digest drifted after render');
requireCondition(metrics.farSha256 === images.far.sha256, 'far PNG digest drifted after render');
requireCondition(metrics.topdownSha256 === images.fullWorldTopDown.sha256, 'full-world PNG digest drifted after render');
requireCondition(new Set([images.near.sha256, images.far.sha256, images.fullWorldTopDown.sha256]).size === 3, 'near/far/full-world evidence frames are not distinct');

const manifest = {
  schema: 'westeros-g01-terrain3d-runtime-evidence-v1',
  geoCell: 'G01',
  layer: 'Terrain3D Bake/Three.js runtime parity',
  sourceMapSha256: EXPECTED_MAP_SHA,
  terrain3d: {
    version: '1.0.2-stable',
    regionCount: bake.regionCount,
    savedRegionFiles: bake.savedRegionFiles,
    savedRegionBytes: bake.savedRegionBytes,
    bakedVertices: bake.bakedVertices,
  },
  runtime: {
    sourceSize: continuity.sourceSize,
    denseSize: continuity.denseSize,
    denseSampleCount: continuity.denseSampleCount,
    worldParitySamples: continuity.worldParitySamples,
    maxWorldParityError: metrics.maxWorldParityError,
    gridNormalImprintRatio: continuity.gridNormalImprintRatio,
    continuityChecksumSha256: continuity.checksumSha256,
  },
  visual: {
    sourceDimensions: [metrics.sourceWidth, metrics.sourceHeight],
    sourceAspect: metrics.sourceAspect,
    canvasAspect: metrics.canvasAspect,
    visibleGeoCellOverlay: false,
    images,
  },
  policies: {
    grids: 'GeoCell/Pindex/source/import grids are addressing and QA only and are not rendered as world geometry.',
    provenance: 'Manifest joins real persisted Terrain3D bake, dense physical surface continuity and Three.js near/far/full-world visual evidence from one exact head.',
  },
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`NW_G01_RUNTIME_EVIDENCE_MANIFEST=${JSON.stringify({
  denseSampleCount: manifest.runtime.denseSampleCount,
  gridNormalImprintRatio: manifest.runtime.gridNormalImprintRatio,
  continuityChecksumSha256: manifest.runtime.continuityChecksumSha256,
  fullWorldTopDownSha256: manifest.visual.images.fullWorldTopDown.sha256,
})}`);
console.log('NW_G01_RUNTIME_EVIDENCE_MANIFEST_OK');
