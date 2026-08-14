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
const fullWorld3DPath = path.join(VISUAL_DIR, 'g10-relief-full-world-3d-topdown.png');
const fullWorld3DMetadataPath = path.join(VISUAL_DIR, 'g10-relief-full-world-3d-topdown.json');
const probe = JSON.parse(fs.readFileSync(probePath, 'utf8'));
const dense = JSON.parse(fs.readFileSync(densePath, 'utf8'));
const visual = JSON.parse(fs.readFileSync(visualMetricsPath, 'utf8'));
const fullWorld3D = JSON.parse(fs.readFileSync(fullWorld3DMetadataPath, 'utf8'));

need(probe.sourceMapSha256 === MAP_SHA && dense.sourceMapSha256 === MAP_SHA, 'source map provenance drift');
need(probe.policyId === dense.policyId, 'source/dense policy mismatch');
need(probe.geoCell === 'G10' && probe.layer === 'Relief/Height Character', 'wrong GeoCell/layer evidence');
need(probe.canonicalWaterCells === 60 && probe.canonicalLandCells === 36 && probe.canonicalSignMismatches === 0, 'canonical G10 hydrology/sign drift');
need(dense.denseSamples === 66049 && dense.denseGridSize === 257, 'dense proof contract drift');
need(dense.gridImprintRatio < 3, `grid imprint ratio failed: ${dense.gridImprintRatio}`);
need(visual.sourceMapSha256 === MAP_SHA, 'visual map provenance drift');
need(visual.sourceWidth === 1536 && visual.sourceHeight === 1024, 'visual canonical dimensions drift');
need(visual.visibleGeoCellOverlay === false, 'semantic visual has a visible GeoCell overlay');
need(visual.nearSha !== visual.farSha && visual.nearSha !== visual.topSha && visual.farSha !== visual.topSha, 'semantic visual frames are not distinct');
need(fullWorld3D.schema === 'westeros-nw-g10-full-world-3d-topdown-v1', '3D top-down metadata schema drift');
need(fullWorld3D.orthographicMode === true && fullWorld3D.camera?.type === 'OrthographicCamera', '3D top-down is not orthographic');
need(fullWorld3D.camera.downDot > 0.999999, '3D top-down camera is not vertical');
need(fullWorld3D.visibleGeoCellOverlay === false, '3D top-down has a visible GeoCell/grid overlay');
need(fullWorld3D.consoleErrors.length === 0 && fullWorld3D.pageErrors.length === 0 && fullWorld3D.requestFailures.length === 0, '3D top-down browser was not clean');
need(fullWorld3D.runtime.sceneFactory === 'src/3d/sceneManager.js#createScene', '3D top-down did not use the runtime scene builder');
need(fullWorld3D.scene.terrainMeshCount >= 550 && fullWorld3D.scene.waterPresent === true, '3D top-down scene is incomplete');
need(fullWorld3D.renderSha256 === digest(fullWorld3DPath).sha256, '3D top-down checksum mismatch');

const manifest = {
	schema: 'westeros-nw-g10-terrain3d-relief-evidence-v3',
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
		fullWorldSemanticTopDown: digest(path.join(VISUAL_DIR, 'g10-relief-full-world-topdown.png')),
		fullWorld3DTopDown: digest(fullWorld3DPath),
		fullWorld3DTopDownMetadata: digest(fullWorld3DMetadataPath),
	},
	fullWorld3D: {
		orthographicMode: true,
		sceneFactory: fullWorld3D.runtime.sceneFactory,
		terrainMeshes: fullWorld3D.scene.terrainMeshCount,
		renderSha256: fullWorld3D.renderSha256,
	},
	visibleGeoCellOverlay: false,
	note: 'Semantic/reference top-down and the real Three.js runtime-scene orthographic render are separate evidence artifacts; GeoCell/Pindex/source grids remain addressing and QA only.',
};
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`NW_G10_RELIEF_EVIDENCE=${JSON.stringify({ gridImprintRatio: dense.gridImprintRatio, reliefChecksum: probe.reliefChecksum, denseChecksum: dense.denseChecksum, fullWorld3DSha256: fullWorld3D.renderSha256 })}`);
console.log('NW_G10_RELIEF_EVIDENCE_MANIFEST_OK');
