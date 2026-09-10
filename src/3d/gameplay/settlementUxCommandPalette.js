/**
 * Deterministic read-only command palette for the existing settlement campaign UI model.
 * It owns no DOM, input polling, quest progression, inventory/economy mutation or persistence.
 */
export const SETTLEMENT_UX_COMMAND_PALETTE_VERSION = 1;

const ACTION_ORDER = ['enter', 'talk', 'trade', 'buy', 'sell', 'craft', 'equip', 'acceptQuest', 'advanceQuest', 'travel', 'rest', 'train', 'save', 'exit'];
const MAX_COMMANDS = 24;
const MAX_QUERY = 48;

const text = (value, fallback = '') => {
  const result = String(value ?? '').trim();
  return result ? result.slice(0, 160) : fallback;
};
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const freeze = (value) => Object.freeze(value);
const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));

const ACTION_META = Object.freeze({
  enter: { section: 'navigation', label: 'İçeri gir', priority: 10 },
  talk: { section: 'dialogue', label: 'Konuş', priority: 20 },
  trade: { section: 'economy', label: 'Takas', priority: 30 },
  buy: { section: 'economy', label: 'Satın al', priority: 31 },
  sell: { section: 'economy', label: 'Sat', priority: 32 },
  craft: { section: 'crafting', label: 'Üret', priority: 40 },
  equip: { section: 'equipment', label: 'Kuşan', priority: 50 },
  acceptQuest: { section: 'quest', label: 'Görevi kabul et', priority: 60 },
  advanceQuest: { section: 'quest', label: 'Görevi ilerlet', priority: 61 },
  travel: { section: 'travel', label: 'Yola çık', priority: 70 },
  rest: { section: 'survival', label: 'Dinlen', priority: 80 },
  train: { section: 'progression', label: 'Antrenman yap', priority: 90 },
  save: { section: 'persistence', label: 'Oyunu kaydet', priority: 100 },
  exit: { section: 'navigation', label: 'Dışarı çık', priority: 110 },
});

function normalizeCommand(command, index) {
  const raw = command && typeof command === 'object' ? command : {};
  const action = text(raw.action, 'interact');
  const meta = ACTION_META[action] ?? { section: 'interaction', label: text(action, 'Etkileş'), priority: 999 };
  const enabled = raw.enabled !== false && raw.status !== 'blocked';
  const reason = enabled ? '' : text(raw.reason || raw.feedbackCode, 'blocked');
  return {
    id: text(raw.id, `${action}-${index + 1}`),
    action,
    section: meta.section,
    label: text(raw.label, meta.label),
    hint: text(raw.hint || raw.prompt),
    enabled,
    reason,
    priority: finite(raw.priority, meta.priority),
    shortcut: text(raw.shortcut),
    targetId: text(raw.targetId || raw.serviceId || raw.questId),
  };
}

function normalizeCommands(view) {
  const authored = Array.isArray(view?.commands) ? view.commands : Array.isArray(view?.actions) ? view.actions : [];
  const unique = new Map();
  authored.slice(0, 48).forEach((command, index) => {
    const normalized = normalizeCommand(command, index);
    if (!unique.has(normalized.id)) unique.set(normalized.id, normalized);
  });
  return [...unique.values()]
    .sort((a, b) => a.priority - b.priority || ACTION_ORDER.indexOf(a.action) - ACTION_ORDER.indexOf(b.action) || a.id.localeCompare(b.id))
    .slice(0, MAX_COMMANDS);
}

function queryText(query) {
  return text(query).toLocaleLowerCase('tr-TR').slice(0, MAX_QUERY);
}

function matches(command, query) {
  if (!query) return true;
  const haystack = [command.action, command.section, command.label, command.hint, command.targetId].join(' ').toLocaleLowerCase('tr-TR');
  return haystack.includes(query);
}

export function createSettlementUxCommandPalette(source) {
  if (!source || typeof source.build !== 'function') throw new TypeError('Settlement UX command palette requires a UI model build().');

  function build(query = '') {
    const view = source.build() ?? {};
    const commands = normalizeCommands(view);
    const normalizedQuery = queryText(query);
    const filtered = commands.filter((command) => matches(command, normalizedQuery));
    const enabled = filtered.filter((command) => command.enabled);
    const blocked = filtered.filter((command) => !command.enabled);
    const primary = enabled[0] ?? filtered[0] ?? null;
    return freeze({
      version: SETTLEMENT_UX_COMMAND_PALETTE_VERSION,
      sourceVersion: finite(view.version, 0),
      revision: finite(view.revision, 0),
      query: normalizedQuery,
      total: filtered.length,
      enabledCount: enabled.length,
      blockedCount: blocked.length,
      primaryCommandId: primary?.id ?? null,
      context: freeze({
        location: text(view.header?.location),
        title: text(view.header?.title, 'Yerleşim'),
        serviceId: text(view.service?.id),
        feedback: clone(view.feedback),
      }),
      commands: freeze(filtered.map((command) => freeze(command))),
    });
  }

  function serialize(query = '') {
    return JSON.stringify(build(query));
  }

  return freeze({ build, serialize });
}
