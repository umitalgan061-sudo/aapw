import assert from 'node:assert/strict';
import { buildStreamingBudgetV66, buildChunkAdmissionV66, buildVisibilityHysteresisV66, validateStreamingRuntimeV66 } from '../src/3d/world/environmentRuntimeStreamingV66.js';
import { buildV66Ledger, validateV66Ledger, buildV66ReleaseSummary } from '../src/3d/world/environmentRuntimeObservabilityV66.js';

const budget = buildStreamingBudgetV66({ platform: 'desktop', fps: 56, drawCalls: 142, triangles: 1240000, textureMb: 710, residentChunks: 8 });
assert.ok(budget.max < 1.18);
const chunks = Array.from({ length: 20 }, (_, i) => ({ id: `c${i}`, distance: i * 180, importance: i < 5 ? 0.9 : 0.4 }));
const admission = buildChunkAdmissionV66({ chunks, camera: { velocity: 24 }, budget });
const runtime = { policy: 'environment-runtime-streaming-v66-2026-09-15', deterministic: true, budget, admission };
assert.equal(validateStreamingRuntimeV66(runtime).ok, true);
assert.ok(admission.admitted.length <= admission.cap);
assert.ok(admission.deferred.length > 0);
assert.equal(buildVisibilityHysteresisV66({ previous: 'far', distance: 700, velocity: 0 }), 'mid');
assert.equal(buildVisibilityHysteresisV66({ previous: 'mid', distance: 1800, velocity: 0 }), 'far');

const mobile = buildStreamingBudgetV66({ platform: 'mobile', fps: 32, drawCalls: 88, triangles: 620000, textureMb: 590, residentChunks: 7 });
assert.ok(mobile.pressure > 0);

const ledger = buildV66Ledger({ audit: { pass: true }, streaming: { budget }, navigation: {}, sky: { skyLumaFloor: 0.12 }, deterministic: true });
assert.equal(validateV66Ledger(ledger).ok, true);
const release = buildV66ReleaseSummary({ digest: 'deadbeef', navigation: { field: chunks }, eventsRuntime: { events: admission.admitted }, audit: { pass: true }, streaming: { budget }, sky: { skyLumaFloor: 0.12 }, deterministic: true });
assert.equal(release.version, 66);
assert.match(release.digest, /^[0-9a-f]{8}$/);
console.log(JSON.stringify({ ok: true, suite: 'v66-streaming-observability', admitted: admission.admitted.length, deferred: admission.deferred.length, evidenceScore: ledger.evidenceScore }));
