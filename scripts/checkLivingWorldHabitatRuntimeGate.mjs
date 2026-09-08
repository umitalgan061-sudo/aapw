import assert from 'node:assert/strict';
import {
  admitLivingWorldActor,
  applyLivingWorldHabitatAdmission,
  buildLivingWorldHabitatContext,
  habitatRuntimeDigest,
} from '../src/3d/gameplay/livingWorldHabitatRuntimeGate.js';

const actor = { kind: 'wildlife', userData: {} };
const context = buildLivingWorldHabitatContext(actor, { biome: 'north', roadDistance: 20, settlementDistance: 20, groundY: 3 });
assert.equal(context.kind, 'wildlife');
assert.equal(context.biome, 'north');

const accepted = admitLivingWorldActor(actor, context);
assert.equal(accepted.admitted, true);
assert.equal(accepted.evidence.context.groundAligned, true);
assert.equal(habitatRuntimeDigest(actor, context), accepted.evidence.digest);

const rejected = admitLivingWorldActor({ kind: 'wildlife' }, { surface: 'settlement-edge', roadDistance: 20, settlementDistance: 20 });
assert.equal(rejected.admitted, false);
assert.equal(rejected.reason, 'settlement-edge-wildlife');

const attached = applyLivingWorldHabitatAdmission(actor, context);
assert.equal(attached.admitted, true);
assert.equal(actor.userData.livingWorldHabitat.digest, attached.evidence.digest);

console.log('living-world habitat runtime gate checks passed');
