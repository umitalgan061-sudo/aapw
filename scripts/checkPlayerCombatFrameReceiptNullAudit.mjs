import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const source = await readFile('src/3d/gameplay/playerCombatFrameReceipt.ts', 'utf8');

assert.match(
  source,
  /if \(audit == null\) return null;/,
  'missing material audit must remain an explicit null state',
);
assert.match(
  source,
  /materialAuditPresent: receipt\.materialAudit !== null/,
  'summary must distinguish missing material audit from invalid audit data',
);

console.log('player combat frame receipt null-audit proof: PASS');
