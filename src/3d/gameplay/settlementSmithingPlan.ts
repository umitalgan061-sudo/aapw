const CANONICAL_SMITHING_SERVICE = 'blacksmith';
const MAX_ROWS = 24;

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freeze(child);
  return Object.freeze(value);
}

function text(value, fallback = '') {
  const normalized = String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, 96);
  return normalized || fallback;
}

function count(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
}

function normalizeInventory(input) {
  if (Array.isArray(input)) {
    const result = {};
    for (const entry of input) {
      const id = text(entry?.itemId);
      if (!id) continue;
      result[id] = Math.max(result[id] ?? 0, count(entry?.quantity));
    }
    return result;
  }
  if (!input || typeof input !== 'object') return {};
  const result = {};
  for (const [itemId, quantity] of Object.entries(input)) {
    if (!itemId) continue;
    result[itemId] = count(quantity);
  }
  return result;
}

function normalizeInputs(offer) {
  const craftUpgrade = offer?.fulfillment?.craftUpgrade;
  if (!craftUpgrade || typeof craftUpgrade !== 'object') return [];
  if (Array.isArray(craftUpgrade.inputs)) {
    return craftUpgrade.inputs
      .map((input) => ({ itemId: text(input?.itemId), quantity: Math.max(1, count(input?.quantity)) }))
      .filter((input) => input.itemId)
      .sort((left, right) => left.itemId.localeCompare(right.itemId));
  }
  const itemId = text(craftUpgrade.inputItemId);
  return itemId ? [{ itemId, quantity: Math.max(1, count(craftUpgrade.inputQuantity)) }] : [];
}

function stableSignature(value) {
  const encoded = JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < encoded.length; index += 1) {
    hash ^= encoded.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `smithing-preview-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export function createSettlementSmithingPlan({
  serviceId = CANONICAL_SMITHING_SERVICE,
  offers = [],
  inventory = {},
  copper = 0,
  available = true,
  selectedOfferId = null,
} = {}) {
  const normalizedInventory = normalizeInventory(inventory);
  const normalizedCopper = count(copper);
  const rows = [];
  const normalizedOffers = Array.isArray(offers) ? offers : [];
  const seen = new Set();

  if (serviceId !== CANONICAL_SMITHING_SERVICE) {
    return freeze({ serviceId, status: 'blocked', reason: 'unsupported-service', rows: [], signature: stableSignature({ serviceId, status: 'blocked', reason: 'unsupported-service' }) });
  }

  if (!available) {
    return freeze({ serviceId, status: 'blocked', reason: 'service-unavailable', rows: [], signature: stableSignature({ serviceId, status: 'blocked', reason: 'service-unavailable' }) });
  }

  for (const offer of normalizedOffers) {
    const offerId = text(offer?.id);
    if (!offerId || seen.has(offerId)) continue;
    seen.add(offerId);
    const inputs = normalizeInputs(offer);
    if (inputs.length === 0) continue;
    const missing = inputs
      .map((input) => ({ ...input, owned: normalizedInventory[input.itemId] ?? 0, missing: Math.max(0, input.quantity - (normalizedInventory[input.itemId] ?? 0)) }))
      .filter((input) => input.missing > 0);
    const priceCopper = count(offer?.priceCopper);
    const outputItemId = text(offer?.fulfillment?.craftUpgrade?.outputItemId, text(offer?.itemId, 'unknown-output'));
    const outputQuantity = Math.max(1, count(offer?.fulfillment?.craftUpgrade?.outputQuantity) || count(offer?.quantity) || 1);
    const canCraft = missing.length === 0 && normalizedCopper >= priceCopper;
    rows.push({
      offerId,
      label: text(offer?.fulfillment?.craftUpgrade?.label, text(offer?.label, offerId)),
      outputItemId,
      outputQuantity,
      priceCopper,
      inputs,
      missing,
      status: canCraft ? 'ready' : missing.length > 0 ? 'missing-materials' : 'insufficient-copper',
      selected: offerId === selectedOfferId,
    });
    if (rows.length >= MAX_ROWS) break;
  }

  rows.sort((left, right) => left.offerId.localeCompare(right.offerId));
  const selected = rows.find((row) => row.selected) ?? null;
  const status = rows.length === 0 ? 'empty' : selected?.status ?? 'ready';
  const reason = status === 'ready' ? null : status;
  const signature = stableSignature({ serviceId, normalizedCopper, rows });
  return freeze({ serviceId, status, reason, copper: normalizedCopper, rows, selectedOfferId: selected?.offerId ?? null, signature });
}

export function isSettlementSmithingPlan(value) {
  return Boolean(value && typeof value === 'object' && value.serviceId === CANONICAL_SMITHING_SERVICE && Array.isArray(value.rows) && typeof value.signature === 'string' && Object.isFrozen(value));
}
