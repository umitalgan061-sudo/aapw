#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createCircleCollider } from '../src/3d/physics.js';
import {
  NATURAL_GEOLOGY_COLLISION_POLICY,
  createNaturalGeologyCollisionCircles,
  summarizeNaturalGeologyCollision,
} from '../src/3d/world/naturalGeologyCollision.js';

const P = NATURAL_GEOLOGY_COLLISION_POLICY;
assert.equal(P.geographyAuthorityUnchanged, true);
assert.equal(P.terrainHeightAuthorityUnchanged, true);
assert.equal(P.canonicalHydrologyUnchanged, true);
assert.equal(P.approximateHorizontalOnly, true);
assert(P.inscribedRadiusFraction < 0.5);
assert(P.maximumRadiusMeters <= 10);

const placements = Object.freeze([
  Object.freeze({ id: 'scarp-large', kind: 'fractured-scarp', x: 10, z: 20, scale: Object.freeze({ x: 28, y: 18, z: 12 }) }),
  Object.freeze({ id: 'bedrock-large', kind: 'bedrock', x: -42, z: 8, scale: Object.freeze({ x: 16, y: 9, z: 10 }) }),
  Object.freeze({ id: 'asset-large', kind: 'asset-proxy', x: 85, z: -33, scale: Object.freeze({ x: 22, y: 13, z: 17 }) }),
  Object.freeze({ id: 'scarp-too-flat', kind: 'fractured-scarp', x: 2, z: 3, scale: Object.freeze({ x: 20, y: 2.5, z: 12 }) }),
  Object.freeze({ id: 'bedrock-too-narrow', kind: 'bedrock', x: 3, z: 4, scale: Object.freeze({ x: 18, y: 9, z: 2.4 }) }),
  Object.freeze({ id: 'walkable-low', kind: 'low-outcrop', x: 5, z: 6, scale: Object.freeze({ x: 30, y: 8, z: 18 }) }),
  Object.freeze({ id: 'walkable-talus', kind: 'talus', x: 7, z: 8, scale: Object.freeze({ x: 14, y: 12, z: 10 }) }),
  Object.freeze({ id: 'walkable-boulder', kind: 'boulder', x: 9, z: 10, scale: Object.freeze({ x: 12, y: 12, z: 12 }) }),
]);

const snapshot = JSON.stringify(placements);
const circles = createNaturalGeologyCollisionCircles(placements);
assert.equal(JSON.stringify(placements), snapshot, 'collision derivation mutated authoritative placements');
assert.equal(circles.length, 3, `expected exactly three large blockers, got ${circles.length}`);
assert.deepEqual(circles.map((circle) => circle.sourcePlacementId), ['scarp-large', 'bedrock-large', 'asset-large']);

for (const circle of circles) {
  const placement = placements.find((candidate) => candidate.id === circle.sourcePlacementId);
  const minorHorizontal = Math.min(placement.scale.x, placement.scale.z);
  assert(circle.radius >= P.minimumRadiusMeters - 1e-12);
  assert(circle.radius <= P.maximumRadiusMeters + 1e-12);
  assert(circle.radius < minorHorizontal * 0.5,
    `${circle.sourcePlacementId} blocker escaped visible minor footprint: ${circle.radius}/${minorHorizontal}`);
}

const collider = createCircleCollider(circles, 0.4);
for (const circle of circles) {
  const centerResolved = collider.resolveXZ(circle.x, circle.z);
  const centerDistance = Math.hypot(centerResolved.x - circle.x, centerResolved.z - circle.z);
  assert(centerDistance >= circle.radius + 0.4 - 1e-9,
    `${circle.sourcePlacementId} center penetration did not resolve`);

  const outside = {
    x: circle.x + circle.radius + 0.4 + 0.25,
    z: circle.z,
  };
  assert.deepEqual(collider.resolveXZ(outside.x, outside.z), outside,
    `${circle.sourcePlacementId} collider created an invisible outer wall`);
}

const summary = summarizeNaturalGeologyCollision(placements);
assert.equal(summary.blockerCount, circles.length);
assert.equal(summary.byKind['fractured-scarp'], 1);
assert.equal(summary.byKind.bedrock, 1);
assert.equal(summary.byKind['asset-proxy'], 1);
assert(summary.maximumRadiusMeters <= P.maximumRadiusMeters);

console.log('[checkNaturalGeologyCollision] PASS');
console.log(JSON.stringify({
  policyId: P.id,
  blockerCount: circles.length,
  blockers: circles,
  summary,
  walkableKindsExcluded: ['low-outcrop', 'talus', 'boulder'],
}, null, 2));
