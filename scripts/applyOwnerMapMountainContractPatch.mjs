import fs from 'node:fs';

const fixturePath = 'fixtures/world-reference-mountain-relief-v1.json';
const checkerPath = 'scripts/checkWorldReferenceMountainRelief.mjs';

let fixture = fs.readFileSync(fixturePath, 'utf8');
fixture = fixture.replace(
  '"policyId": "owner-map-live-mountain-relief-2026-08-17-v3"',
  '"policyId": "owner-map-live-mountain-relief-2026-08-20-v4"',
);
fs.writeFileSync(fixturePath, fixture);

let checker = fs.readFileSync(checkerPath, 'utf8');
const anchor = "\t'eastern-chain': 350,\n";
if (!checker.includes("'frostfangs': 300")) {
  if (!checker.includes(anchor)) throw new Error('minimum peak table anchor missing');
  checker = checker.replace(anchor, `${anchor}\t'frostfangs': 300,\n\t'painted-mountains': 120,\n\t'jogos-spine': 180,\n`);
  fs.writeFileSync(checkerPath, checker);
}
console.log('OWNER_MAP_MOUNTAIN_V4_CONTRACT_PATCHED');
