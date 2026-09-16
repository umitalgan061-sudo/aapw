import fs from 'node:fs';
import path from 'node:path';

const backends = ['webgpu', 'webgl2'];
const tiers = ['minimal', 'balanced', 'high', 'ultra'];
const sceneLoads = ['empty', 'light', 'normal', 'dense', 'foliage', 'town', 'combat', 'storm'];
const screenModes = ['desktop', 'tablet', 'phone', 'wide', 'retina', 'low-dpr', 'xr-ready', 'cinematic'];
const thermalStates = ['nominal', 'warm', 'hot', 'critical'];
const accessibilityModes = ['default', 'reduced-motion'];

const output = [];
output.push('# Next-gen rendering deterministic policy matrix R1');
output.push('# backend|tier|sceneLoad|screenMode|thermal|accessibility|pipeline|mrt|temporal|caseId');
let index = 0;
for (const backend of backends) {
  for (const tier of tiers) {
    for (const sceneLoad of sceneLoads) {
      for (const screenMode of screenModes) {
        for (const thermal of thermalStates) {
          for (const accessibility of accessibilityModes) {
            const lowPower = thermal === 'critical' || screenMode === 'phone';
            const pipeline = lowPower ? 'minimal' : tier;
            const mrt = backend === 'webgpu' && !lowPower && (tier === 'high' || tier === 'ultra') ? 'on' : 'off';
            const temporal = backend === 'webgpu' && !lowPower && accessibility !== 'reduced-motion' && tier !== 'minimal' ? 'on' : 'off';
            output.push(`${backend}|${tier}|${sceneLoad}|${screenMode}|${thermal}|${accessibility}|${pipeline}|${mrt}|${temporal}|NGR-${String(index).padStart(4, '0')}`);
            index += 1;
          }
        }
      }
    }
  }
}
if (index !== 4096) throw new Error(`expected 4096 cases, got ${index}`);
const file = path.resolve('artifacts/next-gen-rendering-r1/rendering-policy.matrix');
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, `${output.join('\n')}\n`, 'utf8');
console.log(`[next-gen-rendering] wrote ${index} deterministic cases`);
