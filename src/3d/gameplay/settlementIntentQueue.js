/**
 * Deterministic intent queue for the existing settlement campaign runtime.
 * It sequences caller-approved intents without creating a second gameplay authority.
 */
const ACTIONS = new Set(['enter','exit','interact','talk','trade','buy','sell','craft','acceptQuest','advanceQuest','travel','rest','train','save']);
const MAX_INTENTS = 16;
const text = (value, fallback = '') => { const s = String(value ?? '').trim(); return s ? s.slice(0, 160) : fallback; };
const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));
const freeze = (value) => { if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value; Object.freeze(value); Object.values(value).forEach(freeze); return value; };
const normalizeIntent = (raw, index) => {
  const source = raw && typeof raw === 'object' ? raw : {};
  const action = text(source.action);
  return { index, id: text(source.id, `intent-${index + 1}`), action, input: clone(source.input && typeof source.input === 'object' ? source.input : {}), dependsOn: text(source.dependsOn), valid: ACTIONS.has(action) };
};
export function planSettlementIntentQueue(intents = []) {
  const rows = Array.isArray(intents) ? intents.slice(0, MAX_INTENTS).map(normalizeIntent) : [];
  const seen = new Set();
  const planned = rows.map((intent) => {
    const duplicate = seen.has(intent.id); seen.add(intent.id);
    const dependencyMissing = Boolean(intent.dependsOn) && !rows.some((candidate) => candidate.id === intent.dependsOn);
    const blockedReason = !intent.valid ? 'unknown-action' : duplicate ? 'duplicate-id' : dependencyMissing ? 'missing-dependency' : '';
    return { ...intent, status: blockedReason ? 'blocked' : 'queued', blockedReason };
  });
  return freeze({ version: 1, intents: planned, queued: planned.filter((item) => item.status === 'queued').length, blocked: planned.filter((item) => item.status === 'blocked').length });
}
export async function executeSettlementIntentQueue(runtime, intents = [], options = {}) {
  const plan = planSettlementIntentQueue(intents);
  const stopOnFailure = options.stopOnFailure !== false;
  const results = [];
  for (const intent of plan.intents) {
    if (intent.status !== 'queued') { results.push({ id: intent.id, action: intent.action, ok: false, reason: intent.blockedReason }); continue; }
    const dependency = intent.dependsOn ? results.find((item) => item.id === intent.dependsOn) : null;
    if (dependency && dependency.ok !== true) { results.push({ id: intent.id, action: intent.action, ok: false, reason: 'dependency-failed' }); if (stopOnFailure) break; continue; }
    if (!runtime || typeof runtime.execute !== 'function') { results.push({ id: intent.id, action: intent.action, ok: false, reason: 'runtime-unavailable' }); if (stopOnFailure) break; continue; }
    try {
      const response = await runtime.execute(intent.action, { ...intent.input, requestId: text(intent.input.requestId, `queue-${intent.id}`) });
      const ok = response?.ok === true;
      results.push({ id: intent.id, action: intent.action, ok, reason: text(response?.reason, ok ? '' : 'action-rejected') });
      if (!ok && stopOnFailure) break;
    } catch (error) {
      results.push({ id: intent.id, action: intent.action, ok: false, reason: 'execution-threw', message: text(error?.message) });
      if (stopOnFailure) break;
    }
  }
  return freeze({ ...plan, results, completed: results.filter((item) => item.ok).length, failed: results.filter((item) => !item.ok).length });
}
export function serializeSettlementIntentQueue(value) { return JSON.stringify(value && typeof value === 'object' ? value : {}); }
