#!/usr/bin/env node
/**
 * Lightweight governance gate for forbidden untracked technical-debt markers in source files.
 * Documentation is intentionally excluded because historical ADR/progress text may discuss markers.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SOURCE_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.html', '.css', '.json', '.xml', '.glsl', '.vert', '.frag']);
const SKIP_DIRS = new Set(['.git', 'node_modules', 'artifacts']);
const FORBIDDEN = /\b(?:TEMP|HACK|FIXME|WORKAROUND)\b/g;
const findings = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
      continue;
    }
    if (!SOURCE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
    const relative = path.relative(ROOT, full).split(path.sep).join('/');
    const lines = fs.readFileSync(full, 'utf8').split('\n');
    for (let index = 0; index < lines.length; index += 1) {
      FORBIDDEN.lastIndex = 0;
      const matches = [...lines[index].matchAll(FORBIDDEN)];
      for (const match of matches) findings.push(`${relative}:${index + 1}:${match[0]}`);
    }
  }
}

walk(ROOT);
if (findings.length > 0) {
  console.error(`[checkTechnicalDebt] FAIL: ${findings.length} forbidden untracked technical-debt marker(s)`);
  for (const finding of findings) console.error(`  - ${finding}`);
  process.exit(1);
}
console.log('[checkTechnicalDebt] PASS: 0 forbidden TEMP/HACK/FIXME/WORKAROUND markers in source files');
