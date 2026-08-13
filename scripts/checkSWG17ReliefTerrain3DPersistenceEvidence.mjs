import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';

function need(ok, message) { if (!ok) throw new Error(`SW G17 persistence evidence: ${message}`); }
function arg(name) { return process.argv.find((v) => v.startsWith(`--${name}=`))?.slice(name.length + 3); }
function read(file) { need(file && fs.existsSync(file), `missing ${file || 'path'}`); return fs.readFileSync(file); }
function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function parse(buffer, prefix, marker) {
  const text = buffer.toString('utf8'); need(text.includes(marker), `${marker} missing`);
  const line = text.split(/\r?\n/).find((candidate) => candidate.startsWith(prefix)); need(line, `${prefix} missing`); return JSON.parse(line.slice(prefix.length));
}

const probeBytes = read(arg('probe'));
const probe = JSON.parse(probeBytes.toString('utf8'));
const importA = parse(read(arg('import-a')), 'G17_TERRAIN3D_RELIEF_METRICS=', 'SW_G17_TERRAIN3D_RELIEF_VALIDATION_OK');
const importB = parse(read(arg('import-b')), 'G17_TERRAIN3D_RELIEF_METRICS=', 'SW_G17_TERRAIN3D_RELIEF_VALIDATION_OK');
const reloadA = parse(read(arg('reload-a')), 'G17_TERRAIN3D_RELIEF_RELOAD_METRICS=', 'SW_G17_TERRAIN3D_RELIEF_RELOAD_OK');
const reloadB = parse(read(arg('reload-b')), 'G17_TERRAIN3D_RELIEF_RELOAD_METRICS=', 'SW_G17_TERRAIN3D_RELIEF_RELOAD_OK');
need(importA.outputChecksum === reloadA.reloadChecksum, 'run A save/reload checksum mismatch');
need(importB.outputChecksum === reloadB.reloadChecksum, 'run B save/reload checksum mismatch');
need(reloadA.reloadChecksum === reloadB.reloadChecksum, 'reload checksum is not deterministic');
need(JSON.stringify(reloadA) === JSON.stringify(reloadB), 'reload metrics differ between runs');
need(importA.regionCount === reloadA.regionCount && importB.regionCount === reloadB.regionCount, 'region count changed after reload');
need(importA.bakedSurfaces === reloadA.bakedSurfaces && importB.bakedSurfaces === reloadB.bakedSurfaces, 'baked surface count changed after reload');
need(importA.bakedVertices === reloadA.bakedVertices && importB.bakedVertices === reloadB.bakedVertices, 'baked vertex count changed after reload');
need(reloadA.alignedSamples === 4225, 'reloaded aligned sample count changed');
need(reloadA.maxAlignedHeightError <= probe.proofContract.maxAlignedHeightErrorMeters, 'reloaded aligned error exceeds contract');
need(reloadA.maxSeamHeightError <= probe.proofContract.maxSeamHeightErrorMeters, 'reloaded seam error exceeds contract');
need(reloadA.maxReloadedHeight < probe.waterCeilingMeters, 'reloaded marine ceiling violated');
need(reloadA.regionCount >= probe.proofContract.minimumRegions, 'reloaded region count below contract');
need(reloadA.bakedSurfaces > 0 && reloadA.bakedVertices > 0, 'reloaded LOD0 bake empty');
const manifest = { policyId: probe.policyId, sourceMapSha256: probe.sourceMapSha256, probeSha256: sha256(probeBytes), importChecksum: importA.outputChecksum, reloadMetrics: reloadA };
const out = arg('out'); need(out, '--out required'); fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`SW_G17_RELIEF_PERSISTENCE_MANIFEST_SHA256=${sha256(fs.readFileSync(out))}`);
console.log('SW_G17_RELIEF_TERRAIN3D_PERSISTENCE_EVIDENCE_OK');
