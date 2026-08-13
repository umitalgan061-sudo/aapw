import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const fail = (message) => { throw new Error(`SE G77 Terrain3D relief evidence: ${message}`); };
const need = (condition, message) => { if (!condition) fail(message); };
const arg = (name) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const read = (file) => { need(Boolean(file) && fs.existsSync(file), `missing ${file}`); return fs.readFileSync(file); };
const sha256 = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');
function metric(buffer, prefix) {
  const line = buffer.toString('utf8').split(/\r?\n/).find((candidate) => candidate.startsWith(prefix));
  need(Boolean(line), `missing metric ${prefix}`);
  const parsed = JSON.parse(line.slice(prefix.length));
  need(parsed && typeof parsed === 'object' && !Array.isArray(parsed), `${prefix} is not an object`);
  return parsed;
}
const subset = (value, keys) => Object.fromEntries(keys.map((key) => [key, value[key]]));
const exact = (a, b, label) => need(JSON.stringify(a) === JSON.stringify(b), `${label} changed between deterministic runs`);

const probePath = arg('probe');
const importAPath = arg('import-a');
const importBPath = arg('import-b');
const reloadAPath = arg('reload-a');
const reloadBPath = arg('reload-b');
const gridAPath = arg('grid-a');
const gridBPath = arg('grid-b');
const seamAPath = arg('seam-a');
const seamBPath = arg('seam-b');
const lodAPath = arg('lod-a');
const lodBPath = arg('lod-b');
const previewAPath = arg('preview-a');
const previewBPath = arg('preview-b');
const outPath = arg('out');
for (const [name, value] of Object.entries({ probePath, importAPath, importBPath, reloadAPath, reloadBPath, gridAPath, gridBPath, seamAPath, seamBPath, lodAPath, lodBPath, previewAPath, previewBPath, outPath })) need(Boolean(value), `${name} argument required`);

const probeBytes = read(probePath);
const probe = JSON.parse(probeBytes.toString('utf8'));
need(probe.policyId === 'kizil-ufuk-g77-terrain3d-relief-2026-08-13-v1', 'probe policy changed');
need(probe.sourceMapSha256 === '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1', 'probe map SHA changed');
need(probe.canonicalWater === 44 && probe.canonicalLand === 52 && probe.canonicalSignMismatches === 0, 'probe coastline semantics changed');

const importA = read(importAPath); const importB = read(importBPath);
const reloadA = read(reloadAPath); const reloadB = read(reloadBPath);
const gridA = read(gridAPath); const gridB = read(gridBPath);
const seamA = read(seamAPath); const seamB = read(seamBPath);
const lodA = read(lodAPath); const lodB = read(lodBPath);
const previewA = read(previewAPath); const previewB = read(previewBPath);
need(importA.includes(Buffer.from('SE_G77_TERRAIN3D_RELIEF_VALIDATION_OK')) && importB.includes(Buffer.from('SE_G77_TERRAIN3D_RELIEF_VALIDATION_OK')), 'Terrain3D import validation marker missing');
need(reloadA.includes(Buffer.from('SE_G77_TERRAIN3D_RELIEF_RELOAD_OK')) && reloadB.includes(Buffer.from('SE_G77_TERRAIN3D_RELIEF_RELOAD_OK')), 'Terrain3D reload validation marker missing');
need(gridA.includes(Buffer.from('SE_G77_TERRAIN3D_RELIEF_GRID_OK')) && gridB.includes(Buffer.from('SE_G77_TERRAIN3D_RELIEF_GRID_OK')), 'Terrain3D grid validation marker missing');
need(seamA.includes(Buffer.from('SE_G77_TERRAIN3D_RELIEF_SEAM_OK')) && seamB.includes(Buffer.from('SE_G77_TERRAIN3D_RELIEF_SEAM_OK')), 'Terrain3D seam validation marker missing');
need(lodA.includes(Buffer.from('SE_G77_TERRAIN3D_RELIEF_LOD_OK')) && lodB.includes(Buffer.from('SE_G77_TERRAIN3D_RELIEF_LOD_OK')), 'Terrain3D LOD validation marker missing');

const ia = metric(importA, 'G77_TERRAIN3D_RELIEF_METRICS='); const ib = metric(importB, 'G77_TERRAIN3D_RELIEF_METRICS=');
const ra = metric(reloadA, 'G77_TERRAIN3D_RELIEF_RELOAD_METRICS='); const rb = metric(reloadB, 'G77_TERRAIN3D_RELIEF_RELOAD_METRICS=');
const ga = metric(gridA, 'G77_TERRAIN3D_RELIEF_GRID_METRICS='); const gb = metric(gridB, 'G77_TERRAIN3D_RELIEF_GRID_METRICS=');
const sa = metric(seamA, 'G77_TERRAIN3D_RELIEF_SEAM_METRICS='); const sb = metric(seamB, 'G77_TERRAIN3D_RELIEF_SEAM_METRICS=');
const la = metric(lodA, 'G77_TERRAIN3D_RELIEF_LOD_METRICS='); const lb = metric(lodB, 'G77_TERRAIN3D_RELIEF_LOD_METRICS=');
const importKeys = ['terrain3dVersion','regionCount','alignedSamples','seamSamples','maxHeightError','maxSeamHeightError','maxBlendError','maxColorError','maxRoughnessError','minImportedHeight','maxImportedHeight','heightChecksum','bakedSurfaces','bakedVertices','savedRegionFiles'];
const reloadKeys = ['terrain3dVersion','regionCount','alignedSamples','seamSamples','maxAlignedHeightError','maxSeamHeightError','minReloadedHeight','maxReloadedHeight','reloadChecksum','bakedSurfaces','bakedVertices'];
const gridKeys = ['samples','regionCount','maxHeightError','minHeight','maxHeight','meanHeight','checksum','fractionalSamples','maxFractionalHeightError','maxNormalLengthError','fractionalChecksum'];
exact(subset(ia, importKeys), subset(ib, importKeys), 'import/bake semantics');
exact(subset(ra, reloadKeys), subset(rb, reloadKeys), 'persisted reload semantics');
exact(subset(ga, gridKeys), subset(gb, gridKeys), 'full-grid semantics');
exact(sa, sb, 'focused seam semantics');
exact(la, lb, 'multi-LOD semantics');
need(ia.regionCount >= 4 && ia.alignedSamples === 4225 && ia.savedRegionFiles >= 4 && ia.savedRegionBytes > 0, 'import/persistence coverage regressed');
need(ia.maxHeightError <= 0.012 && ia.maxSeamHeightError <= 0.02 && ia.maxBlendError <= 0.006 && ia.maxColorError <= 0.012 && ia.maxRoughnessError <= 0.012, 'import tolerance exceeded');
need(ra.regionCount >= 4 && ra.alignedSamples === 4225 && ra.maxAlignedHeightError <= 0.012 && ra.maxSeamHeightError <= 0.02, 'reload tolerance exceeded');
need(sa.samples >= 80 && sa.maxHeightError <= 0.02 && sa.maxDerivativeError <= 0.03 && sa.maxNormalError <= 0.003, 'focused seam contract regressed');
need(Array.isArray(la.levels) && la.levels.length === 3 && la.levels[0].vertices > la.levels[1].vertices && la.levels[1].vertices > la.levels[2].vertices, 'multi-LOD decimation regressed');
need(ga.samples === 66049 && ga.fractionalSamples === 8192 && ga.maxHeightError <= 0.012 && ga.maxFractionalHeightError <= 0.02 && ga.maxNormalLengthError <= 0.001, 'full-grid/fractional contract regressed');
need(ia.bakedSurfaces > 0 && ia.bakedVertices > 0 && ra.bakedSurfaces > 0 && ra.bakedVertices > 0, 'LOD0 bake evidence empty');
need(sha256(previewA) === sha256(previewB), 'imported top-down previews are not byte-identical');

const manifest = { policyId: probe.policyId, sourceMapSha256: probe.sourceMapSha256, probeSha256: sha256(probeBytes), previewSha256: sha256(previewA), importMetrics: subset(ia, importKeys), reloadMetrics: subset(ra, reloadKeys), gridMetrics: subset(ga, gridKeys), seamMetrics: sa, lodMetrics: la, persistedBytes: { runA: ia.savedRegionBytes, runB: ib.savedRegionBytes } };
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`SE_G77_RELIEF_EVIDENCE_MANIFEST_SHA256=${sha256(fs.readFileSync(outPath))}`);
console.log('SE_G77_RELIEF_TERRAIN3D_EVIDENCE_OK');
