#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../src/3d/gameplay/creatureSpawner.js', import.meta.url), 'utf8');

function extractObject(name) {
  const marker = `export const ${name} = Object.freeze(`;
  const start = source.indexOf(marker);
  assert.ok(start >= 0, `${name} must exist`);
  const open = source.indexOf('(', start + marker.length - 1);
  let depth = 0;
  let close = -1;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '(') depth += 1;
    else if (source[i] === ')') {
      depth -= 1;
      if (depth === 0) { close = i; break; }
    }
  }
  return new Function(`return ${source.slice(open + 1, close)};`)();
}

function extractFunction(name) {
  const start = source.indexOf(`export function ${name}`);
  assert.ok(start >= 0, `${name} must exist`);
  const signatureEnd = source.indexOf(') {', start);
  assert.ok(signatureEnd >= 0, `${name} signature must terminate with ) {`);
  const brace = signatureEnd + 2;
  let depth = 0;
  let end = -1;
  for (let i = brace; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) { end = i + 1; break; }
    }
  }
  assert.ok(end > brace, `${name} body must close`);
  return source.slice(start, end).replace(/^export\s+/, '');
}

const radii = extractObject('CREATURE_SPAWN_CLEARANCE_RADIUS_METERS');
const isCreatureSpawnClear = new Function(
  'CREATURE_SPAWN_CLEARANCE_RADIUS_METERS',
  `${extractFunction('isCreatureSpawnClear')}; return isCreatureSpawnClear;`,
)(radii);

for (const [speciesId, radius] of Object.entries(radii)) {
  assert.ok(Number.isFinite(radius) && radius > 0 && radius <= 1.5, `${speciesId} clearance radius must be a bounded physical-metre value`);
}
assert.ok(radii.fil > radii.at && radii.at > radii.koyun && radii.koyun > radii.tavsan,
  'clearance radii must roughly preserve body-size ordering');

assert.equal(isCreatureSpawnClear('koyun', 0.7, 0, [{ speciesId: 'koyun', x: 0, z: 0 }]), false,
  'two sheep must not interpenetrate inside their summed body-clearance radius');
assert.equal(isCreatureSpawnClear('koyun', 0.9, 0, [{ speciesId: 'koyun', x: 0, z: 0 }]), true,
  'nearby sheep must still be allowed once physical clearance is satisfied');
assert.equal(isCreatureSpawnClear('inek', 1.0, 0, [{ speciesId: 'koyun', x: 0, z: 0 }]), false,
  'mixed herd species must use symmetric summed clearance');
assert.equal(isCreatureSpawnClear('inek', 1.2, 0, [{ speciesId: 'koyun', x: 0, z: 0 }]), true,
  'mixed species remain placeable beyond summed clearance');
assert.equal(isCreatureSpawnClear('bilinmeyen', 0.6, 0, [{ speciesId: 'bilinmeyen', x: 0, z: 0 }]), false,
  'unknown future species must receive a conservative fallback radius');

assert.match(source, /isCreatureSpawnClear\(speciesId, x, z, spawns\)/,
  'scatterCreatures must enforce body clearance before accepting a spawn');
assert.ok(source.indexOf('isCreatureSpawnClear(speciesId, x, z, spawns)') < source.indexOf('isCreaturePredatorSpawnSeparated(speciesId, x, z, spawns)'),
  'generic body clearance must run before predator-specific ecology buffers');
assert.equal(source.includes('EditorMaterialStudio'), false, 'runtime spawner must not import editor material UI');

console.log('CREATURE_SPAWN_CLEARANCE_PASS', JSON.stringify({
  species: Object.keys(radii).length,
  sheepMinimumPairMeters: radii.koyun * 2,
  cowSheepMinimumPairMeters: radii.inek + radii.koyun,
  elephantRadiusMeters: radii.fil,
  symmetricMixedSpecies: true,
}));
