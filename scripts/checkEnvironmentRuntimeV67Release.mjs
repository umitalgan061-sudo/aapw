import assert from 'node:assert/strict';
import { buildEnvironmentRuntimeV67 } from '../src/3d/world/environmentRuntimeIntegrationV67.js';
import { buildReleaseGateV67, releaseDecisionV67, validateReleaseGateV67 } from '../src/3d/world/environmentRuntimeReleaseV67.js';
import { buildObservabilityLedgerV67, observabilityScoreV67, observabilityReadyV67 } from '../src/3d/world/environmentRuntimeObservabilityV67.js';
import { V67_COVERAGE_MATRIX } from '../src/3d/world/environmentRuntimeCoverageMatrixV67.js';
import { V67_SCENARIOS } from '../src/3d/world/environmentRuntimeScenarioLedgerV67.js';

const samples=V67_COVERAGE_MATRIX.slice(0,24);
const runtime=buildEnvironmentRuntimeV67({samples,clock:12,dayOfYear:180,seed:'release-v67'});
const scenarioLedger={evaluations:V67_SCENARIOS.map(s=>({id:s.id,hash:s.id,runtime}))};
const gate=buildReleaseGateV67(runtime,{platform:'desktop',admitted:8,total:24});
assert.equal(validateReleaseGateV67(gate).ok,true);
assert.ok(gate.evidenceScore>=.9);
assert.equal(gate.coverage,true);
assert.ok(gate.scenarios>=8);
assert.ok(['ship','hold'].includes(releaseDecisionV67(gate)));
const observability=buildObservabilityLedgerV67(runtime,scenarioLedger);
assert.ok(observability.health.rate>=.9);
assert.ok(observability.confidence>=0);
assert.ok(observability.confidence<=1);
assert.ok(observabilityScoreV67(observability)>=0);
assert.ok(observabilityScoreV67(observability)<=1);
assert.equal(typeof observabilityReadyV67(observability),'boolean');
const gateAgain=buildReleaseGateV67(runtime,{platform:'desktop',admitted:8,total:24});
assert.deepEqual(gateAgain,gateway(gate));
function gateway(value){return value;}
console.log('V67 release regression PASS');
