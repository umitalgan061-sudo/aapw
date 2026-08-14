#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const arg = (name) => {
	const value = process.argv.find((item) => item.startsWith(`${name}=`));
	if (!value) throw new Error(`[checkNWG10RuntimeSmoothingEvidence] missing ${name}=...`);
	return path.resolve(value.slice(name.length + 1));
};
const smoothingPath = arg('--smoothing');
const topdownPath = arg('--topdown');
const pngPath = arg('--png');
const outPath = arg('--out');
const smoothing = JSON.parse(fs.readFileSync(smoothingPath, 'utf8'));
const topdown = JSON.parse(fs.readFileSync(topdownPath, 'utf8'));
const png = fs.readFileSync(pngPath);
const pngSha256 = crypto.createHash('sha256').update(png).digest('hex');
const need = (condition, message) => { if (!condition) throw new Error(`[checkNWG10RuntimeSmoothingEvidence] ${message}`); };

need(smoothing.mapSha256 === '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1', 'map.png provenance mismatch');
need(smoothing.denseSamples === 66_049, `dense proof drifted: ${smoothing.denseSamples}`);
need(smoothing.boundaryCount >= 12, `insufficient G10 source boundaries: ${smoothing.boundaryCount}`);
need(smoothing.meanJumpRatio <= 0.025, `hard-edge residual ratio too high: ${smoothing.meanJumpRatio}`);
need(smoothing.continuousMaxJump <= 0.006, `continuous max jump too high: ${smoothing.continuousMaxJump}`);
need(topdown.schema === 'westeros-nw-g10-runtime-smoothed-full-world-3d-v1', `unexpected topdown schema ${topdown.schema}`);
need(topdown.cameraType === 'OrthographicCamera' && topdown.downDot > 0.999999, 'topdown is not real vertical orthographic 3D');
need(topdown.continuousSemanticMeshes === topdown.terrainMeshCount, 'not every runtime terrain mesh uses continuous semantics');
need(topdown.boundaryBlendVertices > 10_000, 'real runtime mesh set lacks continuous boundary samples');
need(topdown.overlayObjects.length === 0, 'explicit GeoCell/Pindex overlay found');
need(topdown.meanGridEnergyRatio < 2.8 && topdown.maxGridEnergyRatio < 7.5, 'regular runtime grid energy exceeded contract');
need(topdown.renderSha256 === pngSha256, 'topdown PNG checksum does not match metadata');
need(png.length === topdown.pngBytes && png.length > 40_000, 'topdown PNG size/provenance mismatch');

const manifest = {
	schema: 'westeros-nw-g10-runtime-surface-smoothing-evidence-v1',
	geoCell: 'G10',
	layerContext: 'Relief/Height Character runtime visual refinement',
	sourceMapSha256: smoothing.mapSha256,
	before: {
		semanticSource: '96x64 hard classifyReferenceBaseSurface CPU macro blend',
		legacyMeanJump: smoothing.legacyMeanJump,
		legacyMaxJump: smoothing.legacyMaxJump,
	},
	after: {
		semanticSource: 'Pindex Quality V2 continuous weighted CPU macro blend + existing V2 GPU shader',
		continuousMeanJump: smoothing.continuousMeanJump,
		continuousMaxJump: smoothing.continuousMaxJump,
		meanJumpRatio: smoothing.meanJumpRatio,
		blendedDenseSamples: smoothing.blendedDenseSamples,
		deterministicChecksum: smoothing.checksum,
	},
	realRuntime3D: {
		renderSha256: pngSha256,
		pngBytes: png.length,
		terrainMeshes: topdown.terrainMeshCount,
		terrainVertices: topdown.terrainVertexCount,
		boundaryBlendVertices: topdown.boundaryBlendVertices,
		meanGridEnergyRatio: topdown.meanGridEnergyRatio,
		maxGridEnergyRatio: topdown.maxGridEnergyRatio,
		waterMaterialType: topdown.waterMaterialType,
	},
	gridPolicy: '96x64/Pindex/GeoCell structures are semantic addressing and QA only; no explicit runtime overlay is accepted.',
};
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`NW_G10_RUNTIME_SMOOTHING_EVIDENCE=${JSON.stringify({ meanJumpRatio: manifest.after.meanJumpRatio, renderSha256: manifest.realRuntime3D.renderSha256 })}`);
console.log('NW_G10_RUNTIME_SMOOTHING_EVIDENCE_OK');
