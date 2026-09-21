/**
 * Settlement vertical-slice presentation model.
 *
 * The UI consumes a coordinator snapshot and role-content metadata, but this module never owns
 * gameplay state. It creates stable labels, affordance groups, journey progress and safe feedback
 * strings suitable for the existing UI shell.
 */

export const SETTLEMENT_UI_MODEL_VERSION = 1;

const ACTION_GROUPS = Object.freeze({
  movement: Object.freeze(new Set(['enter', 'exit', 'travel', 'back'])),
  social: Object.freeze(new Set(['talk', 'interact', 'acceptQuest', 'advanceQuest'])),
  commerce: Object.freeze(new Set(['trade'])),
  crafting: Object.freeze(new Set(['craft'])),
  persistence: Object.freeze(new Set(['save'])),
});

const ROLE_GROUPS = Object.freeze({
  gate: 'movement',
  stable: 'movement',
  tavern: 'social',
  barracks: 'social',
  house: 'persistence',
  market: 'commerce',
  farm: 'commerce',
  blacksmith: 'crafting',
});

const STATUS_MESSAGES = Object.freeze({
  'action-unavailable': 'Bu işlem şu anda kullanılamıyor.',
  'handler-unavailable': 'İşlem hizmeti hazır değil.',
  'handler-threw': 'İşlem sırasında güvenli bir hata oluştu.',
  'stale-node': 'Menü güncellendi; lütfen işlemi yeniden seç.',
  'node-not-found': 'Yerleşim noktası bulunamadı.',
  'item-required': 'Gerekli eşya sende bulunmuyor.',
  'reputation-too-low': 'İtibarın henüz yeterli değil.',
  'quest-required': 'Görev durumu bu seçeneğe izin vermiyor.',
  'flag-required': 'Bu seçenek şu anda kilitli.',
  'too-far': 'Etkileşim için biraz yaklaşmalısın.',
  'capability-unavailable': 'Bu hizmet şu anda kullanılamıyor.',
  'snapshot-node-gated': 'Kayıtlı konum artık erişilebilir değil.',
  'snapshot-node-mismatch': 'Kayıtlı konum bulunamadı; giriş noktasına dönüldü.',
  'unsupported-snapshot-version': 'Kayıt sürümü desteklenmiyor.',
});

function clean(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text ? text.slice(0, 160) : fallback;
}

function positiveInt(value, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.trunc(number));
}

function actionGroup(action) {
  for (const [group, actions] of Object.entries(ACTION_GROUPS)) {
    if (actions.has(action)) return group;
  }
  return 'other';
}

function stableHash(value) {
  const source = typeof value === 'string' ? value : stable(value);
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function stable(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
}

export function statusMessage(reason, fallback = 'İşlem gerçekleştirilemedi.') {
  return STATUS_MESSAGES[clean(reason)] || fallback;
}

export function classifySettlementAction(action) {
  const normalized = clean(action);
  return Object.freeze({ action: normalized, group: actionGroup(normalized), destructive: normalized === 'exit' || normalized === 'travel', primary: normalized !== 'back' });
}

export function buildSettlementActionItems(snapshot = {}) {
  const actions = Array.isArray(snapshot.actions) ? snapshot.actions.map(clean).filter(Boolean).slice(0, 8) : [];
  return Object.freeze(actions.map((action, index) => Object.freeze({
    index,
    action,
    group: actionGroup(action),
    label: clean(snapshot.actionLabels?.[action], action),
    enabled: true,
  })));
}

export function buildSettlementProgressSummary(contentJourney, completedRoles = []) {
  const beats = Array.isArray(contentJourney?.beats) ? contentJourney.beats : [];
  const completed = new Set(Array.isArray(completedRoles) ? completedRoles.map(clean).filter(Boolean) : []);
  const progress = beats.slice(0, 8).map((beat, index) => {
    const role = clean(beat?.role);
    return Object.freeze({
      index,
      role,
      targetId: clean(beat?.targetId),
      required: beat?.required === true,
      complete: completed.has(role),
      label: clean(beat?.hint, role),
    });
  });
  const completedCount = progress.filter((entry) => entry.complete).length;
  const requiredCount = progress.filter((entry) => entry.required).length;
  const completedRequiredCount = progress.filter((entry) => entry.required && entry.complete).length;
  return Object.freeze({
    total: progress.length,
    completedCount,
    remainingCount: Math.max(0, progress.length - completedCount),
    requiredCount,
    completedRequiredCount,
    complete: progress.length > 0 && completedCount === progress.length,
    next: progress.find((entry) => !entry.complete) || null,
    progress: Object.freeze(progress),
  });
}

export function buildSettlementServiceSummary(contentJourney, completedRoles = []) {
  const progress = buildSettlementProgressSummary(contentJourney, completedRoles);
  const roles = Object.freeze(progress.progress.map((entry) => Object.freeze({
    role: entry.role,
    group: ROLE_GROUPS[entry.role] || 'other',
    visited: entry.complete,
    targetId: entry.targetId,
  })));
  return Object.freeze({
    chapter: clean(contentJourney?.chapter, 'custom'),
    settlementId: clean(contentJourney?.settlementId),
    roles,
    progress,
    fingerprint: stableHash({ chapter: contentJourney?.chapter, settlementId: contentJourney?.settlementId, roles, completedRoles: [...(completedRoles || [])].sort() }),
  });
}

export function buildSettlementSliceUiModel(snapshot = {}, contentJourney = null, options = {}) {
  const nodeId = clean(snapshot.nodeId);
  const nodeKind = clean(snapshot.nodeKind, 'settlement');
  const nodeLabel = clean(snapshot.nodeLabel, nodeId || 'Yerleşim');
  const actionItems = buildSettlementActionItems(snapshot);
  const role = clean(options.role || snapshot.role);
  const serviceGroup = ROLE_GROUPS[role] || (nodeKind === 'vendor' ? 'commerce' : nodeKind === 'crafting' ? 'crafting' : nodeKind === 'door' ? 'movement' : nodeKind === 'save' ? 'persistence' : 'social');
  const progress = buildSettlementServiceSummary(contentJourney, options.completedRoles || []);
  const primary = actionItems.filter((item) => item.action !== 'back').slice(0, 6);
  const secondary = actionItems.filter((item) => item.action === 'back');
  return Object.freeze({
    version: SETTLEMENT_UI_MODEL_VERSION,
    sliceId: clean(snapshot.sliceId),
    settlementId: clean(snapshot.settlementId),
    node: Object.freeze({ id: nodeId, kind: nodeKind, label: nodeLabel, role }),
    serviceGroup,
    actions: actionItems,
    primaryActions: Object.freeze(primary),
    secondaryActions: Object.freeze(secondary),
    journey: progress,
    contextFingerprint: clean(snapshot.contextFingerprint),
    snapshotFingerprint: clean(snapshot.fingerprint),
    title: nodeLabel,
    subtitle: serviceGroup === 'commerce' ? 'Alışveriş ve tedarik' : serviceGroup === 'crafting' ? 'Üretim ve ustalık' : serviceGroup === 'persistence' ? 'Dinlenme ve kayıt' : serviceGroup === 'movement' ? 'Giriş ve yolculuk' : 'Konuşma ve görevler',
    fingerprint: stableHash({ nodeId, nodeKind, role, actions: actionItems.map((item) => item.action), journey: progress.fingerprint }),
  });
}

export function buildSettlementFeedback(result = {}) {
  const ok = result?.ok === true;
  return Object.freeze({
    ok,
    tone: ok ? 'success' : 'warning',
    reason: clean(result?.reason),
    title: ok ? 'İşlem tamamlandı' : 'İşlem yapılamadı',
    message: ok ? clean(result?.message, 'İşlem tamamlandı.') : statusMessage(result?.reason),
    nodeId: clean(result?.nodeId),
    action: clean(result?.action),
    fingerprint: clean(result?.snapshot?.fingerprint),
  });
}

export function buildSettlementEmptyState(snapshot = {}) {
  const nodeLabel = clean(snapshot.nodeLabel, 'Yerleşim');
  return Object.freeze({
    title: nodeLabel,
    message: 'Burada kullanılabilir bir işlem yok.',
    actions: Object.freeze([]),
    fingerprint: stableHash({ nodeId: clean(snapshot.nodeId), nodeKind: clean(snapshot.nodeKind), empty: true }),
  });
}

export function buildSettlementJourneyCallout(contentJourney, completedRoles = []) {
  const progress = buildSettlementProgressSummary(contentJourney, completedRoles);
  if (!progress.total) return Object.freeze({ visible: false, title: '', message: '', nextRole: '', targetId: '' });
  if (progress.complete) return Object.freeze({ visible: true, title: 'Yerleşim turu tamamlandı', message: 'Bu yerleşimde planlanan hizmet adımlarının hepsi tamamlandı.', nextRole: '', targetId: '' });
  const next = progress.next;
  return Object.freeze({
    visible: true,
    title: 'Sıradaki adım',
    message: clean(next?.label, 'Sonraki hizmet noktasına ilerle.'),
    nextRole: clean(next?.role),
    targetId: clean(next?.targetId),
  });
}

export function buildSettlementRoleBadge(role) {
  const normalized = clean(role);
  const labels = {
    gate: 'Kapı',
    market: 'Pazar',
    tavern: 'Han',
    blacksmith: 'Demirci',
    farm: 'Çiftlik',
    barracks: 'Kışla',
    stable: 'Ahır',
    house: 'Ev',
  };
  return Object.freeze({
    role: normalized,
    label: labels[normalized] || normalized,
    group: ROLE_GROUPS[normalized] || 'other',
    known: Boolean(labels[normalized]),
  });
}

export function validateSettlementUiModel(model = {}) {
  const errors = [];
  if (model.version !== SETTLEMENT_UI_MODEL_VERSION) errors.push('unsupported-version');
  if (!clean(model.settlementId)) errors.push('missing-settlement-id');
  if (!model.node || !clean(model.node.id)) errors.push('missing-node');
  if (!Array.isArray(model.actions)) errors.push('missing-actions');
  if (Array.isArray(model.actions) && model.actions.length > 8) errors.push('too-many-actions');
  if (!model.journey || typeof model.journey !== 'object') errors.push('missing-journey');
  return Object.freeze({ ok: errors.length === 0, errors: Object.freeze(errors) });
}

export function buildSettlementNavigationTrail(snapshot = {}, history = []) {
  const source = Array.isArray(history) ? history : [];
  const trail = source.slice(-8).map((entry, index) => Object.freeze({
    index,
    nodeId: clean(entry?.nodeId),
    action: clean(entry?.action),
    label: clean(entry?.label, clean(entry?.nodeId)),
  }));
  const current = { nodeId: clean(snapshot.nodeId), label: clean(snapshot.nodeLabel, clean(snapshot.nodeId)) };
  if (!trail.some((entry) => entry.nodeId === current.nodeId)) trail.push(Object.freeze({ index: trail.length, nodeId: current.nodeId, action: '', label: current.label }));
  return Object.freeze(trail.slice(-8));
}

export function buildSettlementRiskHint(snapshot = {}, options = {}) {
  const distance = Number(options.distance ?? snapshot.distance);
  if (Number.isFinite(distance) && distance > 10) return Object.freeze({ visible: true, severity: 'info', message: 'Etkileşim için biraz yaklaş.' });
  if (options.stale === true) return Object.freeze({ visible: true, severity: 'warning', message: 'Menü eski bir durumu gösteriyor. Güncel seçenekleri yeniden aç.' });
  return Object.freeze({ visible: false, severity: 'none', message: '' });
}
