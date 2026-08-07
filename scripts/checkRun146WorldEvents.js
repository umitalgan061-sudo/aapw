#!/usr/bin/env node
/** Regression guard for Run 146's three FAZ 8 world-event additions. */
const fs = require('fs');

const source = fs.readFileSync('src/3d/gameplay/worldEvents.js', 'utf8');
const expected = [
  { id: 'sealed_courier', timeOfDay: null, weight: 'UNCOMMON' },
  { id: 'training_yard_drill', timeOfDay: 'day', weight: 'COMMON' },
  { id: 'graveyard_vigil', timeOfDay: 'night', weight: 'RARE' },
];

const failures = [];
for (const entry of expected) {
  const line = source.split('\n').find((candidate) => candidate.includes(`id: '${entry.id}'`));
  if (!line) {
    failures.push(`${entry.id}: missing`);
    continue;
  }
  if (!line.includes(`weight: WEIGHT.${entry.weight}`)) {
    failures.push(`${entry.id}: expected WEIGHT.${entry.weight}`);
  }
  const timeMatch = line.match(/timeOfDay:\s*'([^']+)'/);
  const actualTime = timeMatch ? timeMatch[1] : null;
  if (actualTime !== entry.timeOfDay) {
    failures.push(`${entry.id}: expected timeOfDay=${entry.timeOfDay}, got ${actualTime}`);
  }
  for (const field of ['icon:', 'title:', 'desc:', 'color:']) {
    if (!line.includes(field)) failures.push(`${entry.id}: missing ${field.slice(0, -1)}`);
  }
}

if (!source.includes('// Run 146 live count: 17 of 52 entries are time-gated.')) {
  failures.push('Run 146 live-count comment missing');
}

if (failures.length) {
  console.error(`[checkRun146WorldEvents] FAIL: ${failures.length} issue(s)`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log('[checkRun146WorldEvents] PASS: 3 new events present; night/day/ungated contracts preserved.');
