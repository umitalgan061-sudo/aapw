#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../src/3d/gameplay/livingWorldSpawner.js', import.meta.url), 'utf8');

function extractFunction(name) {
  const marker = source.indexOf(`function ${name}`);
  const exportMarker = source.indexOf(`export function ${name}`);
  const start = exportMarker >= 0 ? exportMarker : marker;
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

const defaultsMatch = source.match(/export const NPC_GUARD_LEASH_DEFAULTS = Object\.freeze\(\{\s*leashRadiusMeters: (\d+),\s*rejoinRadiusMeters: (\d+),/);
assert.ok(defaultsMatch, 'guard leash defaults must be explicit and immutable');
const defaults = { leashRadiusMeters: Number(defaultsMatch[1]), rejoinRadiusMeters: Number(defaultsMatch[2]) };
assert.equal(defaults.leashRadiusMeters, 36);
assert.equal(defaults.rejoinRadiusMeters, 24);
assert.ok(defaults.rejoinRadiusMeters < defaults.leashRadiusMeters, 'rejoin radius must provide hysteresis');

const wrap = new Function(`
  const NPC_GUARD_LEASH_DEFAULTS = ${JSON.stringify(defaults)};
  ${extractFunction('finitePositive')}
  ${extractFunction('wrapNpcWithHomeLeash')}
  return wrapNpcWithHomeLeash;
`)();

function makeNpc() {
  const calls = [];
  const object3D = {
    position: { x: 0, z: 0 },
    userData: {
      npcPerception: { intent: 'combat', reason: 'vision', lineOfSight: true, heard: false, assisted: false },
      combatStanceBlend: 1,
    },
  };
  return {
    calls,
    npc: {
      object3D,
      displayName: 'test guard',
      update(_delta, playerPosition) {
        calls.push(playerPosition ? { ...playerPosition } : null);
        if (!playerPosition) {
          const distance = Math.hypot(object3D.position.x, object3D.position.z);
          if (distance > 0) {
            const step = Math.min(6, distance);
            object3D.position.x -= object3D.position.x / distance * step;
            object3D.position.z -= object3D.position.z / distance * step;
          }
        }
      },
      dispose() { calls.push('dispose'); },
    },
  };
}

const fixture = makeNpc();
const leashed = wrap(fixture.npc);
leashed.update(1 / 60, { x: 8, z: 0 });
assert.deepEqual(fixture.calls.at(-1), { x: 8, z: 0 }, 'inside-home player must preserve normal perception update');
assert.equal(leashed.object3D.userData.npcLeash.returning, false);

leashed.object3D.position.x = 37;
leashed.update(1 / 60, { x: 40, z: 0 });
assert.equal(fixture.calls.at(-1), null, 'outside-leash guard must suppress player sensing and return');
assert.equal(leashed.object3D.userData.npcLeash.returning, true);
assert.equal(leashed.object3D.userData.npcPerception.intent, 'return');
assert.equal(leashed.object3D.userData.npcPerception.reason, 'leash');
assert.equal(leashed.object3D.userData.npcPerception.lineOfSight, false, 'leash return must invalidate stale combat LOS');

for (let i = 0; i < 8; i += 1) leashed.update(1 / 60, { x: 40, z: 0 });
assert.equal(leashed.object3D.userData.npcLeash.returning, true, 'far player must not immediately reacquire a returning guard');
assert.ok(leashed.object3D.userData.npcLeash.homeDistanceMeters <= defaults.rejoinRadiusMeters, 'existing controller must be allowed to return inside rejoin envelope');

leashed.update(1 / 60, { x: 10, z: 0 });
assert.equal(leashed.object3D.userData.npcLeash.returning, false, 'guard may reacquire only after both guard and player are back inside rejoin envelope');
assert.deepEqual(fixture.calls.at(-1), { x: 10, z: 0 });

const boundedFixture = makeNpc();
const bounded = wrap(boundedFixture.npc, { leashRadiusMeters: 4, rejoinRadiusMeters: 1000 });
bounded.update(1 / 60, { x: 1, z: 0 });
assert.equal(bounded.object3D.userData.npcLeash.leashRadiusMeters, 28, 'leash must have a safe lower bound');
assert.equal(bounded.object3D.userData.npcLeash.rejoinRadiusMeters, 24, 'rejoin radius must remain below bounded leash');

assert.match(source, /const leashAwareNpc = wrapNpcWithHomeLeash\(npc\);\s*return wrapNpcWithCombatDamage\(leashAwareNpc,/,
  'shipped NPCs must apply leash before combat damage arbitration');
assert.equal(source.includes('EditorMaterialStudio'), false, 'living-world runtime must not import editor material UI');

console.log('NPC_GUARD_LEASH_PASS', JSON.stringify({
  ...defaults,
  staleCombatSuppressed: true,
  hysteresis: true,
  shippedBeforeDamage: true,
}));
