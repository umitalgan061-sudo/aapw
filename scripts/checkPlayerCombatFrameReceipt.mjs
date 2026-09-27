import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const source = await readFile('src/3d/gameplay/playerCombatFrameReceipt.ts', 'utf8');

for (const token of [
  'normalizeMaterialAudit',
  'materialAuditSignature',
  'playerCombatFrameReceiptSignature',
  'Object.freeze(receipt)',
  'validatePlayerCombatFrameReceipt',
  'socketCount',
]) {
  assert.ok(source.includes(token), `missing receipt contract token: ${token}`);
}

assert.match(
  source,
  /return Object\\.freeze\\(normalized\\);/,
  'material audit normalization must freeze the canonical object',
);
assert.match(
  source,
  /const materialAudit = normalizeMaterialAudit\\(frame\\.audit\\);/,
  'receipt must consume normalized audit data',
);
assert.match(
  source,
  /materialAuditSignature\\(receipt\\.materialAudit\\)/,
  'signature must include normalized audit data',
);
assert.match(
  source,
  /Number\\.isInteger\\(value\\.socketCount\\) && value\\.socketCount >= 0/,
  'socket count must be validated fail-closed',
);

const signatureBody = source.match(
  /function playerCombatFrameReceiptSignature\\(receipt\\) \\{([\\s\\S]*?)\\n\\}/,
);
assert.ok(signatureBody, 'canonical receipt signature helper must remain explicit');
for (const field of [
  'receipt.revision',
  'receipt.phase',
  'receipt.attackKind',
  'receipt.comboStep',
  'receipt.grounded ? 1 : 0',
  'Number(receipt.staminaRatio).toFixed(4)',
  'Number(receipt.poiseRatio).toFixed(4)',
  'receipt.socketCount',
  'materialAuditSignature(receipt.materialAudit)',
  'receipt.equipment?.mainHandId',
  'receipt.equipment?.offHandId',
  'receipt.equipment?.chestId',
  'receipt.equipment?.headId',
]) {
  assert.ok(signatureBody[1].includes(field), `signature missing ${field}`);
}

assert.match(
  source,
  /receipt\\.signature = playerCombatFrameReceiptSignature\\(receipt\\);/,
  'receipt creation must use the canonical signature helper',
);
assert.match(
  source,
  /const signatureOk = typeof value\\.signature === 'string'[\\s\\S]*?value\\.signature === playerCombatFrameReceiptSignature\\(value\\);/,
  'receipt validation must recompute and compare the canonical signature',
);
assert.match(
  source,
  /return Object\\.freeze\\(\\{ ok: phaseOk && ratiosOk && signatureOk && materialOk && equipmentOk && socketOk, phaseOk, ratiosOk, signatureOk, materialOk, equipmentOk, socketOk \\}\\);/,
  'receipt validation result must remain immutable and expose signatureOk',
);

console.log('player combat frame receipt proof: PASS');
