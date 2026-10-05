import { createPlayerCombatFrameReceipt } from '../src/3d/gameplay/playerCombatFrameReceipt.ts';

const base = {
  playerObject: { id: 'locale-independent-order-proof' },
  motion: { grounded: true, staminaRatio: 0.8, poiseRatio: 0.6 },
  attack: { kind: 'light', comboStep: 1 },
  revision: 12,
};

const first = createPlayerCombatFrameReceipt({
  ...base,
  outcome: { audit: { zeta: 'last', Alpha: 'first', 'ä': 'unicode' } },
});
const second = createPlayerCombatFrameReceipt({
  ...base,
  outcome: { audit: { 'ä': 'unicode', Alpha: 'first', zeta: 'last' } },
});

if (first.signature !== second.signature) throw new Error('locale-independent audit ordering is not deterministic');
if (first.signature.indexOf('Alpha=first') > first.signature.indexOf('zeta=last')) {
  throw new Error('canonical audit ordering is not code-unit stable');
}
if (!Object.isFrozen(first.materialAudit)) throw new Error('material audit should remain frozen');

console.log(JSON.stringify({
  ok: true,
  suite: 'player-combat-frame-receipt-locale-independent-order',
  deterministic: first.signature === second.signature,
  signature: first.signature,
}));
