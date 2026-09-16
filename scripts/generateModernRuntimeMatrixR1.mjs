import fs from 'node:fs';
import path from 'node:path';

const backends = ['webgpu', 'webgl2'];
const tiers = ['ultra', 'high', 'balanced', 'performance'];
const pointers = ['fine', 'coarse'];
const thermal = ['nominal', 'warm', 'hot', 'critical'];
const frameBuckets = ['8', '12', '16', '20', '28', '36', '50', '80'];
const loadBuckets = ['idle', 'light', 'normal', 'busy', 'heavy', 'burst', 'spike', 'recovery'];

const lines = [
  '# Modern runtime deterministic envelope matrix R1',
  '# backend|tier|pointer|thermal|frameMs|load|expectedBudgetClass|expectedCadenceClass|caseId',
];
let index = 0;
for (const backend of backends) {
  for (const tier of tiers) {
    for (const pointer of pointers) {
      for (const thermalState of thermal) {
        for (const frameMs of frameBuckets) {
          for (const load of loadBuckets) {
            const fps = 1000 / Number(frameMs);
            const budgetClass = Number(frameMs) >= 50 ? 'critical' : Number(frameMs) >= 28 ? 'constrained' : Number(frameMs) >= 20 ? 'guarded' : 'healthy';
            const cadenceClass = thermalState === 'critical' || load === 'spike' ? 'throttled' : pointer === 'coarse' || tier === 'performance' ? 'adaptive' : fps >= 55 ? 'full' : 'adaptive';
            const expected = `${backend}|${tier}|${pointer}|${thermalState}|${frameMs}|${load}|${budgetClass}|${cadenceClass}|MR1-${String(index).padStart(4, '0')}`;
            lines.push(expected);
            index += 1;
          }
        }
      }
    }
  }
}
if (index !== 4096) throw new Error(`expected 4096 cases, got ${index}`);
const output = path.resolve('artifacts/modern-runtime-r1/modern-runtime-envelope.matrix');
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${lines.join('\n')}\n`, 'utf8');
console.log(`[modern-runtime-matrix] wrote ${index} deterministic cases to ${output}`);
