#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const PROOF=path.join(ROOT,'godot/terrain-authoring/.terrain3d-proof');
const VISUAL=path.join(ROOT,'artifacts/ne-g60-near-detail-visual');
const EXPECTED_SHA='20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1';
const requireOk=(ok,message)=>{if(!ok)throw new Error(message);};
const sha256=(bytes)=>crypto.createHash('sha256').update(bytes).digest('hex');
function readPng(file,width,height){
  const bytes=fs.readFileSync(file);
  requireOk(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),`${file} is not PNG`);
  requireOk(bytes.readUInt32BE(16)===width&&bytes.readUInt32BE(20)===height,`${file} dimensions changed`);
  return{bytes:bytes.length,sha256:sha256(bytes),width,height};
}
const probePath=path.join(PROOF,'g60-near-detail-probe.json'),bakePath=path.join(PROOF,'g60-near-detail-bake.json');
const importedPath=path.join(PROOF,'g60-near-detail-imported-topdown.png'),visualMetricsPath=path.join(VISUAL,'g60-near-detail-visual-metrics.json');
for(const file of [probePath,bakePath,importedPath,visualMetricsPath])requireOk(fs.existsSync(file),`missing evidence ${file}`);
const probe=JSON.parse(fs.readFileSync(probePath,'utf8')),bake=JSON.parse(fs.readFileSync(bakePath,'utf8')),visual=JSON.parse(fs.readFileSync(visualMetricsPath,'utf8'));
requireOk(probe.sourceMapSha256===EXPECTED_SHA&&visual.sourceMapSha256===EXPECTED_SHA,'map.png provenance mismatch');
requireOk(probe.geoCell==='G60'&&probe.layer==='Near Detail'&&probe.canonicalWaterCells===96&&probe.canonicalLandCells===0,'unexpected G60 probe geography');
requireOk(probe.maxHeightDelta===0&&probe.maxControlDelta===0&&probe.maxRoadPathDelta===0&&probe.maxFoliageDensity===0,'probe says prior layer changed');
requireOk(bake.terrain3dVersion.startsWith('1.0.2')&&bake.regionCount>=4&&bake.alignedSamples===4225&&bake.seamSamples>=24,'native Terrain3D evidence incomplete');
requireOk(bake.savedRegionFiles>=4&&bake.bakedVertices>0&&bake.maxHeightError<=0.015&&bake.maxBlendError<=0.006&&bake.maxColorError<=0.006&&bake.maxRoughnessError<=0.006,'native Terrain3D tolerances failed');
requireOk(visual.topdown?.mode==='continuous-semantic-world-context'&&visual.topdown?.g60PatchApplied===false&&visual.topdown?.g60PatchAlpha===0&&visual.topdown?.gridOverlay===false,'visual evidence contains a G60 patch/grid');
const files={
  probe:{bytes:fs.statSync(probePath).size,sha256:sha256(fs.readFileSync(probePath))},
  bake:{bytes:fs.statSync(bakePath).size,sha256:sha256(fs.readFileSync(bakePath))},
  importedTopdown:readPng(importedPath,257,257),
  near:readPng(path.join(VISUAL,'g60-near-detail-near.png'),960,640),
  far:readPng(path.join(VISUAL,'g60-near-detail-far.png'),960,640),
  fullWorld:readPng(path.join(VISUAL,'g60-near-detail-full-world.png'),1200,800),
};
requireOk(files.near.sha256!==files.far.sha256&&files.far.sha256!==files.fullWorld.sha256,'visual evidence hashes are not distinct');
const manifest={schema:'westeros-g60-near-detail-evidence-v1',sourceMapSha256:EXPECTED_SHA,policyId:probe.policyId,files};
fs.writeFileSync(path.join(VISUAL,'g60-near-detail-evidence-bundle.json'),`${JSON.stringify(manifest,null,2)}\n`);
console.log(`G60_NEAR_DETAIL_EVIDENCE_BUNDLE=${JSON.stringify(manifest)}`);
console.log('NE_G60_NEAR_DETAIL_EVIDENCE_BUNDLE_OK');
