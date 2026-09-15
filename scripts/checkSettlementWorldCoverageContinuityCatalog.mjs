import { strict as assert } from 'node:assert';
import {
  SETTLEMENT_WORLD_COVERAGE_CONTINUITY_CATALOG_API,
  SETTLEMENT_WORLD_COVERAGE_CONTINUITY_CONTEXTS,
  SETTLEMENT_WORLD_COVERAGE_CONTINUITY_SERVICES,
  SETTLEMENT_WORLD_COVERAGE_CONTINUITY_STAGES,
  buildSettlementWorldCoverageContinuityCatalogue,
  findSettlementWorldCoverageContinuityProfiles,
  getSettlementWorldCoverageContinuityProfile,
  validateSettlementWorldCoverageContinuityCatalogue,
} from '../src/3d/gameplay/settlementWorldCoverageContinuityCatalog.js';

const catalogue = buildSettlementWorldCoverageContinuityCatalogue();
const validation = validateSettlementWorldCoverageContinuityCatalogue();

assert.equal(validation.ok, true, validation.errors.join(','));
assert.equal(catalogue.length, SETTLEMENT_WORLD_COVERAGE_CONTINUITY_CATALOG_API.generatedProfileCount);
assert.equal(catalogue.length, 560);
assert.equal(new Set(catalogue.map((row) => row.id)).size, catalogue.length);
assert.equal(SETTLEMENT_WORLD_COVERAGE_CONTINUITY_SERVICES.length, 8);
assert.equal(SETTLEMENT_WORLD_COVERAGE_CONTINUITY_STAGES.length, 7);
assert.equal(SETTLEMENT_WORLD_COVERAGE_CONTINUITY_CONTEXTS.length, 10);

for (const service of SETTLEMENT_WORLD_COVERAGE_CONTINUITY_SERVICES) {
  const serviceRows = catalogue.filter((row) => row.serviceId === service);
  assert.equal(serviceRows.length, 70, `service cardinality drift:${service}`);
  for (const stage of SETTLEMENT_WORLD_COVERAGE_CONTINUITY_STAGES) {
    const stageRows = serviceRows.filter((row) => row.stage === stage);
    assert.equal(stageRows.length, 10, `stage cardinality drift:${service}:${stage}`);
    assert.ok(stageRows.every((row) => row.mobileDensity <= row.density));
    assert.ok(stageRows.every((row) => row.density >= 0 && row.density <= 1));
  }
}

for (const context of SETTLEMENT_WORLD_COVERAGE_CONTINUITY_CONTEXTS) {
  const rows = findSettlementWorldCoverageContinuityProfiles({ context });
  assert.equal(rows.length, 56, `context cardinality drift:${context}`);
  assert.ok(rows.every((row) => row.tags.length >= 1));
  assert.ok(rows.every((row) => typeof row.priority === 'number'));
}

for (const service of SETTLEMENT_WORLD_COVERAGE_CONTINUITY_SERVICES) {
  for (const stage of SETTLEMENT_WORLD_COVERAGE_CONTINUITY_STAGES) {
    const row = getSettlementWorldCoverageContinuityProfile(service, stage, 'north-temperate');
    assert.ok(row, `missing profile:${service}:${stage}`);
    assert.equal(row.serviceId, service);
    assert.equal(row.stage, stage);
    assert.equal(row.context, 'north-temperate');
    assert.ok(row.id.includes(service));
    assert.ok(row.id.includes(stage));
    assert.equal(typeof row.readable, 'boolean');
  }
}

assert.equal(getSettlementWorldCoverageContinuityProfile('unknown', 'far', 'north-temperate'), null);
assert.equal(getSettlementWorldCoverageContinuityProfile('market', 'unknown', 'north-temperate'), null);
assert.equal(getSettlementWorldCoverageContinuityProfile('market', 'far', 'unknown'), null);

const marketRows = findSettlementWorldCoverageContinuityProfiles({ serviceId: 'market' });
assert.equal(marketRows.length, 70);
assert.ok(marketRows.some((row) => row.stage === 'threshold'));
assert.ok(marketRows.some((row) => row.context === 'shoreline'));

const thresholdRows = findSettlementWorldCoverageContinuityProfiles({ stage: 'threshold' });
assert.equal(thresholdRows.length, 80);
assert.ok(thresholdRows.every((row) => row.priority >= 0));

const forestRows = findSettlementWorldCoverageContinuityProfiles({ context: 'woodland' });
assert.equal(forestRows.length, 56);
assert.ok(forestRows.some((row) => row.serviceId === 'tavern'));

for (const stage of SETTLEMENT_WORLD_COVERAGE_CONTINUITY_STAGES) {
  const gate = getSettlementWorldCoverageContinuityProfile('gate', stage, 'north-temperate');
  const market = getSettlementWorldCoverageContinuityProfile('market', stage, 'north-temperate');
  assert.ok(market.priority >= gate.priority || stage !== 'threshold', `unexpected market/gate priority:${stage}`);
}

const mobileValues = catalogue.map((row) => row.mobileDensity);
assert.ok(Math.max(...mobileValues) <= 0.62);
assert.ok(Math.min(...mobileValues) >= 0);

const idsByContext = SETTLEMENT_WORLD_COVERAGE_CONTINUITY_CONTEXTS.map((context) =>
  catalogue.filter((row) => row.context === context).map((row) => row.id).join('|'),
);
assert.equal(new Set(idsByContext).size, idsByContext.length);

const fingerprintA = validation.fingerprint;
const fingerprintB = validateSettlementWorldCoverageContinuityCatalogue().fingerprint;
assert.equal(fingerprintA, fingerprintB);

const frozenProfile = getSettlementWorldCoverageContinuityProfile('blacksmith', 'service', 'mountain-pass');
assert.equal(Object.isFrozen(frozenProfile), true);
assert.equal(Object.isFrozen(frozenProfile.tags), true);

let mutationBlocked = false;
try {
  frozenProfile.density = 0;
} catch {
  mutationBlocked = true;
}
assert.equal(frozenProfile.density !== 0, true);

const filtered = findSettlementWorldCoverageContinuityProfiles({ serviceId: 'tavern', stage: 'service', context: 'shoreline' });
assert.equal(filtered.length, 1);
assert.equal(filtered[0].serviceId, 'tavern');
assert.equal(filtered[0].stage, 'service');
assert.equal(filtered[0].context, 'shoreline');

const readableFar = catalogue.filter((row) => row.stage === 'far' && row.readable);
assert.ok(readableFar.length > 0);
const thresholdReadable = catalogue.filter((row) => row.stage === 'threshold' && row.readable);
assert.equal(thresholdReadable.length, 80);

console.log('Settlement World Coverage Continuity Catalog: PASS');
console.log(JSON.stringify({
  count: catalogue.length,
  services: SETTLEMENT_WORLD_COVERAGE_CONTINUITY_SERVICES.length,
  stages: SETTLEMENT_WORLD_COVERAGE_CONTINUITY_STAGES.length,
  contexts: SETTLEMENT_WORLD_COVERAGE_CONTINUITY_CONTEXTS.length,
  mobileMax: Math.max(...mobileValues),
  readableFar: readableFar.length,
  thresholdReadable: thresholdReadable.length,
  fingerprint: validation.fingerprint,
  mutationGuarded: mutationBlocked || frozenProfile.density !== 0,
}));
