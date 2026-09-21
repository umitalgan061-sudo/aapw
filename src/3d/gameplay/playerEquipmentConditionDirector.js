/**
 * Deterministic equipment condition/encumbrance adapter for the existing player runtime.
 *
 * This module consumes caller-owned equipment durability/repair snapshots and the existing
 * equipment-combat profile summary. It returns immutable condition bands, bounded stat modifiers
 * and declarative warnings; it does not mutate inventory, player state, scene objects, materials
 * or AnimationMixer state.
 *
 * @module gameplay/playerEquipmentConditionDirector
 */

const MAX_ITEMS = 32;
const MAX_HISTORY = 16;
const MAX_ID_LENGTH = 96;
const MIN = 0;
const MAX = 100;

const clamp = (value, min = MIN, max = MAX) => Math.max(min, Math.min(max, Number.isFinite(Number(value)) ? Number(value) : min));
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const normalizeId = (value, fallback = 'unknown') => String(value ?? fallback).trim().toLowerCase().replace(/[^a-z0-9._:-]+/g, '-').slice(0, MAX_ID_LENGTH) || fallback;
const freezeDeep = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freezeDeep(child);
  return Object.freeze(value);
};

const CONDITION_BANDS = freezeDeep([
  { id: 'broken', min: 0, max: 0, damageMultiplier: 0.1, defenseMultiplier: 0.25, weightMultiplier: 0.5, warning: 'broken' },
  { id: 'critical', min: 1, max: 19, damageMultiplier: 0.55, defenseMultiplier: 0.6, weightMultiplier: 0.7, warning: 'repair-soon' },
  { id: 'worn', min: 20, max: 49, damageMultiplier: 0.8, defenseMultiplier: 0.82, weightMultiplier: 0.9, warning: 'repair-recommended' },
  { id: 'sound', min: 50, max: 79, damageMultiplier: 0.94, defenseMultiplier: 0.94, weightMultiplier: 0.98, warning: null },
  { id: 'pristine', min: 80, max: 100, damageMultiplier: 1, defenseMultiplier: 1, weightMultiplier: 1, warning: null },
]);

function resolveBand(condition) {
  const value = clamp(condition);
  return CONDITION_BANDS.find((band) => value >= band.min && value <= band.max) || CONDITION_BANDS[0];
}

function normalizeItem(item, index) {
  const id = normalizeId(item?.id, `item-${index}`);
  const slot = normalizeId(item?.slot, 'unknown');
  const condition = clamp(item?.condition, 100);
  const weight = clamp(finite(item?.weight, 0), 0, 1000);
  const band = resolveBand(condition);
  return freezeDeep({
    id,
    slot,
    condition,
    weight,
    band: band.id,
    damageMultiplier: band.damageMultiplier,
    defenseMultiplier: band.defenseMultiplier,
    weightMultiplier: band.weightMultiplier,
    warning: band.warning,
  });
}

export function resolvePlayerEquipmentCondition({ items = [], maxCarryWeight = 100, activeAttackKind = 'light' } = {}) {
  const boundedItems = Array.isArray(items) ? items.slice(0, MAX_ITEMS).map(normalizeItem) : [];
  const totalWeight = boundedItems.reduce((sum, item) => sum + item.weight * item.weightMultiplier, 0);
  const carryCap = Math.max(1, finite(maxCarryWeight, 100));
  const loadRatio = clamp((totalWeight / carryCap) * 100, 0, 200);
  const brokenCount = boundedItems.filter((item) => item.band === 'broken').length;
  const warnings = boundedItems.filter((item) => item.warning).map((item) => `${item.slot}:${item.warning}`);
  const encumbranceBand = loadRatio >= 100 ? 'overloaded' : loadRatio >= 85 ? 'heavy' : loadRatio >= 65 ? 'moderate' : 'light';
  const movementMultiplier = encumbranceBand === 'overloaded' ? 0.56 : encumbranceBand === 'heavy' ? 0.74 : encumbranceBand === 'moderate' ? 0.88 : 1;
  const staminaDrainMultiplier = encumbranceBand === 'overloaded' ? 1.35 : encumbranceBand === 'heavy' ? 1.2 : encumbranceBand === 'moderate' ? 1.08 : 1;
  const attackMultiplier = boundedItems.reduce((value, item) => value * item.damageMultiplier, 1);
  const defenseMultiplier = boundedItems.reduce((value, item) => value * item.defenseMultiplier, 1);
  const activeProfile = normalizeId(activeAttackKind, 'light');
  return freezeDeep({
    activeAttackKind: activeProfile,
    items: boundedItems,
    totalWeight: Number(totalWeight.toFixed(4)),
    maxCarryWeight: Number(carryCap.toFixed(4)),
    loadRatio: Number(loadRatio.toFixed(4)),
    encumbranceBand,
    movementMultiplier: Number((movementMultiplier * (brokenCount ? 0.96 : 1)).toFixed(4)),
    staminaDrainMultiplier: Number((staminaDrainMultiplier * (brokenCount ? 1.04 : 1)).toFixed(4)),
    attackMultiplier: Number(attackMultiplier.toFixed(4)),
    defenseMultiplier: Number(defenseMultiplier.toFixed(4)),
    brokenCount,
    warnings: [...new Set(warnings)].sort(),
    valid: boundedItems.length <= MAX_ITEMS && carryCap > 0,
  });
}

export function createPlayerEquipmentConditionDirector({ historyLimit = MAX_HISTORY } = {}) {
  const limit = Math.max(1, Math.min(MAX_HISTORY, Math.trunc(finite(historyLimit, MAX_HISTORY))));
  let disposed = false;
  let sequence = 0;
  const history = [];

  const evaluate = (input = {}) => {
    if (disposed) return freezeDeep({ accepted: false, reason: 'disposed', sequence });
    const condition = resolvePlayerEquipmentCondition(input);
    const receipt = freezeDeep({
      accepted: condition.valid,
      reason: condition.valid ? 'accepted' : 'invalid-input',
      sequence: ++sequence,
      condition,
    });
    history.push(receipt);
    if (history.length > limit) history.splice(0, history.length - limit);
    return receipt;
  };

  return {
    evaluate,
    snapshot() {
      return freezeDeep({ disposed, sequence, history: [...history] });
    },
    dispose() {
      disposed = true;
      history.length = 0;
    },
  };
}

export function validatePlayerEquipmentCondition(receipt) {
  return Boolean(receipt && typeof receipt === 'object' && receipt.accepted !== undefined && Number.isInteger(receipt.sequence) && receipt.condition?.valid === true);
}
