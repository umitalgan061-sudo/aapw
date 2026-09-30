import { readFile } from 'node:fs/promises';

const index = await readFile('index.html', 'utf8');
const scriptShim = await readFile('script.js', 'utf8');
const scriptTs = await readFile('script.ts', 'utf8');
const packageJson = JSON.parse(await readFile('package.json', 'utf8'));

const failures = [];
if (!index.includes('<script type="module" src="script.ts"></script>')) {
  failures.push('index.html must use script.ts as the primary module entry');
}
if (!scriptShim.includes("import('./script.ts')")) {
  failures.push('script.js must remain a compatibility shim that imports script.ts');
}
if (!scriptTs.includes("export const WESTEROS_LEGACY_COMMANDS")) {
  failures.push('script.ts must expose the compatibility command registry');
}

const fnNames = [...scriptTs.matchAll(/(?:^|\n)(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g)].map((m) => m[1]);
const unique = [...new Set(fnNames)];
const commandBlock = scriptTs.match(/export const WESTEROS_LEGACY_COMMANDS = Object\.freeze\(\{([\s\S]*?)\}\);/);
if (!commandBlock) {
  failures.push('WESTEROS_LEGACY_COMMANDS registry block is missing');
} else {
  for (const name of unique) {
    if (!new RegExp('\\b' + name.replace(/[$]/g, '\\$') + '\\s*,').test(commandBlock[1])) {
      failures.push('legacy command missing from registry: ' + name);
    }
  }
}
if (unique.length < 190) failures.push('unexpectedly low legacy command count: ' + unique.length);

for (const key of ['verify:typed-platform-r22','test:typed-platform-r22','check:typed-platform-r22']) {
  if (!packageJson.scripts?.[key]) failures.push('package.json missing ' + key);
}

if (failures.length) {
  console.error('R22 root-app TypeScript gate failed with ' + failures.length + ' issue(s):');
  for (const failure of failures) console.error('- ' + failure);
  process.exit(1);
}
console.log('R22 root-app TypeScript gate passed: primary entry is TypeScript and all legacy UI commands are bridged.');
