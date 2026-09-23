import {
  isPlayerEquipmentTransitionReceipt,
  resolvePlayerEquipmentTransitionReceipt,
  validatePlayerEquipmentTransitionReceipt,
} from '../src/3d/gameplay/playerEquipmentTransitionDirector.ts';
import { resolvePlayerEquipmentCombatProfile } from '../src/3d/gameplay/playerEquipmentCombatProfile.ts';

const base = resolvePlayerEquipmentCombatProfile({
  mainHand: { id: 'arming-sword' },
  offHand: { id: 'buckler' },
  chest: { id: 'leather' },
  head: { id: 'hood' },
  back: { id: 'empty' },
});
const next = resolvePlayerEquipmentCombatProfile({
  mainHand: { id: 'greatsword' },
  offHand: null,
  chest: { id: 'leather' },
  head: { id: 'hood' },
  back: { id: 'empty' },
});
const receipt = resolvePlayerEquipmentTransitionReceipt({ previousEquipment: base, nextEquipment: next });
const negativeCrossfade = {
  ...receipt,
  animation: Object.freeze({ ...receipt.animation, crossfadeSeconds: -0.25 }),
};

if (isPlayerEquipmentTransitionReceipt(negativeCrossfade)) {
  throw new Error('shape guard accepted negative crossfade');
}
const validation = validatePlayerEquipmentTransitionReceipt(negativeCrossfade);
if (validation.ok || !validation.errors.includes('negative-crossfade')) {
  throw new Error(`negative crossfade was not diagnosed: ${validation.errors.join(',')}`);
}

console.log(JSON.stringify({
  ok: true,
  suite: 'player-equipment-transition-director-boundary',
  negativeCrossfadeRejected: true,
  diagnostic: 'negative-crossfade',
}));
