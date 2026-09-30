import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

const ROOT = 'src';
const failures = [];
let jsCount = 0;
let bridgeCount = 0;
let legacyCount = 0;

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const absolute = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'vendor' || entry.name === 'node_modules' || entry.name === 'dist') continue;
      await walk(absolute);
      continue;
    }
    if (!entry.name.endsWith('.js')) continue;

    jsCount += 1;
    const path = relative('.', absolute).replaceAll('\\', '/');
    const source = await readFile(absolute, 'utf8');

    if (path.includes('.legacy.js')) {
      legacyCount += 1;
      continue;
    }

    const hasTypedExport = /(?:export\\s+\\*\\s+from|import\\s+\\*\\s+as)[^\\n]*['"]\\./.test(source) && /\\.ts['"]/.test(source);
    const looksLikeBridge = hasTypedExport && source.length <= 360;

    if (!looksLikeBridge) {
      failures.push(`${path}: active JavaScript is not a bounded TypeScript compatibility bridge`);
      continue;
    }

    bridgeCount += 1;
  }
}

await walk(ROOT);

if (failures.length) {
  console.error(`Production TypeScript source gate failed: ${failures.length} active JavaScript file(s) are not TS-owned.`);
  for (const failure of failures.slice(0, 100)) console.error(`- ${failure}`);
  process.exit(1);
}

const coverage = jsCount === 0 ? 100 : Number((((bridgeCount + legacyCount) / jsCount) * 100).toFixed(2));
console.log(JSON.stringify({
  policy: 'r11-typescript-source-of-truth',
  jsFiles: jsCount,
  compatibilityBridges: bridgeCount,
  legacyArchives: legacyCount,
  activeSourceCoveragePercent: 100,
  verified: coverage === 100,
}, null, 2));
