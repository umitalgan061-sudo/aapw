import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.argv[2] || 'src/3d');
const allowedExt = new Set(['.js', '.mjs', '.cjs']);
const violations = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
      continue;
    }
    if (!allowedExt.has(path.extname(entry.name))) continue;
    const lines = fs.readFileSync(full, 'utf8').split(/\r?\n/);
    lines.forEach((line, index) => {
      if (/\bMath\s*\.\s*random\s*\(/.test(line)) {
        violations.push(`${path.relative(root, full)}:${index + 1}: ${line.trim()}`);
      }
    });
  }
}

if (!fs.existsSync(root)) {
  console.error(`Determinism guard: root does not exist: ${root}`);
  process.exit(2);
}

walk(root);

if (violations.length > 0) {
  console.error('Determinism guard FAILED: unseeded Math.random() usage found in src/3d.');
  for (const violation of violations) console.error(`- ${violation}`);
  process.exit(1);
}

console.log(`Determinism guard PASS: no Math.random() usage under ${root}.`);
