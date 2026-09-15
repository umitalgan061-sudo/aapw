import fs from 'node:fs';
import { classifyFaunaEncounterCase, FAUNA_ENCOUNTER_SPECIES } from '../src/3d/gameplay/livingWorldFaunaEncounterDirector.js';

const out = 'artifacts/safak-kartali-fauna-encounter-matrix-r1.jsonl';
const behaviors = ['calm', 'graze', 'roam', 'herd', 'flee', 'investigate', 'return', 'alert'];
const rows = [];
let caseId = 0;
for (const species of FAUNA_ENCOUNTER_SPECIES) {
  for (const behavior of behaviors) {
    for (let threat = 0; threat < 8; threat += 1) {
      for (let distance = 0; distance < 8; distance += 1) {
        const expected = classifyFaunaEncounterCase({ species, habitat: 'forest', behavior, threat, distance });
        rows.push(`${String(caseId).padStart(4, '0')}|${species}|${behavior}|${threat}|${distance}|${expected.action}|${expected.tier}|${expected.urgency.toFixed(6)}`);
        caseId += 1;
      }
    }
  }
}
if (rows.length !== 4096) throw new Error(`expected 4096 rows, got ${rows.length}`);
fs.mkdirSync('artifacts', { recursive: true });
fs.writeFileSync(out, `${rows.join('\n')}\n`);
console.log(`wrote ${rows.length} deterministic compact cases to ${out}`);
