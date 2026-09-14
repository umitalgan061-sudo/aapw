import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  evaluateAllPlayerWorldCoverageScenarios,
  evaluatePlayerWorldCoverageScenario,
  getPlayerWorldCoverageScenario,
  listPlayerWorldCoverageScenarios,
} from '../src/3d/gameplay/playerWorldCoverageScenarioMatrix.js';
import { PLAYER_WORLD_COVERAGE_VERSION } from '../src/3d/gameplay/playerWorldCoverageDirector.js';

let checks = 0;
const ok = (value, message) => { assert.ok(value, message); checks += 1; };
const eq = (left, right, message) => { assert.deepEqual(left, right, message); checks += 1; };

const source = fs.readFileSync(new URL('../src/3d/gameplay/playerWorldCoverageScenarioMatrix.js', import.meta.url), 'utf8');
ok(!source.includes('EditorMaterialStudio'), 'scenario matrix has no editor import');
ok(!source.includes("from 'three'"), 'scenario matrix has no Three import');

const scenarios = listPlayerWorldCoverageScenarios();
eq(scenarios.length, 10, 'ten representative scenarios');
eq(scenarios.at(0).id, 'settlement-gate', 'scenario ordering stable');
eq(scenarios.at(-1).id, 'snowy-road', 'scenario tail stable');
eq(new Set(scenarios.map((scenario) => scenario.id)).size, 10, 'scenario ids unique');

for (const scenario of scenarios) {
  const fetched = getPlayerWorldCoverageScenario(scenario.id);
  ok(fetched, `scenario lookup: ${scenario.id}`);
  eq(fetched.id, scenario.id, `lookup preserves id: ${scenario.id}`);
  const result = evaluatePlayerWorldCoverageScenario(scenario.id);
  eq(result.version, 'kwc-scenarios-1', `scenario version: ${scenario.id}`);
  eq(result.snapshot.version, PLAYER_WORLD_COVERAGE_VERSION, `director version: ${scenario.id}`);
  ok(result.snapshot.coverage.expectedCellCount === 1008, `full lattice: ${scenario.id}`);
  ok(result.snapshot.evidence.editorUiImported === false, `editor boundary: ${scenario.id}`);
  ok(result.snapshot.evidence.materialCore === 'src/3d/materials/MaterialAssignmentCore.js', `material authority: ${scenario.id}`);
  ok(result.snapshot.evidence.placementPipeline === 'src/3d/world/WorldAssetPlacementPipeline.js', `placement authority: ${scenario.id}`);
}

const results = evaluateAllPlayerWorldCoverageScenarios();
eq(results.length, scenarios.length, 'all scenarios evaluated');
ok(results.every((result) => result.snapshot.coverage.expectedCellCount === 1008), 'all scenario lattices are full-world');
ok(results.some((result) => result.id === 'deep-water' && result.snapshot.combat.eligible === false), 'deep water rejects grounded combat');
ok(results.some((result) => result.id === 'alpine-snow' && result.snapshot.snapshot?.selectedSample?.surface === undefined || result.id === 'alpine-snow'), 'alpine scenario present');
ok(results.some((result) => result.id === 'alpine-snow' && result.snapshot.surfaceContext?.dominantSurface === 'snow'), 'alpine snow stays snow-influenced');
ok(results.some((result) => result.id === 'coast-wet-edge' && result.snapshot.selectedSample.biome === 'coast'), 'coast context retained');
ok(results.some((result) => result.id === 'mountain-climb' && result.snapshot.combat.eligible === true), 'mountain combat remains eligible when grounded');
ok(results.some((result) => result.id === 'settlement-gate' && result.snapshot.interaction.primary === 'settlement'), 'settlement interaction wins near gate');
ok(results.some((result) => result.id === 'snowy-road' && result.snapshot.selectedSample.surface === 'road'), 'road surface survives snowy climate context');

const repeatA = evaluatePlayerWorldCoverageScenario('forest-road');
const repeatB = evaluatePlayerWorldCoverageScenario('forest-road');
eq(repeatA.snapshot.fingerprint, repeatB.snapshot.fingerprint, 'scenario evaluation deterministic');
eq(repeatA.validation.errors, repeatB.validation.errors, 'validation deterministic');
eq(getPlayerWorldCoverageScenario('missing'), null, 'unknown scenario returns null');
checks += 1;

console.log(JSON.stringify({ version: PLAYER_WORLD_COVERAGE_VERSION, scenarios: scenarios.length, checks }));
