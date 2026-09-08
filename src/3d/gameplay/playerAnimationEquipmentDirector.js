/**
 * DOM-free animation/equipment bridge for the existing player pipeline.
 * Resolves presentation intent from combat state without owning Three.js playback,
 * asset loading, inventory semantics, or movement.
 */

const finite = (value, fallback = 0) => (Number.isFinite(value) ? value : fallback);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export const PRESENTATION_STATES = Object.freeze({
  IDLE: 'idle',
  LOCOMOTION: 'locomotion',
  LIGHT_ATTACK: 'attack_light',
  HEAVY_ATTACK: 'attack_heavy',
  BLOCK: 'block',
  PARRY: 'parry',
  DODGE: 'dodge',
  HIT: 'hit',
  STAGGER: 'stagger',
});

export function resolvePlayerPresentation({ combatState = {}, movement = {}, equipment = {} } = {}) {
  const action = combatState.action;
  const hitKind = combatState.lastResolvedHit?.kind;
  let state = PRESENTATION_STATES.IDLE;
  if (hitKind === 'parried') state = PRESENTATION_STATES.PARRY;
  else if (hitKind === 'hit') state = combatState.lastResolvedHit?.staggered ? PRESENTATION_STATES.STAGGER : PRESENTATION_STATES.HIT;
  else if (action === 'dodge') state = PRESENTATION_STATES.DODGE;
  else if (action === 'block') state = PRESENTATION_STATES.BLOCK;
  else if (action === 'heavy') state = PRESENTATION_STATES.HEAVY_ATTACK;
  else if (action === 'light') state = PRESENTATION_STATES.LIGHT_ATTACK;
  else if (Math.hypot(finite(movement.x), finite(movement.z)) > 0.05) state = PRESENTATION_STATES.LOCOMOTION;

  return Object.freeze({
    state,
    locomotionSpeed: clamp(Math.hypot(finite(movement.x), finite(movement.z)), 0, 1),
    comboIndex: clamp(Math.trunc(finite(combatState.comboIndex, 0)), 0, 3),
    upperBodyLayer: equipment.upperBodyLayer || 'default',
    lowerBodyLayer: equipment.lowerBodyLayer || 'default',
    weaponSocket: equipment.weaponSocket || 'hand_r',
    shieldSocket: equipment.shieldSocket || 'forearm_l',
    armorProfile: equipment.armorProfile || 'unarmored',
  });
}

export function buildEquipmentSocketBindings(equipment = {}) {
  const bindings = [];
  const add = (slot, socket, assetId) => {
    if (assetId == null || assetId === '') return;
    bindings.push(Object.freeze({ slot, socket, assetId: String(assetId) }));
  };
  add('weapon', equipment.weaponSocket || 'hand_r', equipment.weaponId);
  add('offhand', equipment.offhandSocket || 'hand_l', equipment.offhandId);
  add('head', 'head', equipment.headId);
  add('chest', 'spine', equipment.chestId);
  add('back', 'back', equipment.backId);
  return Object.freeze(bindings);
}

export function buildArmorStatEnvelope(armor = {}) {
  const mitigation = clamp(finite(armor.mitigation, 0), 0, 0.95);
  const poise = clamp(finite(armor.poise, 0), 0, 200);
  const staminaPenalty = clamp(finite(armor.staminaPenalty, 0), 0, 0.8);
  return Object.freeze({
    mitigation,
    poise,
    staminaPenalty,
    movementMultiplier: 1 - staminaPenalty * 0.35,
    tags: Object.freeze(Array.isArray(armor.tags) ? armor.tags.map(String).slice(0, 12) : []),
  });
}
