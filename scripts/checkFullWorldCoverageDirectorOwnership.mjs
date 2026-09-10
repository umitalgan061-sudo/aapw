#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {
  createSyntheticCoveragePlan,
  createFullWorldCoverageManifest,
  createCoverageProbeIndex,
  createCoverageReplay,
  validateReplay,
  createRuntimeCoverageAdapter,
  createViewportCoverageSchedule,
  createOwnerEvidenceRequest,
  createSeamAudit,
  getWorldCoverageConstants,
} from '../src/3d/world/fullWorldCoverageDirector.js';
function assert(condition, message) { if (!condition) throw new Error(`[full-world-ownership] ${message}`); }
const root = path.resolve('.');
const directorSource = fs.readFileSync(path.join(root, 'src/3d/world/fullWorldCoverageDirector.js'), 'utf8');
const materialCoreSource = fs.readFileSync(path.join(root, 'src/3d/materials/MaterialAssignmentCore.js'), 'utf8');
const placementSource = fs.readFileSync(path.join(root, 'src/3d/world/WorldAssetPlacementPipeline.js'), 'utf8');
const constants = getWorldCoverageConstants();
assert(constants.WORLD_BOUNDS.xMin === 0 && constants.WORLD_BOUNDS.yMin === 0, 'coverage origin drifted');
assert(constants.WORLD_BOUNDS.xMax === 9000 && constants.WORLD_BOUNDS.yMax === 7000, 'coverage extent drifted');
assert(constants.DEFAULT_GRID.columns === 36 && constants.DEFAULT_GRID.rows === 28, 'coverage lattice dimensions drifted');
assert(constants.DEFAULT_REQUIRED_FEATURES.length === 9, 'required feature set changed unexpectedly');
assert(constants.REQUIRED_PHASES.length === 10, 'coverage acceptance phases drifted');
assert(constants.MAX_HEIGHT_PARITY_METERS === 1e-5, 'height parity gate drifted');
assert(constants.MAX_UNASSESSED_RATIO === 0, 'unassessed tolerance drifted');
assert(constants.MAX_DETERMINISM_DRIFT === 0, 'determinism tolerance drifted');
const plan = createSyntheticCoveragePlan();
const manifest = createFullWorldCoverageManifest(plan);
const probeIndex = createCoverageProbeIndex(plan);
const replay = createCoverageReplay(plan);
const replayCheck = validateReplay(plan, replay);
const adapter = createRuntimeCoverageAdapter(plan, { batchSize: 24 });
const viewport = createViewportCoverageSchedule(plan, { samples: 7 });
const ownerEvidence = createOwnerEvidenceRequest(plan, { owner: 'buzul-muhafizi' });
const seamAudit = createSeamAudit(plan);
assert(plan.cellCount === 1008, `expected 1008 cells, received ${plan.cellCount}`);
assert(plan.grid.columns * plan.grid.rows === 1008, 'grid product does not cover the full lattice');
assert(plan.coverageRatio === 1, `synthetic plan coverage ${plan.coverageRatio}`);
assert(plan.unassessedRatio === 0, `synthetic plan unassessed ${plan.unassessedRatio}`);
assert(manifest.cellCount === 1008, 'manifest cell count drifted');
assert(manifest.probeCount === plan.probeCount, 'manifest probe count drifted');
assert(Object.keys(probeIndex).length > plan.cellCount, 'probe index failed to enumerate boundary probes');
assert(replayCheck.equal, 'coverage replay did not reproduce exact digest');
assert(adapter.readOnly === true, 'runtime adapter lost read-only guarantee');
assert(adapter.createsGeometry === false, 'runtime adapter is allowed to create geometry');
assert(adapter.mutatesCanonicalGeography === false, 'runtime adapter can mutate canonical geography');
assert(adapter.importsEditorUi === false, 'runtime adapter imports editor UI');
assert(adapter.batchCount > 0, 'coverage batches are empty');
assert(viewport.length === 49, `expected 49 viewport probes, received ${viewport.length}`);
assert(viewport.every((entry) => entry.normalized.x >= 0 && entry.normalized.x <= 1 && entry.normalized.y >= 0 && entry.normalized.y <= 1), 'viewport schedule escaped normalized bounds');
assert(ownerEvidence.requiredChecks.includes('material-placement-contract'), 'owner evidence omitted shared material contract');
assert(ownerEvidence.requiredChecks.includes('asset-hydration'), 'owner evidence omitted asset hydration proof');
assert(ownerEvidence.noPassClaimUntilObserved === true, 'owner evidence allows unobserved PASS claims');
assert(seamAudit.pairCount === 1952, `expected 1952 seam pairs, received ${seamAudit.pairCount}`);
assert(seamAudit.unresolvedCount === 0, 'coverage lattice contains self-seam pairs');
const boundaryCounts = { north: plan.boundaries.north.length, south: plan.boundaries.south.length, west: plan.boundaries.west.length, east: plan.boundaries.east.length };
assert(boundaryCounts.north === 36, 'north boundary is not complete');
assert(boundaryCounts.south === 36, 'south boundary is not complete');
assert(boundaryCounts.west === 28, 'west boundary is not complete');
assert(boundaryCounts.east === 28, 'east boundary is not complete');
for (const phase of plan.evidence) assert(typeof phase.phase === 'string' && typeof phase.passed === 'boolean', `invalid phase evidence ${JSON.stringify(phase)}`);
assert(plan.evidence.some((phase) => phase.phase === 'determinism'), 'determinism phase missing');
assert(plan.evidence.some((phase) => phase.phase === 'parity'), 'parity phase missing');
assert(plan.evidence.some((phase) => phase.phase === 'cross-seam'), 'seam phase missing');
for (const feature of constants.DEFAULT_REQUIRED_FEATURES) { assert(plan.featureMatrix[feature], `feature matrix missing ${feature}`); assert(Number.isFinite(plan.featureMatrix[feature].coverage), `${feature} coverage is not finite`); }
for (const token of ['EditorMaterialStudio','MeshBasicMaterial','BoxGeometry','SphereGeometry','CylinderGeometry','CapsuleGeometry','PlaneGeometry','writeFileSync','appendFileSync','mkdirSync','git lfs pull --all']) assert(!directorSource.includes(token), `director contains forbidden token: ${token}`);
assert(directorSource.includes('mutatesCanonicalGeography'), 'director read-only marker missing');
assert(directorSource.includes('createsGeometry'), 'director geometry marker missing');
assert(directorSource.includes('sharedMaterialPlacementAuthority'), 'shared material authority marker missing');
assert(materialCoreSource.includes('Shared, DOM-free material pipeline'), 'shared MaterialAssignmentCore contract marker missing');
assert(materialCoreSource.includes('validateMaterialAssignment'), 'shared material validation API missing');
assert(placementSource.includes('autoAssignMaterials'), 'WorldAssetPlacementPipeline material bridge missing');
assert(placementSource.includes('../materials/MaterialAssignmentCore.js'), 'placement pipeline does not use shared material core');
assert(!placementSource.includes('EditorMaterialStudio'), 'placement pipeline imports editor UI');
const reparsed = JSON.parse(JSON.stringify(manifest));
assert(reparsed.cellCount === manifest.cellCount, 'manifest serialization lost cell count');
assert(reparsed.deterministicDigest === manifest.deterministicDigest, 'manifest serialization changed digest');
assert(reparsed.validation.ok === manifest.validation.ok, 'manifest serialization changed validation');
const riskTotal = Object.values(plan.risks).reduce((sum, value) => sum + value, 0);
assert(riskTotal === 0, `synthetic ownership plan contains runtime risks: ${JSON.stringify(plan.risks)}`);
assert(plan.gaps.length === 0, `synthetic ownership plan contains ${plan.gaps.length} coverage gaps`);
assert(plan.report.readyForRuntimeProof === true, 'synthetic ownership plan is not internally consistent');
console.log(`FULL_WORLD_COVERAGE_OWNERSHIP_OK checks=64 cells=${plan.cellCount} seams=${seamAudit.pairCount} probes=${plan.probeCount} digest=${manifest.deterministicDigest}`);
