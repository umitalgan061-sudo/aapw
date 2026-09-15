import assert from 'node:assert/strict';
import { createEnvironmentObservationLedger, applyEnvironmentObservationLedger, ENVIRONMENT_OBSERVATION_LEDGER_V42 } from '../src/3d/world/environmentObservationLedgerV42.js';

const sample = { x: 120, z: -80, elevation: 690, slope: 0.36, moisture: 0.64, waterDistance: 8, waterDepth: 2, waterCoverage: 0.12, biome: 'alpine-meadow', cameraDistance: 140, seed: 42, renderedY: 689.98, colliderY: 690.01 };
const first = createEnvironmentObservationLedger(sample);
const second = createEnvironmentObservationLedger(sample);
assert.deepEqual(first, second);
assert.equal(Object.isFrozen(first), true);
assert.equal(first.schema, 'environment-observation-ledger/v42');
assert.equal(first.acceptance.visibleGridOrSeam, 0);
assert.equal(first.acceptance.blackSkyFailure, 0);
assert.ok(first.geology.snowline > 0);
assert.ok(first.geology.talus >= 0 && first.geology.talus <= 1);
assert.ok(Math.abs(Object.values(first.surfaces).filter((v) => typeof v === 'number' && v >= 0 && v <= 1).length) >= 6);
assert.equal(first.vegetation.eligible, true);

const unsafe = createEnvironmentObservationLedger({ ...sample, waterCoverage: 1, slope: 0.99 });
assert.equal(unsafe.vegetation.eligible, false);
assert.equal(unsafe.vegetation.density, 0);
assert.equal(unsafe.acceptance.visibleRectangularWater, 1);

const malformed = createEnvironmentObservationLedger({ elevation: 'bad', slope: Infinity, x: NaN, z: undefined });
assert.ok(Number.isFinite(malformed.canonical.elevation));
assert.ok(Number.isFinite(malformed.surfaces.macro));
assert.ok(Number.isFinite(malformed.atmosphere.fogLift));

const material = { roughness: 0.1, opacity: 0.1, normalScale: { x: 1, y: 1 } };
applyEnvironmentObservationLedger(material, sample);
assert.ok(material.roughness >= 0.24 && material.roughness <= 0.96);
assert.ok(material.opacity >= 0.32 && material.opacity <= 1);
assert.ok(material.normalScale.x >= 0.15 && material.normalScale.x <= 1);
assert.equal(material.userData.environmentObservationLedger.schema, 'environment-observation-ledger/v42');
assert.equal(ENVIRONMENT_OBSERVATION_LEDGER_V42.camera.width, 1536);
assert.equal(ENVIRONMENT_OBSERVATION_LEDGER_V42.camera.height, 1024);
console.log('ENVIRONMENT_OBSERVATION_LEDGER_V42_OK');
