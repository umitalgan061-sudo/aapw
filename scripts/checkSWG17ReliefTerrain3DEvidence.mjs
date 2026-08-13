import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';

function fail(message) { throw new Error(`SW G17 Terrain3D evidence: ${message}`); }
function need(condition, message) { if (!condition) fail(message); }
function read(file) { need(fs.existsSync(file), `missing ${file}`); return fs.readFileSync(file); }
function sha256(buffer) { return crypto.createHash('sha256').update(buffer).digest('hex'); }
function arg(name) { return process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3); }
function parseMetric(logText, prefix) {
  const line = logText.toString('utf8').split(/\r?\n/).filter(Boolean).find((candidate) => candidate.startsWith(prefix));
  need(Boolean(line), `missing ${prefix}`);
  const value = JSON.parse(line.slice(prefix.length));
  need(value && typeof value === 'object' && !Array.isArray(value), `${prefix} must be an object`);
  return value;
}
function deterministicTerrainSubset(metric) {
  const keys = ['terrain3dVersion','regionCount','alignedSamples','seamSamples','maxAlignedHeightError','maxSeamHeightError','minImportedHeight','maxImportedHeight','outputChecksum','bakedSurfaces','bakedVertices','savedRegionFiles'];
  return Object.fromEntries(keys.map((key) => [key, metric[key]]));
}
function compareExact(a,b,label) {
  const left=JSON.stringify(a), right=JSON.stringify(b);
  need(left===right, `${label} differs between deterministic runs\nA=${left}\nB=${right}`);
}

const probePath=arg('probe'), logAPath=arg('log-a'), logBPath=arg('log-b'), seamAPath=arg('seam-a'), seamBPath=arg('seam-b'), previewAPath=arg('preview-a'), previewBPath=arg('preview-b'), outPath=arg('out');
for (const [name,value] of Object.entries({probePath,logAPath,logBPath,seamAPath,seamBPath,previewAPath,previewBPath,outPath})) need(Boolean(value),`${name} argument required`);
const probeBytes=read(probePath), probe=JSON.parse(probeBytes.toString('utf8'));
need(probe.policyId==='gunbatimi-ustasi-g17-terrain3d-relief-2026-08-13-v1','probe policy changed');
need(probe.sourceMapSha256==='20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1','probe map SHA changed');
need(probe.canonicalWaterCells===96&&probe.canonicalLandCells===0,'probe hydrology changed');
need(probe.proofContract?.requireDoubleRunDeterminism===true,'determinism contract missing');
need(probe.proofContract?.requirePreviewByteIdentity===true,'preview byte identity contract missing');
const logA=read(logAPath),logB=read(logBPath),seamA=read(seamAPath),seamB=read(seamBPath),previewA=read(previewAPath),previewB=read(previewBPath);
need(logA.includes(Buffer.from('SW_G17_TERRAIN3D_RELIEF_VALIDATION_OK')),'run A did not validate');
need(logB.includes(Buffer.from('SW_G17_TERRAIN3D_RELIEF_VALIDATION_OK')),'run B did not validate');
need(seamA.includes(Buffer.from('SW_G17_TERRAIN3D_RELIEF_SEAM_OK')),'seam run A did not validate');
need(seamB.includes(Buffer.from('SW_G17_TERRAIN3D_RELIEF_SEAM_OK')),'seam run B did not validate');
const metricA=parseMetric(logA,'G17_TERRAIN3D_RELIEF_METRICS='),metricB=parseMetric(logB,'G17_TERRAIN3D_RELIEF_METRICS='),seamMetricA=parseMetric(seamA,'G17_TERRAIN3D_RELIEF_SEAM_METRICS='),seamMetricB=parseMetric(seamB,'G17_TERRAIN3D_RELIEF_SEAM_METRICS=');
compareExact(deterministicTerrainSubset(metricA),deterministicTerrainSubset(metricB),'Terrain3D import/bake metrics');
compareExact(seamMetricA,seamMetricB,'Terrain3D seam metrics');
need(metricA.savedRegionFiles>=4&&metricB.savedRegionFiles>=4,'persisted region file count regressed');
need(metricA.savedRegionBytes>0&&metricB.savedRegionBytes>0,'persisted region bytes empty');
need(sha256(previewA)===sha256(previewB),'imported top-down previews are not byte-identical');
need(metricA.regionCount>=4,'Terrain3D region count regressed');
need(metricA.alignedSamples===4225,'aligned sample count regressed');
need(metricA.maxAlignedHeightError<=probe.proofContract.maxAlignedHeightErrorMeters,'aligned error exceeds probe contract');
need(metricA.maxSeamHeightError<=probe.proofContract.maxSeamHeightErrorMeters,'seam error exceeds probe contract');
need(metricA.maxImportedHeight<probe.waterCeilingMeters,'imported relief violates marine ceiling');
need(metricA.bakedSurfaces>0&&metricA.bakedVertices>0,'LOD0 bake evidence empty');
need(seamMetricA.samples>=80,'seam audit sample count too small');
need(seamMetricA.maxHeightError<=probe.proofContract.maxSeamHeightErrorMeters,'focused seam error exceeds contract');
need(seamMetricA.maxSlopeJump<=0.12,'focused seam slope jump exceeds continuity budget');
need(seamMetricA.maxDerivativeError<=probe.proofContract.maxSeamDerivativeError,'focused seam derivative error exceeds contract');
need(seamMetricA.maxNormalError<=0.003,'focused seam normal error exceeds continuity budget');
const manifest={policyId:probe.policyId,sourceMapSha256:probe.sourceMapSha256,probeSha256:sha256(probeBytes),previewSha256:sha256(previewA),importBakeMetrics:deterministicTerrainSubset(metricA),persistedStorage:{runABytes:metricA.savedRegionBytes,runBBytes:metricB.savedRegionBytes},seamMetrics:seamMetricA,contract:probe.proofContract};
fs.mkdirSync(path.dirname(outPath),{recursive:true}); fs.writeFileSync(outPath,`${JSON.stringify(manifest,null,2)}\n`);
console.log(`SW_G17_RELIEF_EVIDENCE_MANIFEST_SHA256=${sha256(fs.readFileSync(outPath))}`);
console.log('SW_G17_RELIEF_TERRAIN3D_EVIDENCE_OK');
