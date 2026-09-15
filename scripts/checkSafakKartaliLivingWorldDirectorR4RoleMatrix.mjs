import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.join(process.cwd(), 'artifacts', 'safak-kartali-living-world-director-r4-matrix');
const expected = Object.freeze([
  'guard.matrix',
  'merchant.matrix',
  'healer.matrix',
  'courier-farmer.matrix',
  'hunter-blacksmith.matrix',
  'innkeeper-scholar.matrix',
  'scout-ranger.matrix',
  'fisher-priest.matrix',
  'noble-farrier.matrix',
]);
const contexts = new Set(['q', 'day', 'forest', 'combat', 'quiet', 'dusk', 'night', 'market', 'road', 'river', 'shore', 'village', 'town', 'frontier', 'storm', 'festival']);
const values = new Set([0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875]);
const seen = new Set();
const roleCounts = new Map();
let total = 0;

assert.equal(fs.existsSync(ROOT), true);
const actual = fs.readdirSync(ROOT).filter((name) => name.endsWith('.matrix')).sort();
assert.deepEqual(actual, [...expected].sort());

for (const filename of actual) {
  const source = fs.readFileSync(path.join(ROOT, filename), 'utf8').trim();
  const rows = source ? source.split(/\r?\n/) : [];
  assert.equal(rows.length, filename === 'guard.matrix' || filename === 'merchant.matrix' || filename === 'healer.matrix' ? 256 : 512);
  for (const row of rows) {
    const [caseId, role, context, urgencyText, threatText] = row.split('|');
    assert.ok(caseId && role && context);
    assert.ok(contexts.has(context));
    const urgency = Number(urgencyText);
    const threat = Number(threatText);
    assert.ok(values.has(urgency));
    assert.ok(values.has(threat));
    const identity = `${filename}|${caseId}|${role}|${context}|${urgency}|${threat}`;
    assert.equal(seen.has(identity), false, `duplicate matrix row: ${identity}`);
    seen.add(identity);
    roleCounts.set(role, (roleCounts.get(role) ?? 0) + 1);
    total += 1;
  }
}

assert.equal(total, 3840);
assert.ok(roleCounts.size >= 10);
for (const [role, count] of roleCounts) assert.ok(count >= 256, `${role} under-covered`);

const rolePairChecks = Object.freeze([
  ['courier', 'farmer'],
  ['hunter', 'blacksmith'],
  ['innkeeper', 'scholar'],
  ['scout', 'ranger'],
  ['fisher', 'priest'],
  ['noble', 'farrier'],
]);
for (const [left, right] of rolePairChecks) {
  assert.equal(roleCounts.get(left), 256);
  assert.equal(roleCounts.get(right), 256);
}

console.log(JSON.stringify({ ok: true, files: actual.length, rows: total, roles: Object.fromEntries(roleCounts) }));
