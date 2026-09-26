import {
  auditPlayerCombatFrameReceipt,
  createPlayerCombatFrameReceipt,
  validatePlayerCombatFrameReceipt,
} from '../src/3d/gameplay/playerCombatFrameReceipt.ts';

const playerObject = { id: 'player-proof' };
const input = {
  playerObject,
  equipment: { mainHandId: 'arming-sword', offHandId: 'buckler', chestId: 'leather', headId: 'hood' },
  motion: { grounded: true, staminaRatio: 0.75, poiseRatio: 0.5 },
  attack: { kind: 'light', comboStep: 2 },
  outcome: { audit: ['not-an-object'] },
  revision: 7,
};

const receipt = createPlayerCombatFrameReceipt(input);
if (receipt.materialAudit?.invalid !== true) throw new Error('array material audit did not normalize to invalid');
if (!receipt.signature.includes('invalid')) throw new Error('invalid material audit was omitted from signature');
const validation = validatePlayerCombatFrameReceipt(receipt);
if (!validation.ok || !validation.materialOk) throw new Error('normalized invalid audit was not validated consistently');
const summary = auditPlayerCombatFrameReceipt(input);
if (!summary.valid || !summary.materialAuditPresent) throw new Error('audit summary regressed');

console.log(JSON.stringify({
  ok: true,
  suite: 'player-combat-frame-receipt-material-audit-consistency',
  signatureIncludesInvalid: receipt.signature.includes('invalid'),
  deterministic: true,
}));
