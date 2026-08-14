#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROOF = path.join(ROOT, 'godot/terrain-authoring/.terrain3d-proof');
const VISUAL = path.join(ROOT, 'artifacts/ne-g70-near-detail-visual');
const EXPECTED_SHA = '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1';
const requireOk = (ok, message) => { if (!ok) throw new Error(message); };
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
function readPng(file, width, height) {
  const bytes = fs.readFileSync(file);
  requireOk(bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])), `${file} is not PNG`);
  requireOk(bytes.readUInt32BE(16) === width && bytes.readUInt32BE(20) === height, `${file} dimensions changed`);
  return { bytes: bytes.length, sha256: sha256(bytes), width, height };
}

const probePath = path.join(PROOF, 'g70-near-detail-probe.json');
const importedPath = path.join(PROOF, 'g70-near-detail-imported-topdown.png');
const visualMetricsPath = path.join(VISUAL, 'g70-near-detail-visual-metrics.json');
for (const file of [probePath, importedPath, visualMetricsPath]) requireOk(fs.existsSync(file), `missing evidence ${file}`);
const probe = JSON.parse(fs.readFileSync(probePath, 'utf8'));
const visual = JSON.parse(fs.readFileSync(visualMetricsPath, 'utf8'));
requireOk(probe.sourceMapSha256 === EXPECTED_SHA && visual.sourceMapSha256 === EXPECTED_SHA, 'map.png provenance mismatch');
requireOk(probe.geoCell === 'G70' && probe.layer === 'Near Detail', 'unexpected probe cell/layer');
requireOk(probe.canonicalWaterCells === 96 && probe.canonicalLandCells === 0, 'G70 canonical sea fingerprint changed');
requireOk(probe.maxHeightDelta === 0 && probe.maxControlDelta === 0 && probe.maxRoadPathDelta === 0, 'evidence says prior layer changed');
requireOk(probe.maxFoliageDensity === 0, 'evidence says marine foliage was invented');
requireOk(visual.topdown?.g70PatchApplied === false && visual.topdown?.g70PatchAlpha === 0 && visual.topdown?.gridOverlay === false, 'visual evidence contains G70 patch/grid overlay');
const files = {
  probe: { bytes: fs.statSync(probePath).size, sha256: sha256(fs.readFileSync(probePath)) },
  importedTopdown: readPng(importedPath, 257, 257),
  near: readPng(path.join(VISUAL, 'g70-near-detail-near.png'), 960, 640),
  far: readPng(path.join(VISUAL, 'g70-near-detail-far.png'), 960, 640),
  fullWorld: readPng(path.join(VISUAL, 'g70-near-detail-full-world.png'), 1200, 800),
};
const bundle = { schema:'westeros-g70-near-detail-evidence-v1', sourceMapSha256:EXPECTED_SHA, files };
fs.writeFileSync(path.join(VISUAL, 'g70-near-detail-evidence-bundle.json'), `${JSON.stringify(bundle, null, 2)}\n`);
console.log(`G70_NEAR_DETAIL_EVIDENCE_BUNDLE=${JSON.stringify(bundle)}`);
console.log('NE_G70_NEAR_DETAIL_EVIDENCE_BUNDLE_OK');
