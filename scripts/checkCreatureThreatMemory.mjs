#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../src/3d/gameplay/livingWorldSpawner.js', import.meta.url), 'utf8');

function extractFunction(name) {
  const exportMarker = source.indexOf(`export function ${name}`);
  const plainMarker = source.indexOf(`function ${name}`);
  const start = exportMarker >= 0 ? exportMarker : plainMarker;
  assert.ok(start >= 0, `${name} must exist`);
  const openParen = source.indexOf('(', start);
  let parenDepth = 0;
  let closeParen = -1;
  for (let i = openParen; i < source.length; i += 1) {
    if (source[i] === '(') parenDepth += 1;
    else if (source[i] === ')') {
      parenDepth -= 1;
      if (parenDepth === 0) { closeParen = i; break; }
    }
  }
  const brace = source.indexOf('{', closeParen);
  let depth = 0;
  let end = -1;
  for (let i = brace; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) { end = i + 1; break; }
    }
  }
  assert.ok(closeParen > openParen && end > brace, `${name} must have a complete body`);
  return source.slice(start, end).replace(/^export\s+/, '');
}

const wrapCreatureWithThreatMemory = new Function(
  `${extractFunction('wrapCreatureWithThreatMemory')}; return wrapCreatureWithThreatMemory;`,
)();

function makeCreature() {
  const object3D = { position: { x: 0, y: 0, z: 0 }, userData: {} };
  let fleeing = false;
  let disposed = false;
  return {
    object3D,
    get isFleeing() { return fleeing; },
    update(delta, playerPosition) {
      if (!playerPosition) { fleeing = false; return; }
      const dx = object3D.position.x - playerPosition.x;
      const dz = object3D.position.z - playerPosition.z;
      const distance = Math.hypot(dx, dz);
      fleeing = distance < 8;
      if (!fleeing) return;
      const safeDistance = Math.max(distance, 1e-6);
      object3D.position.x += dx / safeDistance * 4 * delta;
      object3D.position.z += dz / safeDistance * 4 * delta;
    },
    dispose() { disposed = true; },
    get disposed() { return disposed; },
  };
}

const inner = makeCreature();
const wrapped = wrapCreatureWithThreatMemory(inner, {
  triggerRadiusMeters: 8,
  reactiveDirection: 'away',
  memorySeconds: 1.25,
});
const dt = 1 / 60;
wrapped.update(dt, { x: 0, z: 4 });
assert.equal(wrapped.isFleeing, true, 'direct nearby threat must enter flee immediately');
assert.equal(inner.object3D.userData.creatureThreat.phase, 'flee');
const afterDirect = inner.object3D.position.z;

wrapped.update(dt, { x: 0, z: 30 });
assert.equal(wrapped.isFleeing, true, 'crossing the exact trigger boundary must retain bounded flee memory');
assert.equal(inner.object3D.userData.creatureThreat.phase, 'recover');
assert.ok(inner.object3D.position.z < afterDirect, 'memory phase must continue moving away along the last threat heading');

for (let i = 0; i < 90; i += 1) wrapped.update(dt, { x: 0, z: 30 });
assert.equal(wrapped.isFleeing, false, 'threat memory must expire instead of becoming permanent flee');
assert.equal(inner.object3D.userData.creatureThreat.phase, 'roam');
assert.equal(inner.object3D.userData.creatureThreat.memoryRemainingSeconds, 0);

const friendlyInner = makeCreature();
const friendly = wrapCreatureWithThreatMemory(friendlyInner, {
  triggerRadiusMeters: 10,
  reactiveDirection: 'toward',
  memorySeconds: 1.25,
});
friendly.update(dt, { x: 0, z: 4 });
friendly.update(dt, { x: 0, z: 30 });
assert.equal(friendly.isFleeing, false, 'approach-friendly species must not inherit wildlife flee memory');
assert.equal(friendlyInner.object3D.userData.creatureThreat.memoryRemainingSeconds, 0);

wrapped.dispose();
assert.equal(inner.disposed, true, 'wrapper must preserve dispose contract');

assert.match(source, /CREATURE_BEHAVIOR_PROFILES\[speciesId\]/, 'shipped wiring must use the authored species behavior profile');
assert.match(source, /wrapCreatureWithThreatMemory\(creature,[\s\S]*wrapCreatureWithSimulationLod\(threatAwareCreature/,
  'threat memory must wrap the creature before simulation LOD so memory remains an urgent signal');
assert.match(source, /memorySeconds:\s*1\.25/, 'shipped threat memory must stay explicitly bounded');
assert.match(source, /reactiveDirection:\s*profile\?\.reactiveDirection/, 'friendly and away-reactive species must preserve authored direction semantics');
assert.equal(source.includes('EditorMaterialStudio'), false, 'living-world runtime must not import editor material UI');

console.log('CREATURE_THREAT_MEMORY_PASS', JSON.stringify({
  directFlee: true,
  boundedRecoverySeconds: 1.25,
  returnsToRoam: true,
  friendlyUnaffected: true,
  urgentBeforeLod: true,
}));
