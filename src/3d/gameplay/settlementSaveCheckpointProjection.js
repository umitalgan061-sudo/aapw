const VERSION = 1;

const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const text = (value, fallback = '') => typeof value === 'string' && value.trim() ? value.trim() : fallback;
const bool = (value) => value === true;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const stable = (value) => {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((out, key) => {
      out[key] = stable(value[key]);
      return out;
    }, {});
  }
  return value;
};

const digest = (value) => JSON.stringify(stable(value));

const freezeDeep = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(freezeDeep);
  return Object.freeze(value);
};

export function createSettlementSaveCheckpointProjection(input = {}) {
  const settlement = input.settlement && typeof input.settlement === 'object' ? input.settlement : {};
  const persistence = input.persistence && typeof input.persistence === 'object' ? input.persistence : {};
  const quest = input.quest && typeof input.quest === 'object' ? input.quest : {};
  const services = input.services && typeof input.services === 'object' ? input.services : {};

  const inside = bool(settlement.inside) && !bool(settlement.defeated);
  const saveSupported = bool(persistence.saveSupported);
  const loadSupported = bool(persistence.loadSupported);
  const dirty = bool(persistence.dirty);
  const lastSaveAge = clamp(finite(persistence.lastSaveAgeSeconds, 0), 0, 86400 * 30);
  const autosaveInterval = clamp(finite(persistence.autosaveIntervalSeconds, 300), 30, 3600);
  const completedQuestSteps = Math.max(0, Math.floor(finite(quest.completedSteps, 0)));
  const completedServices = Math.max(0, Math.floor(finite(services.completed, 0)));
  const saveReason = text(persistence.reason, dirty ? 'settlement-progress' : 'checkpoint-clean');
  const nextAction = inside && saveSupported
    ? (dirty ? 'save' : (loadSupported ? 'load-or-continue' : 'continue'))
    : 'return-to-settlement';
  const due = inside && saveSupported && (dirty || lastSaveAge >= autosaveInterval);
  const blockers = [];
  if (!inside) blockers.push('outside-settlement');
  if (!saveSupported) blockers.push('save-unavailable');
  if (bool(settlement.defeated)) blockers.push('settlement-defeated');

  const payload = {
    version: VERSION,
    settlementId: text(settlement.id, 'unknown-settlement'),
    inside,
    defeated: bool(settlement.defeated),
    save: {
      supported: saveSupported,
      loadSupported,
      dirty,
      due,
      lastSaveAgeSeconds: lastSaveAge,
      autosaveIntervalSeconds: autosaveInterval,
      reason: saveReason,
    },
    progress: {
      completedQuestSteps,
      completedServices,
      totalSignals: completedQuestSteps + completedServices,
    },
    blockers,
    nextAction,
    fingerprint: '',
  };

  payload.fingerprint = digest({ ...payload, fingerprint: undefined });
  return freezeDeep(payload);
}

export function validateSettlementSaveCheckpointProjection(value) {
  if (!value || typeof value !== 'object') return false;
  if (value.version !== VERSION) return false;
  if (typeof value.inside !== 'boolean' || typeof value.defeated !== 'boolean') return false;
  if (!value.save || typeof value.save !== 'object') return false;
  if (!value.progress || typeof value.progress !== 'object') return false;
  if (!Array.isArray(value.blockers) || typeof value.fingerprint !== 'string') return false;
  if (value.inside && value.defeated) return false;
  if (!value.save.supported && value.save.due) return false;
  return true;
}

export { VERSION as SETTLEMENT_SAVE_CHECKPOINT_VERSION };
