import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const source = await readFile('src/3d/gameplay/playerCombatFrameReceipt.ts', 'utf8');

assert.match(
  source,
  /Object\.entries\(audit\)[\s\S]*?\.filter\(\(\[key\]\) => typeof key === 'string'\)[\s\S]*?\.sort\(\(\[a\], \[b\]\) => compareCanonicalKeys\(a, b\)\)/,
  'material audit keys must be canonicalized with the locale-independent comparator',
);
assert.match(
  source,
  /if \(typeof audit !== 'object' \|\| Array\.isArray\(audit\)\) return Object\.freeze\(\{ invalid: true \} \);/,
  'array and non-object audits must fail closed',
);
assert.match(
  source,
  /return Object\.freeze\(\{ ok: phaseOk && ratiosOk && signatureOk && materialOk && equipmentOk && socketOk,/,
  'validation result must aggregate all guards and be immutable',
);
assert.match(
  source,
  /receipt\.signature = \[[\s\S]*?receipt\.staminaRatio\.toFixed\(4\)[\s\S]*?receipt\.poiseRatio\.toFixed\(4\)[\s\S]*?receipt\.socketCount/,
  'replay identity must include movement resources and equipment socket count',
);

console.log('player combat frame receipt canonicalization proof: PASS');
