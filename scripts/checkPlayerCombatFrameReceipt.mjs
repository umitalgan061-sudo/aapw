import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const source = await readFile('src/3d/gameplay/playerCombatFrameReceipt.ts', 'utf8');

for (const token of [
  'normalizeMaterialAudit',
  'materialAuditSignature',
  'Object.freeze(receipt)',
  'validatePlayerCombatFrameReceipt',
  'socketCount',
]) {
  assert.ok(source.includes(token), `missing receipt contract token: ${token}`);
}

assert.match(
  source,
  /return Object\.freeze\(normalized\);/,
  'material audit normalization must freeze the canonical object',
);
assert.match(
  source,
  /const materialAudit = normalizeMaterialAudit\(frame\.audit\);/,
  'receipt must consume normalized audit data',
);
assert.match(
  source,
  /materialAuditSignature\(receipt\.materialAudit\)/,
  'signature must include normalized audit data',
);
assert.match(
  source,
  /Number\.isInteger\(value\.socketCount\) && value\.socketCount >= 0/,
  'socket count must be validated fail-closed',
);

const signatureFields = source.match(/receipt\.signature = \[([\\s\\S]*?)\]\.join\('\|'/);
assert.ok(signatureFields, 'receipt signature field list must remain explicit');
for (const field of ['receipt.staminaRatio.toFixed(4)', 'receipt.poiseRatio.toFixed(4)', 'receipt.socketCount']) {
  assert.ok(signatureFields[1].includes(field), `signature missing ${field}`);
}

assert.match(
  source,
  /const signatureOk = typeof value\.signature === 'string'[\\s\\S]*?value\.signature === playerCombatFrameReceiptSignature\(value\);/,
  'receipt validation must recompute and compare the canonical signature',
);
assert.match(
  source,
  /return Object\.freeze\(\{ ok: phaseOk && ratiosOk && signatureOk && materialOk && equipmentOk && socketOk, phaseOk, ratiosOk, signatureOk, materialOk, equipmentOk, socketOk \}\);/,
  'receipt validation result must remain immutable and expose signatureOk',
);

console.log('player combat frame receipt proof: PASS');
