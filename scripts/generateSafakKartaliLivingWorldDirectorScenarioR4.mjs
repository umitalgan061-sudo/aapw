import fs from 'node:fs';
import path from 'node:path';

const OUTPUT = path.join(process.cwd(), 'artifacts', 'safak-kartali-living-world-director-scenario-r4-cases.jsonl');
const roles = Object.freeze(['guard','merchant','healer','courier','farmer','hunter','blacksmith','innkeeper','scholar','scout','ranger','fisher','priest','noble','farrier','watcher']);
const contexts = Object.freeze(['quiet','day','dusk','night','market','road','forest','river','shore','village','town','frontier','storm','festival','combat','siege']);
const bands = Object.freeze([0, 0.25, 0.5, 0.75]);
const lines = [JSON.stringify({ schema: 'aapw-living-world-director-scenario-r4-cases', version: 4, cases: 4096, roleCount: roles.length, contextCount: contexts.length, dimensions: ['role','context','urgency','threat'] })];
let index = 0;
for (let roleIndex = 0; roleIndex < roles.length; roleIndex += 1) {
  for (let contextIndex = 0; contextIndex < contexts.length; contextIndex += 1) {
    for (let urgencyIndex = 0; urgencyIndex < bands.length; urgencyIndex += 1) {
      for (let threatIndex = 0; threatIndex < bands.length; threatIndex += 1) {
        lines.push(JSON.stringify({
          caseId: `r4-${String(index).padStart(4, '0')}`,
          index,
          role: roles[roleIndex],
          context: contexts[contextIndex],
          urgency: bands[urgencyIndex],
          threat: bands[threatIndex],
          socialNeed: bands[(roleIndex + contextIndex + urgencyIndex) % 4],
          scarcity: bands[(roleIndex + contextIndex * 2 + threatIndex) % 4],
          fatigue: Number((((roleIndex * 3 + contextIndex + urgencyIndex) * 0.07) % 1).toFixed(6)),
          travelRisk: Number((((contextIndex * 5 + roleIndex + threatIndex) * 0.09) % 1).toFixed(6)),
          distanceMeters: 20 + ((index * 131) % 4980),
          waitingSeconds: (index * 11) % 121,
        }));
        index += 1;
      }
    }
  }
}
if (index !== 4096) throw new Error(`scenario corpus size mismatch: ${index}`);
fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
fs.writeFileSync(OUTPUT, `${lines.join('\\n')}\\n`, 'utf8');
console.log(JSON.stringify({ ok: true, rows: lines.length, cases: index, output: OUTPUT }));
