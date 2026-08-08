import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.argv[2] || 'src/3d');
const allowedExt = new Set(['.js', '.mjs', '.cjs']);
const violations = [];
const ignoredDirectories = new Set(['vendor']);

function stripComments(line, lexicalState) {
  let executable = '';

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (lexicalState.blockComment) {
      if (char === '*' && next === '/') {
        lexicalState.blockComment = false;
        index += 1;
      }
      continue;
    }

    if (lexicalState.quote) {
      executable += char;
      if (lexicalState.escaped) {
        lexicalState.escaped = false;
      } else if (char === '\\') {
        lexicalState.escaped = true;
      } else if (char === lexicalState.quote) {
        lexicalState.quote = null;
      }
      continue;
    }

    if (char === '/' && next === '/') break;
    if (char === '/' && next === '*') {
      lexicalState.blockComment = true;
      index += 1;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      lexicalState.quote = char;
      lexicalState.escaped = false;
    }
    executable += char;
  }

  return executable;
}

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (ignoredDirectories.has(entry.name)) continue;
      walk(full);
      continue;
    }
    if (!allowedExt.has(path.extname(entry.name))) continue;
    const lexicalState = { blockComment: false, quote: null, escaped: false };
    const lines = fs.readFileSync(full, 'utf8').split(/\r?\n/);
    lines.forEach((line, index) => {
      const executableLine = stripComments(line, lexicalState);
      if (!/\bMath\s*\.\s*random\s*\(/.test(executableLine)) return;
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