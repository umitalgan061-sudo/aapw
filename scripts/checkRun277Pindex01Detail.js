#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const file = path.join(ROOT, 'src/3d/world/worldReferencePindex01Detail.js');
const source = fs.readFileSync(file, 'utf8');
const required = [
  "pindex: 1",
  "sea: 0.015",
  "soil: 0.06",
  "rock: 0.05",
  "snow: 0.025",
  "if (c.pindex !== PINDEX01_DETAIL_POLICY.pindex) continue;",
  "color.needsUpdate = true",
  "run277Pindex01Detail",
];
for (const token of required) {
  if (!source.includes(token)) throw new Error(`Run277 contract missing: ${token}`);
}
if (source.includes('Math.random(')) throw new Error('Run277 detail must remain deterministic');
console.log('[checkRun277Pindex01Detail] PASS: deterministic Pindex-01-only color micro-detail contract locked');
