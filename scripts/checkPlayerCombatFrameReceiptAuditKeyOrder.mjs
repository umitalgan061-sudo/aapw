import {
  createPlayerCombatFrameReceipt,
  validatePlayerCombatFrameReceipt,
} from '../src/3d/gameplay/playerCombatFrameReceipt.ts';

const playerObject = { id: 'canonicalization-proof' };
const base = {
  playerObject,
  equipment: { mainHandId: 'sword', offHandId: 'shield' },
  motion: { grounded: true, staminaRatio: 0.8, poiseRatio: 0.6 },
  attack: { kind: 'heavy', comboStep: 1 },
  revision: 11,
};

const first = createPlayerCombatFrameReceipt({
  ...base,
  outcome: { audit: { metal: 'steel', cloth: 'wool' } },
});
const second = createPlayerCombatFrameReceipt({
  ...base,
  outcome: { audit: { cloth: 'wool', metal: 'steel' } },
});

if (first.signature !== second.signature) throw new Error('material audit key order changed the receipt signature');
if (!validatePlayerCombatFrameReceipt(first).ok) throw new Error('canonical receipt failed validation');
if (!Object.isFrozen(first.materialAudit)) throw new Error('canonical material audit is not frozen');

console.log(JSON.stringify({
  ok: true,
  suite: 'player-combat-frame-receipt-audit-key-order',
  deterministic: first.signature === second.signature,
  frozen: Object.isFrozen(first.materialAudit),
}));
