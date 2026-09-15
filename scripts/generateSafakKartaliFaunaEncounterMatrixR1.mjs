import fs from 'node:fs';
import { FAUNA_ENCOUNTER_SPECIES } from '../src/3d/gameplay/livingWorldFaunaEncounterDirector.js';

const behaviors = ['calm', 'graze', 'roam', 'herd', 'flee', 'investigate', 'return', 'alert'];
const rows = [];
let caseId = 0;
for (const species of FAUNA_ENCOUNTER_SPECIES) {
  for (const behavior of behaviors) {
    for (let threat = 0; threat < 8; threat += 1) {
      for (let distance = 0; distance < 8; distance += 1) {
        rows.push(`${String(caseId).padStart(4, '0')}|${species}|${behavior}|${threat}|${distance}`);
        caseId += 1;
      }
    }
  }
}
if (rows.length !== 4096) throw new Error(`expected 4096 rows, got ${rows.length}`);
fs.mkdirSync('artifacts/safak-kartali-fauna-encounter-r1', { recursive: true });
for (let shard = 0; shard < 8; shard += 1) {
  const start = shard * 512;
  const path = `artifacts/safak-kartali-fauna-encounter-r1/part-${String(shard + 1).padStart(2, '0')}.matrix`;
  fs.writeFileSync(path, `${rows.slice(start, start + 512).join('\n')}\n`);
}
console.log(`wrote ${rows.length} unique encounter cases across 8 matrix shards`);
