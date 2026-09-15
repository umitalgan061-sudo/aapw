import assert from 'node:assert/strict';
import { buildEnvironmentRuntimeV67 } from '../src/3d/world/environmentRuntimeIntegrationV67.js';
import { buildObservabilityLedgerV67, validateObservabilityV67, observabilityScoreV67, domainHealthV67, unresolvedEvidenceV67 } from '../src/3d/world/environmentRuntimeObservabilityV67.js';
import { V67_COVERAGE_MATRIX } from '../src/3d/world/environmentRuntimeCoverageMatrixV67.js';

const samples=V67_COVERAGE_MATRIX.slice(0,20);
const runtime=buildEnvironmentRuntimeV67({samples,clock:15,dayOfYear:230,seed:'observability-v67'});
const ledger=buildObservabilityLedgerV67(runtime,{evaluations:[{id:'smoke',runtime,hash:runtime.digest}]});
assert.equal(validateObservabilityV67({policy:'observability-v67',observability:ledger,score:observabilityScoreV67(ledger),decision:'healthy',fingerprint:runtime.digest}).ok,true);
assert.ok(domainHealthV67(runtime.telemetry).entries>0);
assert.ok(domainHealthV67(runtime.telemetry).rate>=.9);
assert.ok(Number.isFinite(ledger.latencyProxy));
assert.ok(ledger.confidence>=0&&ledger.confidence<=1);
assert.ok(observabilityScoreV67(ledger)>=0&&observabilityScoreV67(ledger)<=1);
assert.deepEqual(unresolvedEvidenceV67(ledger).sort(),[]);
const second=buildEnvironmentRuntimeV67({samples,clock:15,dayOfYear:230,seed:'observability-v67'});
const ledger2=buildObservabilityLedgerV67(second,{evaluations:[{id:'smoke',runtime:second,hash:second.digest}]});
assert.equal(ledger.fingerprint,ledger2.fingerprint);
assert.equal(ledger.confidence,ledger2.confidence);
assert.equal(ledger.health.rate,ledger2.health.rate);
for(const item of ledger.checks){
  assert.equal(typeof item.id,'string');
  assert.equal(typeof item.pass,'boolean');
}
console.log('V67 observability regression PASS');
