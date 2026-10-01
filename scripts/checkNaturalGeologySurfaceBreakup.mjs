import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync('src/3d/world/naturalGeologySurfaceBreakup.js', 'utf8');
for (const token of [
  'NATURAL_GEOLOGY_SURFACE_BREAKUP_POLICY',
  'canonicalHeightUnchanged: true',
  'canonicalHydrologyUnchanged: true',
  'applyGeologyVertexBreakup',
  'createGeologyBreakupMaterial',
  'vertexColors: true',
  'flatShading: false',
]) assert.ok(source.includes(token), `missing contract token: ${token}`);
assert.ok(!source.includes('setY(index'), 'surface breakup must not mutate canonical vertex heights');
console.log('natural-geology-surface-breakup contract: PASS');
