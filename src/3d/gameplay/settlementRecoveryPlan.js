/**
 * Deterministic recovery guidance over the existing settlement campaign runtime.
 * This module never mutates quest, inventory, economy, travel or save state.
 */

export const SETTLEMENT_RECOVERY_PLAN_VERSION = 1;
const MAX_TEXT = 160;
const text = (value, fallback = '') => {
  const normalized = String(value ?? '').trim();
  return normalized ? normalized.slice(0, MAX_TEXT) : fallback;
};
const finite = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};
const clamp = (value, min, max, fallback = min) => Math.max(min, Math.min(max, finite(value, fallback)));
const stable = (value) => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
};
const digest = (value) => {
  let hash = 2166136261;
  const source = stable(value);
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};
const freeze = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freeze(child);
  return Object.freeze(value);
};

function normalizeFeedback(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  return {
    status: text(source.status, 'none'),
    code: text(source.code),
    action: text(source.action),
    message: text(source.message),
  };
}

function normalizeView(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const activeService = text(source.activeService ?? source.service?.id);
  const panel = text(source.panel, 'overview');
  const route = Array.isArray(source.route) ? source.route.map((item) => text(item)).filter(Boolean).slice(-24) : [];
  const feedback = normalizeFeedback(source.feedback ?? source.lastFeedback);
  const revision = Math.max(0, Math.trunc(finite(source.revision, 0)));
  const inside = source.insideSettlement !== false && Boolean(source.settlementId || source.locationId || activeService);
  const defeated = Boolean(source.defeated || source.isDefeated);
  const canSave = source.canSave !== false && !defeated;
  return { activeService, panel, route, feedback, revision, inside, defeated, canSave };
}

function pickStep(view) {
  if (!view.inside) return { id: 'enter', action: 'enter', reason: 'outside-settlement', label: 'Yerleşime gir' };
  if (view.defeated) return { id: 'recover', action: 'rest', reason: 'defeated', label: 'İyileş ve dinlen' };
  if (view.feedback.status === 'error') return { id: 'resume', action: 'open', reason: 'last-action-failed', label: 'Son hizmeti yeniden aç' };
  if (view.feedback.status === 'blocked') return { id: 'resolve-blocker', action: 'inspect', reason: view.feedback.code || 'blocked', label: 'Engeli incele' };
  if (!view.activeService) return { id: 'choose-service', action: 'open', reason: 'no-active-service', label: 'Bir hizmet seç' };
  if (view.canSave && view.panel !== 'overview') return { id: 'checkpoint', action: 'save', reason: 'checkpoint-available', label: 'Yerleşim kaydı al' };
  return { id: 'continue', action: view.panel === 'overview' ? 'interact' : 'open', reason: 'continue-route', label: 'Yolculuğa devam et' };
}

export function buildSettlementRecoveryPlan(rawView = {}) {
  const view = normalizeView(rawView);
  const step = pickStep(view);
  const plan = {
    version: SETTLEMENT_RECOVERY_PLAN_VERSION,
    context: {
      insideSettlement: view.inside,
      defeated: view.defeated,
      activeService: view.activeService || null,
      panel: view.panel,
      revision: view.revision,
    },
    lastFeedback: view.feedback,
    route: view.route,
    primary: step,
    alternatives: [
      view.canSave ? { id: 'save', action: 'save', label: 'Kaydet' } : null,
      view.activeService ? { id: 'close', action: 'close', label: 'Hizmeti kapat' } : null,
      view.inside ? { id: 'travel', action: 'travel', label: 'Seyahat planla' } : null,
    ].filter(Boolean),
    evidence: {
      failClosed: !view.inside || view.defeated,
      resumeEligible: view.inside && !view.defeated && Boolean(view.activeService || view.route.length),
      source: 'settlementCampaignRuntime.view',
    },
  };
  plan.fingerprint = digest(plan);
  return freeze(plan);
}

export function validateSettlementRecoveryPlan(plan) {
  if (!plan || typeof plan !== 'object') return { ok: false, reason: 'invalid-plan' };
  if (plan.version !== SETTLEMENT_RECOVERY_PLAN_VERSION) return { ok: false, reason: 'version-mismatch' };
  if (!plan.primary || !text(plan.primary.action)) return { ok: false, reason: 'missing-primary-step' };
  if (!plan.fingerprint || plan.fingerprint !== digest({ ...plan, fingerprint: undefined })) return { ok: false, reason: 'fingerprint-mismatch' };
  return { ok: true, reason: '' };
}
