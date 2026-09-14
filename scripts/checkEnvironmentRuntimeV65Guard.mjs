import assert from 'node:assert/strict';
import { evaluatePlacementGuard, evaluateFrameGuard, evaluateVisualGuard, evaluateRuntimeGuard, guardTelemetry } from '../src/3d/world/environmentRuntimeGuardV65.js';

const failures = [];
const check = (id, fn) => { try { fn(); } catch (e) { failures.push(`${id}:${e?.message || e}`); } };

check('healthy-placement', () => assert.equal(evaluatePlacementGuard({ confidence: 0.9, slope: 8, grounded: true, water: false, roadDistance: 50, settlementDistance: 80 }).allowed, true));
check('low-confidence', () => assert.equal(evaluatePlacementGuard({ confidence: 0.2 }).allowed, false));
check('steep-reject', () => assert.equal(evaluatePlacementGuard({ confidence: 0.9, slope: 60 }).allowed, false));
check('ungrounded-reject', () => assert.equal(evaluatePlacementGuard({ confidence: 0.9, grounded: false }).allowed, false));
check('water-reject', () => assert.equal(evaluatePlacementGuard({ confidence: 0.9, water: true }).allowed, false));
check('road-reject', () => assert.equal(evaluatePlacementGuard({ confidence: 0.9, roadDistance: 2 }).allowed, false));
check('settlement-reject', () => assert.equal(evaluatePlacementGuard({ confidence: 0.9, settlementDistance: 5 }).allowed, false));
check('frame-safe', () => assert.equal(evaluateFrameGuard({ max: 0.8 }).allowed, true));
check('frame-critical', () => assert.equal(evaluateFrameGuard({ max: 1.25 }).allowed, false));
check('visual-safe', () => assert.equal(evaluateVisualGuard({ p0Pass: true, meanScore: 0.84 }).allowed, true));
check('visual-p0-fail', () => assert.equal(evaluateVisualGuard({ p0Pass: false, meanScore: 0.9 }).allowed, false));
check('visual-score-fail', () => assert.equal(evaluateVisualGuard({ p0Pass: true, meanScore: 0.5 }).allowed, false));
check('runtime-healthy', () => {
  const result = evaluateRuntimeGuard({ samples: [{ confidence: 0.9, slope: 5, grounded: true, water: false, roadDistance: 30, settlementDistance: 100 }], streaming: { max: 0.82 }, visual: { p0Pass: true, meanScore: 0.86 } });
  assert.equal(result.allowed, true);
  assert.equal(guardTelemetry(result).rejectedSamples, 0);
});
check('runtime-rejects', () => {
  const result = evaluateRuntimeGuard({ samples: [{ confidence: 0.4 }], streaming: { max: 1.2 }, visual: { p0Pass: false, meanScore: 0.6 } });
  assert.equal(result.allowed, false);
  assert.ok(guardTelemetry(result).rejectedSamples > 0);
});

if (failures.length) { console.error(JSON.stringify({ ok: false, failures }, null, 2)); process.exitCode = 1; }
else console.log(JSON.stringify({ ok: true, suite: 'environment-runtime-v65-guard', checks: 14 }));
