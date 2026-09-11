const SERVICE_ORDER = Object.freeze(['market', 'blacksmith', 'tavern', 'stable', 'farm', 'barracks']);
const ACTION_BY_SERVICE = Object.freeze({
  market: 'trade',
  blacksmith: 'craft',
  tavern: 'rest',
  stable: 'travel',
  farm: 'survival',
  barracks: 'train',
});

function finite(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function text(value, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

function normaliseService(raw, index) {
  const id = text(raw?.id, `service-${index + 1}`).trim().toLowerCase();
  const kind = SERVICE_ORDER.includes(id) ? id : 'market';
  const ready = raw?.ready === true;
  const interaction = text(raw?.interaction, ACTION_BY_SERVICE[kind]);
  const distance = Math.max(0, finite(raw?.distance, 0));
  const queue = Math.max(0, Math.floor(finite(raw?.queue, 0)));
  return Object.freeze({
    id,
    kind,
    action: interaction || ACTION_BY_SERVICE[kind],
    ready,
    distance,
    queue,
    label: text(raw?.label, kind[0].toUpperCase() + kind.slice(1)),
  });
}

function sortServices(services) {
  return [...services].sort((a, b) => {
    const readyDelta = Number(b.ready) - Number(a.ready);
    if (readyDelta) return readyDelta;
    const distanceDelta = a.distance - b.distance;
    if (distanceDelta) return distanceDelta;
    return a.id.localeCompare(b.id);
  });
}

function deriveHint(service, state) {
  if (!service.ready) return `locked:${service.id}`;
  if (service.queue > 0) return `queued:${service.id}:${service.queue}`;
  if (service.kind === 'market' && finite(state?.gold) <= 0) return 'market:needs-gold';
  if (service.kind === 'blacksmith' && finite(state?.craftingMaterials) <= 0) return 'blacksmith:needs-materials';
  return `ready:${service.action}`;
}

export function buildSettlementServiceUxProjection(input = {}) {
  const settlementId = text(input.settlementId, 'unknown-settlement');
  const insideSettlement = input.insideSettlement === true;
  const services = Array.isArray(input.services)
    ? input.services.map(normaliseService).filter((service) => service.id)
    : [];
  const ordered = sortServices(services);
  const visible = insideSettlement ? ordered.slice(0, 8) : [];
  const state = Object.freeze({
    gold: Math.max(0, finite(input.playerState?.gold, 0)),
    craftingMaterials: Math.max(0, finite(input.playerState?.craftingMaterials, 0)),
  });
  const cards = visible.map((service, index) => Object.freeze({
    rank: index + 1,
    serviceId: service.id,
    title: service.label,
    action: service.action,
    status: service.ready ? 'available' : 'unavailable',
    hint: deriveHint(service, state),
    distance: service.distance,
    queue: service.queue,
  }));
  const next = cards.find((card) => card.status === 'available') ?? null;
  const summary = Object.freeze({
    settlementId,
    insideSettlement,
    serviceCount: cards.length,
    availableCount: cards.filter((card) => card.status === 'available').length,
    nextAction: next?.action ?? null,
    blockedReason: insideSettlement ? null : 'outside-settlement',
  });
  return Object.freeze({
    version: 1,
    settlementId,
    cards: Object.freeze(cards),
    summary,
    contract: Object.freeze({
      owner: 'SettlementVerticalSlice',
      delegates: Object.freeze(['QuestSystem', 'Economy', 'Crafting', 'Travel', 'Survival', 'SaveLoad']),
      runtimeOnly: true,
      editorImport: false,
    }),
  });
}

export function stableSettlementServiceUxFingerprint(projection) {
  const payload = {
    version: projection?.version ?? 0,
    settlementId: projection?.settlementId ?? '',
    cards: (projection?.cards ?? []).map((card) => ({
      serviceId: card.serviceId,
      action: card.action,
      status: card.status,
      hint: card.hint,
      distance: card.distance,
      queue: card.queue,
    })),
    summary: projection?.summary ?? null,
  };
  return JSON.stringify(payload);
}
