#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const PROOF_DIR = path.resolve('godot/terrain-authoring/.terrain3d-proof');
const VISUAL_DIR = path.resolve('artifacts/nw-g10-relief-visual');
const OUT = path.resolve('artifacts/nw-g10-relief-evidence-manifest.json');
const MAP_SHA = '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1';

function need(ok, message) {
  if (!ok) throw new Error(`[checkNWG10ReliefEvidenceManifest] ${message}`);
}
function digest(file) {
  need(fs.existsSync(file), `missing evidence ${file}`);
  const bytes = fs.readFileSync(file);
  need(bytes.length > 0, `empty evidence ${file}`);
  return { bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
}

const probePath = path.join(PROOF_DIR, 'g10-relief-probe.json');
const densePath = path.join(PROOF_DIR, 'g10-relief-dense.json');
const importedPath = path.join(PROOF_DIR, 'g10-relief-imported-topdown.png');
const visualMetricsPath = path.join(VISUAL_DIR, 'metrics.json');
const probe = JSON.parse(fs.readFileSync(probePath, 'utf8'));
const dense = JSON.parse(fs.readFileSync(densePath, 'utf8'));
const visual = JSON.parse(fs.readFileSync(visualMetricsPath, 'utf8'));

need(probe.sourceMapSha256 === MAP_SHA && dense.sourceMapSha256 === MAP_SHA, 'source map provenance drift');
need(probe.policyId === dense.policyId, 'source/dense policy mismatch');
need(probe.geoCell === 'G10' && probe.layer === 'Relief/Height Character', 'wrong GeoCell/layer evidence');
need(probe.canonicalWaterCells === 60 && probe.canonicalLandCells === 36 && probe.canonicalSignMismatches === 0, 'canonical G10 hydrology/sign drift');
need(dense.denseSamples === 66049 && dense.denseGridSize === 257, 'dense proof contract drift');
need(dense.gridImprintRatio < 3, `grid imprint ratio failed: ${dense.gridImprintRatio}`);
need(visual.sourceMapSha256 === MAP_SHA, 'visual map provenance drift');
need(visual.sourceWidth === 1536 && visual.sourceHeight === 1024, 'visual canonical dimensions drift');
need(visual.visibleGeoCellOverlay === false, 'visible GeoCell overlay is forbidden');
need(visual.nearSha !== visual.farSha && visual.nearSha !== visual.topSha && visual.farSha !== visual.topSha, 'visual frames are not distinct');

const manifest = {
  schema: 'westeros-nw-g10-terrain3d-relief-evidence-v2',
  geoCell: 'G10',
  layer: 'Relief/Height Character',
  sourceMapSha256: MAP_SHA,
  policyId: probe.policyId,
  canonicalOwnership: { water: 60, land: 36, signMismatches: 0 },
  relief: {
    minHeight: probe.minHeight,
    maxHeight: probe.maxHeight,
    maxSlopeDegrees: probe.maxSlopeDegrees,
    maxGuardHeightDelta: probe.maxGuardHeightDelta,
    maxGuardNormalDelta: probe.maxGuardNormalDelta,
    checksum: probe.reliefChecksum,
  },
  denseContinuity: {
    samples: dense.denseSamples,
    maxNeighborHeightDelta: dense.maxDenseNeighborHeightDelta,
    maxNeighborNormalDelta: dense.maxDenseNeighborNormalDelta,
    maxSecondDifference: dense.maxSecondDifference,
    gridImprintRatio: dense.gridImprintRatio,
    checksum: dense.denseChecksum,
  },
  files: {
    probe: digest(probePath),
    dense: digest(densePath),
    terrain3dImportedTopDown: digest(importedPath),
    near: digest(path.join(VISUAL_DIR, 'g10-relief-near.png')),
    far: digest(path.join(VISUAL_DIR, 'g10-relief-far.png')),
    fullWorldTopDown: digest(path.join(VISUAL_DIR, 'g10-relief-full-world-topdown.png')),
  },
  visibleGeoCellOverlay: false,
  note: 'GeoCell/Pindex/source grids are addressing and QA only; evidence binds continuous owner-map relief, real Terrain3D import/bake, and Three.js views on one exact head.',
};
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`NW_G10_RELIEF_EVIDENCE=${JSON.stringify({ gridImprintRatio: dense.gridImprintRatio, reliefChecksum: probe.reliefChecksum, denseChecksum: dense.denseChecksum })}`);
console.log('NW_G10_RELIEF_EVIDENCE_MANIFEST_OK');
