const ACTIONS = Object.freeze(['light', 'heavy', 'ranged']);
const PHASES = Object.freeze(['idle', 'windup', 'active', 'recovery']);

const clamp = (value, min, max) => Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
const finite = (value, fallback = 0) => (Number.isFinite(value) ? value : fallback);
const cleanId = (value, fallback = 'unknown') => String(value ?? fallback).trim().slice(0, 80) || fallback;

function normalizeAction(action) {
  const value = String(action ?? '').trim().toLowerCase();
  return ACTIONS.includes(value) ? value : null;
}

function normalizePhase(phase) {
  const value = String(phase ?? '').trim().toLowerCase();
  return PHASES.includes(value) ? value : 'idle';
}

function normalizeLinks(links) {
  if (!Array.isArray(links)) return [];
  const seen = new Set();
  return links.flatMap((link) => {
    const from = normalizeAction(link?.from);
    const to = normalizeAction(link?.to);
    if (!from || !to) return [];
    const key = `${from}>${to}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ from, to, windowMs: clamp(finite(link?.windowMs, 450), 0, 2000) }];
  });
}

export function buildPlayerComboChainDirector(input = {}) {
  const phase = normalizePhase(input.phase);
  const currentAction = normalizeAction(input.currentAction);
  const requestedAction = normalizeAction(input.requestedAction);
  const elapsedMs = clamp(finite(input.elapsedMs, 0), 0, 10000);
  const queueWindowMs = clamp(finite(input.queueWindowMs, 350), 0, 2000);
  const links = normalizeLinks(input.links);
  const currentLink = links.find((link) => link.from === currentAction && link.to === requestedAction) || null;
  const sameAction = Boolean(currentAction && requestedAction && currentAction === requestedAction);
  const inRecovery = phase === 'recovery';
  const canQueue = Boolean(currentLink && inRecovery && elapsedMs <= currentLink.windowMs && elapsedMs <= queueWindowMs);
  const queuedAction = canQueue ? requestedAction : null;
  const rejection = requestedAction && !canQueue
    ? (phase !== 'recovery' ? 'outside-recovery' : !currentLink ? 'unlinked-action' : 'window-expired')
    : null;
  const step = queuedAction ? `${cleanId(input.chainId, 'default')}:${queuedAction}` : null;

  return Object.freeze({
    chainId: cleanId(input.chainId, 'default'),
    phase,
    currentAction,
    requestedAction,
    elapsedMs,
    queueWindowMs,
    links,
    sameAction,
    canQueue,
    queuedAction,
    rejection,
    step,
    nextPhase: queuedAction ? 'windup' : phase,
  });
}

export function serializePlayerComboChainDirector(snapshot) {
  return JSON.stringify(snapshot);
}
