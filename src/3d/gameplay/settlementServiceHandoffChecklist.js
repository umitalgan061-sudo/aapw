/**
 * Deterministic, read-only handoff checklist for the existing settlement loop.
 * It never invokes handlers or mutates quest, inventory, economy, crafting,
 * travel, persistence, NPC, scene, or material/placement state.
 */

const MAX_SERVICES = 8;
const MAX_NOTES = 4;
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const integer = (value, fallback = 0) => Math.trunc(finite(value, fallback));
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const text = (value, fallback = '') => typeof value === 'string' ? value.trim().slice(0, 120) : fallback;
const bool = (value) => value === true;

const SERVICE_ORDER = Object.freeze(['gate', 'tavern', 'market', 'blacksmith', 'farm', 'barracks', 'stable', 'house']);
const ACTION_LABELS = Object.freeze({
  enter: 'İçeri gir',
  talk: 'Konuş',
  trade: 'Takas',
  craft: 'Üret',
  rest: 'Dinlen',
  train: 'Eğitil',
  travel: 'Seyahat et',
  save: 'Kaydet',
});

const normalizeService = (service, index) => {
  const raw = service && typeof service === 'object' ? service : {};
  const id = text(raw.id, `service-${index + 1}`);
  const actions = Array.isArray(raw.actions)
    ? [...new Set(raw.actions.map((action) => text(action)).filter((action) => ACTION_LABELS[action]))].slice(0, 8)
    : [];
  const enabled = bool(raw.enabled);
  const unlocked = raw.unlocked !== false;
  const completed = bool(raw.completed);
  const blockedReason = text(raw.blockedReason, unlocked ? '' : 'unlocked değil');
  const primaryAction = text(raw.primaryAction, actions[0] || '');
  return Object.freeze({
    id,
    label: text(raw.label, id),
    domain: text(raw.domain, 'settlement'),
    enabled: enabled && unlocked,
    unlocked,
    completed,
    primaryAction: ACTION_LABELS[primaryAction] ? primaryAction : '',
    actionLabel: ACTION_LABELS[primaryAction] || '',
    blockedReason: enabled && unlocked ? '' : blockedReason || 'hazır değil',
    objective: text(raw.objective, ''),
    recommended: false,
  });
};

const freezeDeep = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) freezeDeep(child);
  return value;
};

export const SETTLEMENT_SERVICE_HANDOFF_VERSION = 1;

export function createSettlementServiceHandoffChecklist(snapshot = {}) {
  const source = snapshot && typeof snapshot === 'object' ? snapshot : {};
  const services = Array.isArray(source.services)
    ? source.services.map(normalizeService).slice(0, MAX_SERVICES)
    : [];
  const fatigue = clamp(integer(source.fatigue), 0, 100);
  const health = clamp(integer(source.health, 100), 0, 100);
  const inSettlement = bool(source.inSettlement);
  const currentService = text(source.currentService, '');
  const usable = services.filter((service) => service.enabled && !service.completed);
  const preferred = usable
    .sort((a, b) => {
      const ai = SERVICE_ORDER.indexOf(a.id);
      const bi = SERVICE_ORDER.indexOf(b.id);
      return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi) || a.id.localeCompare(b.id);
    })[0] || null;
  const rows = services.map((service) => Object.freeze({
    ...service,
    recommended: Boolean(preferred && service.id === preferred.id),
  }));
  const notes = [];
  if (!inSettlement) notes.push('Yerleşim dışında');
  if (health <= 0) notes.push('Oyuncu etkisiz');
  if (fatigue >= 80) notes.push('Yüksek yorgunluk: hanı öncele');
  if (preferred) notes.push(`${preferred.label}: ${preferred.actionLabel || 'hazır'}`);
  return freezeDeep({
    version: SETTLEMENT_SERVICE_HANDOFF_VERSION,
    inSettlement,
    currentService,
    fatigue,
    health,
    canInteract: inSettlement && health > 0,
    recommendedService: preferred ? preferred.id : '',
    services: rows,
    notes: notes.slice(0, MAX_NOTES),
    summary: `${rows.filter((row) => row.enabled).length}/${rows.length} hizmet hazır`,
  });
}

export function serializeSettlementServiceHandoffChecklist(snapshot) {
  return JSON.stringify(createSettlementServiceHandoffChecklist(snapshot));
}
