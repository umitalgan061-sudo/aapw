/**
 * Accessibility-focused settlement UX semantics.
 * Presentation remains read-only; keyboard/focus ownership stays with the app shell.
 */
export const SETTLEMENT_ACCESSIBILITY_VERSION = 1;

const ACTION_ORDER = Object.freeze([
  'enter',
  'talk',
  'trade',
  'craft',
  'equip',
  'acceptQuest',
  'advanceQuest',
  'rest',
  'save',
  'travel',
  'exit',
]);

const SECTION_LABELS = Object.freeze({
  navigation: 'Gezinme',
  dialogue: 'Diyalog',
  economy: 'Ekonomi',
  crafting: 'Üretim',
  equipment: 'Ekipman',
  quest: 'Görev',
  survival: 'Hayatta Kalma',
  persistence: 'Kayıt',
});

const text = (value, fallback = '') => {
  const normalized = String(value ?? '').trim();
  return normalized ? normalized.slice(0, 160) : fallback;
};

const clone = (value) => (value == null ? value : JSON.parse(JSON.stringify(value)));

export function buildSettlementFocusOrder(actions = ACTION_ORDER) {
  const source = Array.isArray(actions) ? actions : [];
  const known = new Set(ACTION_ORDER);
  const filtered = source.filter((action) => known.has(action));
  return [...new Set(filtered)];
}

export function buildSettlementActionLabel(action, context = {}) {
  const labels = {
    enter: 'Yerleşime gir',
    talk: 'Konuş',
    trade: 'Takas yap',
    craft: 'Üret',
    equip: 'Kuşan',
    acceptQuest: 'Görevi kabul et',
    advanceQuest: 'Görevi ilerlet',
    rest: 'Dinlen',
    save: 'Oyunu kaydet',
    travel: 'Yola çık',
    exit: 'Dışarı çık',
  };
  const service = text(context.service);
  return service && labels[action]
    ? `${labels[action]} · ${service}`
    : labels[action] ?? text(action, 'Etkileşim');
}

export function buildSettlementAriaAction(action, context = {}) {
  const label = buildSettlementActionLabel(action, context);
  const disabled = context.enabled === false;
  return {
    action: text(action),
    role: 'button',
    label,
    ariaLabel: disabled ? `${label} (kullanılamıyor)` : label,
    disabled,
    tabIndex: disabled ? -1 : 0,
  };
}

export function buildSettlementPanelSemantics(panel, context = {}) {
  const normalized = text(panel, 'overview');
  const title = {
    overview: 'Yerleşim',
    trade: 'Pazar ve Takas',
    craft: 'Demircilik ve Üretim',
    travel: 'Seyahat',
    quests: 'Görevler',
    perks: 'Yetenek ve Avantajlar',
  }[normalized] ?? 'Yerleşim';
  const service = text(context.service);
  return {
    panel: normalized,
    title,
    headingId: `settlement-${normalized}-heading`,
    regionRole: 'region',
    regionLabelledBy: `settlement-${normalized}-heading`,
    service,
  };
}

export function buildSettlementSectionLabels(actions = []) {
  const sections = [];
  const seen = new Set();
  for (const action of buildSettlementFocusOrder(actions)) {
    const section = action === 'trade' || action === 'buy' || action === 'sell'
      ? SECTION_LABELS.economy
      : action === 'craft'
        ? SECTION_LABELS.crafting
        : action === 'equip'
          ? SECTION_LABELS.equipment
          : action === 'acceptQuest' || action === 'advanceQuest'
            ? SECTION_LABELS.quest
            : action === 'rest'
              ? SECTION_LABELS.survival
              : action === 'save'
                ? SECTION_LABELS.persistence
                : action === 'talk'
                  ? SECTION_LABELS.dialogue
                  : SECTION_LABELS.navigation;
    if (!seen.has(section)) {
      seen.add(section);
      sections.push({ id: text(action), label: section });
    }
  }
  return sections;
}

export function buildSettlementLiveRegion(feedback = {}) {
  const status = text(feedback.status, 'info');
  return {
    role: status === 'error' || status === 'warning' ? 'alert' : 'status',
    ariaLive: status === 'error' || status === 'warning' ? 'assertive' : 'polite',
    atomic: true,
    message: text(feedback.message, 'Yerleşim durumu güncellendi.'),
  };
}

export function buildSettlementKeyboardHints() {
  return [
    { key: 'Enter', action: 'activate', label: 'Seçili işlemi çalıştır' },
    { key: 'Escape', action: 'back', label: 'Paneli kapat' },
    { key: 'ArrowUp', action: 'previous', label: 'Önceki işlemi seç' },
    { key: 'ArrowDown', action: 'next', label: 'Sonraki işlemi seç' },
    { key: 'Tab', action: 'focus-next', label: 'Sonraki erişilebilir kontrole geç' },
  ];
}

export function buildSettlementAccessibilityModel(view = {}) {
  const actions = Array.isArray(view.availableActions) ? view.availableActions : [];
  const service = view.activeService?.label ?? view.activeService?.id ?? '';
  return {
    version: SETTLEMENT_ACCESSIBILITY_VERSION,
    panel: buildSettlementPanelSemantics(view.panel, { service }),
    actions: actions.map((action) => buildSettlementAriaAction(action, { service, enabled: !view.feedback || view.feedback.action !== action || view.feedback.status !== 'blocked' })),
    sections: buildSettlementSectionLabels(actions),
    liveRegion: buildSettlementLiveRegion(view.feedback),
    keyboard: buildSettlementKeyboardHints(),
    focusOrder: buildSettlementFocusOrder(actions),
  };
}

export function validateSettlementAccessibilityModel(model) {
  const errors = [];
  if (model?.version !== 1) errors.push('version');
  if (!model?.panel?.headingId) errors.push('heading');
  if (!Array.isArray(model?.actions)) errors.push('actions');
  if (!Array.isArray(model?.keyboard)) errors.push('keyboard');
  if (!model?.liveRegion?.role) errors.push('live-region');
  if (model?.actions?.some((item) => item.tabIndex < -1)) errors.push('tab-index');
  return { ok: errors.length === 0, errors };
}

export function cloneSettlementAccessibilityModel(model) {
  return clone(buildSettlementAccessibilityModel(model));
}
