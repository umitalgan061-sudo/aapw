#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const proof = path.join(ROOT, 'godot/terrain-authoring/.terrain3d-proof');
const visual = path.join(ROOT, 'artifacts/se-g77-near-detail-visual');
const need = (ok, message) => { if (!ok) throw new Error(`[checkSEG77NearDetailEvidenceBundle] ${message}`); };
const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const pngSize = (file) => { const b = fs.readFileSync(file); need(b.length > 24 && b.subarray(1,4).toString() === 'PNG', `${file} is not PNG`); return { width:b.readUInt32BE(16), height:b.readUInt32BE(20), bytes:b.length }; };
const files = {
  probe:path.join(proof,'g77-near-detail-probe.json'), native:path.join(proof,'g77-near-detail-native-metrics.json'), imported:path.join(proof,'g77-near-detail-imported-topdown.png'),
  near:path.join(visual,'g77-near-detail-near.png'), far:path.join(visual,'g77-near-detail-far.png'), full:path.join(visual,'g77-near-detail-full-world-topdown.png'), visualMetrics:path.join(visual,'g77-near-detail-visual-metrics.json'),
};
for (const [name,file] of Object.entries(files)) need(fs.existsSync(file) && fs.statSync(file).size > 0, `${name} evidence missing`);
const probe = JSON.parse(fs.readFileSync(files.probe,'utf8')), native = JSON.parse(fs.readFileSync(files.native,'utf8')), visualMetrics = JSON.parse(fs.readFileSync(files.visualMetrics,'utf8'));
need(probe.geoCell === 'G77' && probe.layer === 'Near Detail' && probe.sourceSamples === 66049, 'probe identity/sample count drifted');
need(probe.canonicalWaterCells === 44 && probe.canonicalLandCells === 52, 'probe map fingerprint drifted');
need(native.regionCount >= 4 && native.gridSamples === 66049 && native.reloadGridSamples === 66049, 'native full-grid/region evidence incomplete');
need(native.outputChecksum === native.reloadChecksum, 'native save/reload checksum mismatch');
need(native.maxHeightError <= 0.00002 && native.maxBlendError <= 0.006 && native.maxColorError <= 0.006 && native.maxRoughnessError <= 0.006, 'native tolerance evidence failed');
need(native.fractionalSeamSamples === 48 && native.controlSeamSamples === 24 && native.reloadFractionalSeamSamples === 48 && native.reloadControlSeamSamples === 24, 'native/reload 255/256 seam sample evidence missing');
need(native.maxSeamHeightError <= 0.02 && native.maxSeamBlendError <= 0.006 && native.maxSeamColorError <= 0.008 && native.maxSeamRoughnessError <= 0.008, 'native 255/256 seam tolerance evidence failed');
need(native.reloadMaxSeamHeightError <= 0.02 && native.reloadMaxSeamBlendError <= 0.006 && native.reloadMaxSeamColorError <= 0.008 && native.reloadMaxSeamRoughnessError <= 0.008, 'reload 255/256 seam tolerance evidence failed');
need(native.savedRegionFiles >= 4 && native.savedRegionBytes > 0 && native.bakedVertices > 0 && native.reloadBakedVertices > 0, 'native persistence/LOD0 evidence incomplete');
need(native.waterSamples > 15000 && ((probe.activeRoadSamples + probe.activePathSamples > 0) === (native.routeSamples > 0)), 'native water/route evidence disagrees with source');
need(visualMetrics.vertices === 16641 && visualMetrics.triangles === 32768 && visualMetrics.browserErrors.length === 0, 'visual authoring proof incomplete');
const imported = pngSize(files.imported), near = pngSize(files.near), far = pngSize(files.far), full = pngSize(files.full);
need(imported.width === 257 && imported.height === 257, `imported preview size drifted: ${imported.width}x${imported.height}`);
need(near.width >= 900 && far.width >= 900 && full.width >= 1000, 'visual evidence resolution too low');
const digests = Object.fromEntries(Object.entries(files).map(([name,file]) => [name, sha(file)]));
need(new Set([digests.near,digests.far,digests.full]).size === 3, 'visual evidence frames are duplicated');
const manifest = { schema:'se-g77-near-detail-evidence-bundle-v1', policyId:probe.policyId, sourceMapSha256:probe.sourceMapSha256, geography:{ waterCells:probe.canonicalWaterCells, landCells:probe.canonicalLandCells }, source:{ samples:probe.sourceSamples, detailChecksum:probe.detailChecksum, predecessorCoverageChecksum:probe.predecessorCoverageChecksum }, native, images:{ imported, near, far, full }, digests };
const out = path.join(visual,'g77-near-detail-evidence-manifest.json'); fs.writeFileSync(out, `${JSON.stringify(manifest,null,2)}\n`);
console.log(`SE_G77_NEAR_DETAIL_EVIDENCE_BUNDLE=${JSON.stringify({ manifest:out, sourceSamples:probe.sourceSamples, regionCount:native.regionCount, savedRegionFiles:native.savedRegionFiles, digests })}`);
console.log('SE_G77_NEAR_DETAIL_EVIDENCE_BUNDLE_OK');
