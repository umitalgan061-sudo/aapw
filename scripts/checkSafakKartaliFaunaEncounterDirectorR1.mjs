import fs from 'node:fs';
import {
  auditFaunaEncounterResult,
  classifyFaunaEncounterCase,
  createFaunaEncounterDirector,
  FAUNA_ENCOUNTER_ACTIONS,
  FAUNA_ENCOUNTER_LIMITS,
  FAUNA_ENCOUNTER_SPECIES,
} from '../src/3d/gameplay/livingWorldFaunaEncounterDirector.js';

const matrixDir = 'artifacts/safak-kartali-fauna-encounter-r1';
const files = fs.readdirSync(matrixDir).filter((name) => /^part-\d{2}\.matrix$/.test(name)).sort();
if (files.length !== 8) throw new Error(`matrix shard count ${files.length} !== 8`);
const ids = new Set();
let rowCount = 0;
for (const file of files) {
  const lines = fs.readFileSync(`${matrixDir}/${file}`, 'utf8').trim().split('\n').filter(Boolean);
  if (lines.length !== 512) throw new Error(`${file} row count ${lines.length} !== 512`);
  for (const line of lines) {
    const [rawCase, species, behavior, rawThreat, rawDistance, action, tier, rawUrgency] = line.split('|');
    const rowCase = Number(rawCase);
    const threat = Number(rawThreat);
    const distance = Number(rawDistance);
    if (ids.has(rowCase)) throw new Error(`duplicate case ${rowCase}`);
    ids.add(rowCase);
    if (rowCase !== rowCount) throw new Error(`non-contiguous case ${rowCase}, expected ${rowCount}`);
    if (!FAUNA_ENCOUNTER_SPECIES.includes(species)) throw new Error(`unknown species ${species}`);
    if (!Number.isInteger(threat) || threat < 0 || threat > 7) throw new Error(`invalid threat ${threat}`);
    if (!Number.isInteger(distance) || distance < 0 || distance > 7) throw new Error(`invalid distance ${distance}`);
    if (!FAUNA_ENCOUNTER_ACTIONS.includes(action)) throw new Error(`invalid action ${action}`);
    const expected = classifyFaunaEncounterCase({ species, habitat: 'forest', behavior, threat, distance });
    if (expected.action !== action || expected.tier !== tier || expected.urgency.toFixed(6) !== rawUrgency) {
      throw new Error(`expected mismatch at case ${rowCase}`);
    }
    rowCount += 1;
  }
}
if (rowCount !== 4096 || ids.size !== 4096) throw new Error(`matrix coverage ${rowCount}/${ids.size} != 4096`);

const candidates = Array.from({ length: 32 }, (_, index) => ({
  id: `fixture-${index.toString().padStart(2, '0')}`,
  species: FAUNA_ENCOUNTER_SPECIES[index % FAUNA_ENCOUNTER_SPECIES.length],
  habitat: index % 2 ? 'meadow' : 'forest',
  playerDistance: index,
  threat: (index % 8) / 7,
  habitatFit: (index % 10) / 9,
  energy: 1 - ((index % 9) / 10),
  socialCount: index % 11,
  recentThreat: index % 5,
  anchorDistance: index % 13,
  active: true,
}));
const first = createFaunaEncounterDirector();
const second = createFaunaEncounterDirector();
const runA = first.evaluate(candidates, { weather: 'clear', timeBucket: 4 });
const runB = second.evaluate(candidates, { weather: 'clear', timeBucket: 4 });
const audit = auditFaunaEncounterResult(runA);
if (!audit.ok) throw new Error(`result audit failed: ${audit.issues.join(',')}`);
if (!runA.directives.every((directive) => FAUNA_ENCOUNTER_ACTIONS.includes(directive.action))) throw new Error('invalid directive action');
const orderA = runA.directives.map((directive) => directive.id).join('|');
const orderB = runB.directives.map((directive) => directive.id).join('|');
if (runA.digest !== runB.digest || orderA !== orderB) throw new Error('determinism failure');
first.dispose();
let disposedRejected = false;
try { first.evaluate(candidates); } catch (error) { disposedRejected = /disposed/.test(String(error?.message)); }
if (!disposedRejected) throw new Error('disposed runtime accepted a tick');
if (FAUNA_ENCOUNTER_LIMITS.maxCandidates !== 64 || FAUNA_ENCOUNTER_LIMITS.maxDirectives !== 24) throw new Error('limits contract drift');
console.log(`PASS: ${rowCount} matrix cases across ${files.length} shards, deterministic replay, audit and disposal guard`);
