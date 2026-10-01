import assert from 'node:assert/strict';
import {
  createWorldCoverageRuntimeSafeSnapshotV51,
  WORLD_COVERAGE_RUNTIME_SAFETY_V51,
} from '../src/3d/world/worldCoverageRuntimeSafetyV51.js';

const snapshot = createWorldCoverageRuntimeSafeSnapshotV51({
  seed: 5101,
  observations: [{
    id: 'missing-distances',
    position: { x: 0, y: 12, z: 0 },
    elevation: 12,
    slope: 0.15,
    moisture: 0.5,
    snow: 0,
    distance: 100,
    horizonOcclusion: 0,
  }],
});

assert.equal(WORLD_COVERAGE_RUNTIME_SAFETY_V51.farDistanceSentinel, 1_000_000_000);
assert.equal(snapshot.placement.eligible, 1);
assert.equal(snapshot.placement['blocked-water'], 0);
assert.equal(snapshot.placement['blocked-road'], 0);
assert.equal(snapshot.placement['blocked-settlement'], 0);
assert.equal(snapshot.sourceTruncated, false);
console.log(`WORLD_COVERAGE_RUNTIME_SAFETY_V51_OK digest=${snapshot.digest}`);
