import assert from 'node:assert/strict';
import { buildEnvironmentRuntimeV66 } from '../src/3d/world/environmentRuntimeIntegrationV66.js';
import { buildV66ReleaseGate, validateV66ReleaseGate, buildV66ReleaseNotes } from '../src/3d/world/environmentRuntimeReleaseV66.js';

const sample = { x: 0, z: 0, elevation: 480, slope: 8, moisture: .62, rainfall: .18, soilDepth: .72, vegetationCover: .74, rockExposure: .12, waterDistance: 80, waterDepth: 0, roadDistance: 120, settlementDistance: 280, confidence: .97, biome: 'forest' };
const runtime = buildEnvironmentRuntimeV66({ samples: [sample, { ...sample, x: 80, biome: 'grassland' }], weather: { precipitation: .12, humidity: .5, wind: .18, cloud: .2, temperature: .58 }, season: 'summer', time: 12, dayOfYear: 180, camera: { distance: 900, mode: 'walk' }, platform: 'desktop' });
const gate = buildV66ReleaseGate(runtime);
assert.equal(gate.version, 66);
assert.equal(gate.gates.deterministic, true);
assert.equal(gate.gates.noWorldMutation, true);
assert.equal(gate.gates.placementAuthority, true);
assert.equal(gate.gates.materialAuthority, true);
assert.equal(gate.gates.digest, true);
assert.equal(validateV66ReleaseGate({ ...gate, gates: { ...gate.gates, audit: true, evidence: true }, pass: true }).ok, true);
const notes = buildV66ReleaseNotes(runtime);
assert.ok(['ready', 'blocked'].includes(notes.status));
assert.ok(notes.headline.length > 20);
console.log(JSON.stringify({ ok: true, suite: 'v66-release', status: notes.status, evidence: gate.ledger.evidenceScore }));
