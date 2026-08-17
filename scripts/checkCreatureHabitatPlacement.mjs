#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../src/3d/gameplay/creatureSpawner.js', import.meta.url), 'utf8');

function extractFunction(name) {
  const marker = source.indexOf(`function ${name}`);
  const exportMarker = source.indexOf(`export function ${name}`);
  const start = exportMarker >= 0 ? exportMarker : marker;
  assert.ok(start >= 0, `${name} must exist in creatureSpawner.js`);
  const brace = source.indexOf('{', start);
  let depth = 0;
  let end = -1;
  for (let i = brace; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) { end = i + 1; break; }
    }
  }
  assert.ok(end > brace, `${name} must have a complete body`);
  return source.slice(start, end).replace(/^export\s+/, '');
}

function extractConst(name) {
  const exportMarker = `export const ${name} =`;
  const marker = `const ${name} =`;
  let start = source.indexOf(exportMarker);
  let prefixLength = exportMarker.length;
  if (start < 0) {
    start = source.indexOf(marker);
    prefixLength = marker.length;
  }
  assert.ok(start >= 0, `${name} must exist in creatureSpawner.js`);
  const valueStart = start + prefixLength;
  let parenDepth = 0;
  let braceDepth = 0;
  let bracketDepth = 0;
  let quote = null;
  let escaped = false;
  let end = -1;
  for (let i = valueStart; i < source.length; i += 1) {
    const ch = source[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '(') parenDepth += 1;
    else if (ch === ')') parenDepth -= 1;
    else if (ch === '{') braceDepth += 1;
    else if (ch === '}') braceDepth -= 1;
    else if (ch === '[') bracketDepth += 1;
    else if (ch === ']') bracketDepth -= 1;
    else if (ch === ';' && parenDepth === 0 && braceDepth === 0 && bracketDepth === 0) { end = i + 1; break; }
  }
  assert.ok(end > valueStart, `${name} must have a complete initializer`);
  return `const ${name} =${source.slice(valueStart, end)}`;
}

const runtime = new Function(`
  ${extractConst('CREATURE_HABITAT_RULES')}
  ${extractConst('DESKTOP_SPECIES_COUNTS')}
  ${extractConst('MOBILE_SPECIES_COUNTS')}
  ${extractFunction('nearestSeatDistanceMeters')}
  ${extractFunction('isCreatureHabitatCompatible')}
  return { CREATURE_HABITAT_RULES, DESKTOP_SPECIES_COUNTS, MOBILE_SPECIES_COUNTS, isCreatureHabitatCompatible };
`)();

const { CREATURE_HABITAT_RULES, DESKTOP_SPECIES_COUNTS, MOBILE_SPECIES_COUNTS, isCreatureHabitatCompatible } = runtime;
const seats = [{ id: 'winterfell', x: 0, z: 0 }, { id: 'dragonstone', x: 2000, z: 0 }];
const flat = () => 140;
const seaLevelMeters = 40;

assert.equal(isCreatureHabitatCompatible('kedi', 200, 0, { sampleHeightMeters: flat, seaLevelMeters, seats }), true,
  'domestic cat should fit settlement hinterland');
assert.equal(isCreatureHabitatCompatible('kedi', 900, 0, { sampleHeightMeters: flat, seaLevelMeters, seats }), false,
  'domestic cat must not scatter far outside settlement hinterland');
assert.equal(isCreatureHabitatCompatible('geyik', 80, 0, { sampleHeightMeters: flat, seaLevelMeters, seats }), false,
  'wild deer must not spawn beside a keep');
assert.equal(isCreatureHabitatCompatible('geyik', 400, 0, { sampleHeightMeters: flat, seaLevelMeters, seats }), true,
  'wild deer should fit grounded hinterland beyond keep exclusion');
assert.equal(isCreatureHabitatCompatible('ayi', 500, 0, { sampleHeightMeters: () => 80, seaLevelMeters, seats }), false,
  'bear must reject terrain below its authored highland floor');
assert.equal(isCreatureHabitatCompatible('ayi', 500, 0, { sampleHeightMeters: () => 220, seaLevelMeters, seats }), true,
  'bear should accept elevated terrain away from settlements');
assert.equal(isCreatureHabitatCompatible('zurafa', 600, 0, { sampleHeightMeters: () => 700, seaLevelMeters, seats }), false,
  'giraffe must reject terrain above its lowland ceiling');
assert.equal(isCreatureHabitatCompatible('kuzgun', 5000, 5000, { sampleHeightMeters: flat, seaLevelMeters, seats }), true,
  'unconstrained birds must retain canonical placement behavior');
assert.equal(isCreatureHabitatCompatible('kedi', 200, 0, { sampleHeightMeters: null, seaLevelMeters, seats }), false,
  'habitat-constrained species must fail closed without canonical height sampling');

for (const [speciesId, rule] of Object.entries(CREATURE_HABITAT_RULES)) {
  assert.ok(Object.isFrozen(rule), `${speciesId} habitat rule must be immutable`);
  if (rule.minSeatDistanceMeters != null && rule.maxSeatDistanceMeters != null) {
    assert.ok(rule.maxSeatDistanceMeters > rule.minSeatDistanceMeters, `${speciesId} seat envelope must be non-empty`);
  }
  if (rule.minElevationAboveSeaMeters != null && rule.maxElevationAboveSeaMeters != null) {
    assert.ok(rule.maxElevationAboveSeaMeters > rule.minElevationAboveSeaMeters, `${speciesId} elevation envelope must be non-empty`);
  }
}

const desktopTotal = Object.values(DESKTOP_SPECIES_COUNTS).reduce((sum, count) => sum + count, 0);
const mobileTotal = Object.values(MOBILE_SPECIES_COUNTS).reduce((sum, count) => sum + count, 0);
assert.equal(desktopTotal, 80, 'existing desktop fauna budget must remain capped at 80');
assert.equal(mobileTotal, 12, 'existing mobile fauna budget must remain capped at 12');
assert.match(source, /isPlaceablePosition\(x, z, \{ sampleHeightMeters, seaLevelMeters, seats, roadEdges \}\)/,
  'scatter must retain canonical water/slope/settlement/road physical gate before habitat filtering');
assert.match(source, /MAX_ATTEMPTS_PER_CREATURE = 10/, 'creature rejection search must remain bounded');
assert.equal(source.includes('EditorMaterialStudio'), false, 'fauna placement runtime must not import editor material UI');

console.log('CREATURE_HABITAT_PLACEMENT_PASS', JSON.stringify({
  habitatRuleCount: Object.keys(CREATURE_HABITAT_RULES).length,
  desktopBudget: desktopTotal,
  mobileBudget: mobileTotal,
  canonicalPhysicalGatePreserved: true,
  boundedAttempts: 10,
  settlementEnvelopeBounded: true,
  elevationEnvelopeBounded: true,
  runtimeDependencyFreeAcceptance: true,
}));
