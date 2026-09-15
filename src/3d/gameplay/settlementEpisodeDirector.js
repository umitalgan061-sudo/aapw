/**
 * Günbatımı Ustası — Playable settlement episode director.
 * Orchestrates authored episode beats over the existing SettlementCampaignRuntime;
 * the runtime remains authoritative for game-state mutation.
 *
 * The director deliberately does not import Three.js, DOM, editor material
 * tooling, terrain code, NPC ownership, player combat code or a second
 * inventory/economy/quest framework.
 */
import {
  createSettlementEpisodeContentResolver,
  getSettlementEpisode,
  getSettlementEpisodeBeat,
  buildSettlementEpisodeManifest,
  validateSettlementEpisodeContent,
} from './settlementEpisodeContent.js';
import {
  getSettlementQuestChain,
  getSettlementQuestChainStep,
  evaluateSettlementQuestChainStep,
} from './settlementCampaignQuestChains.js';

export const SETTLEMENT_EPISODE_DIRECTOR_VERSION = 1;
export const SETTLEMENT_EPISODE_DIRECTOR_LIMITS = Object.freeze({
  history: 96,
  requests: 64,
  text: 180,
  episodes: 6,
  steps: 8,
});

const VALID_PHASES = Object.freeze([
  'idle',
  'entered',
  'service-open',
  'ready',
  'executing',
  'complete',
  'blocked',
  'disposed',
]);

const ACTIONS = Object.freeze([
  'talk',
  'collect',
  'deliver',
  'craft',
  'travel',
  'trade',
  'buy',
  'sell',
  'equip',
  'rest',
  'train',
  'save',
  'interact',
]);

const OPEN_PANEL_BY_ACTION = Object.freeze({
  talk: 'quests',
  craft: 'craft',
  travel: 'travel',
  trade: 'trade',
  buy: 'trade',
  sell: 'trade',
  equip: 'craft',
  rest: 'overview',
  train: 'overview',
  save: 'overview',
  interact: 'overview',
  collect: 'overview',
  deliver: 'overview',
});

const ACTION_TO_RUNTIME = Object.freeze({
  talk: 'talk',
  collect: 'interact',
  deliver: 'interact',
  craft: 'craft',
  travel: 'travel',
  trade: 'trade',
  buy: 'buy',
  sell: 'sell',
  equip: 'interact',
  rest: 'rest',
  train: 'train',
  save: 'save',
  interact: 'interact',
});

const safeText = (value, fallback = '') => {
  const normalized = String(value ?? '').trim();
  return normalized ? normalized.slice(0, SETTLEMENT_EPISODE_DIRECTOR_LIMITS.text) : fallback;
};

const finite = (value, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const integer = (value, minimum, maximum, fallback = minimum) =>
  Math.max(minimum, Math.min(maximum, Math.trunc(finite(value, fallback))));

const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));

const freeze = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) freeze(nested);
  return value;
};

function stable(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
}

function digest(value) {
  let hash = 2166136261;
  const source = stable(value);
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function createHistoryEntry(sequence, type, payload, at) {
  return {
    sequence,
    at: finite(at, 0),
    type: safeText(type, 'event'),
    ...clone(payload),
  };
}

function normalizeRuntimeView(runtime) {
  if (!runtime || typeof runtime.view !== 'function') {
    return {
      ok: false,
      reason: 'runtime-view-unavailable',
      view: null,
    };
  }
  try {
    const view = runtime.view();
    return {
      ok: Boolean(view && typeof view === 'object'),
      reason: view && typeof view === 'object' ? '' : 'runtime-view-invalid',
      view: view && typeof view === 'object' ? clone(view) : null,
    };
  } catch (error) {
    return {
      ok: false,
      reason: safeText(error?.message, 'runtime-view-failed'),
      view: null,
    };
  }
}

function normalizeStepInput(step, input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const normalized = {
    ...clone(source),
    nodeId: safeText(source.nodeId, step.service),
  };
  if (!normalized.itemId && step.target) normalized.itemId = step.target;
  if (!normalized.recipeId && step.recipe) normalized.recipeId = step.recipe;
  if (!normalized.routeId && step.route) normalized.routeId = step.route;
  if (!Number.isFinite(Number(normalized.quantity)) && Number.isFinite(Number(step.quantity))) {
    normalized.quantity = Number(step.quantity);
  }
  if (!normalized.direction && ['buy', 'sell', 'trade'].includes(step.action)) {
    normalized.direction = step.action === 'sell' ? 'sell' : 'buy';
  }
  return normalized;
}

function readRuntimeState(runtime) {
  const state = normalizeRuntimeView(runtime);
  const view = state.view ?? {};
  return {
    ...state,
    activeService: safeText(view.activeService),
    panel: safeText(view.panel, 'overview'),
    route: Array.isArray(view.route) ? view.route.map((value) => safeText(value)).filter(Boolean) : [],
    feedback: view.feedback && typeof view.feedback === 'object' ? clone(view.feedback) : null,
    history: Array.isArray(view.history) ? clone(view.history) : [],
    lastAction: view.lastAction && typeof view.lastAction === 'object' ? clone(view.lastAction) : null,
  };
}

function extractLastAction(result) {
  return result?.lastAction ?? result?.data?.lastAction ?? result?.view?.lastAction ?? null;
}

function resultReason(result) {
  return safeText(
    result?.reason ??
      result?.code ??
      result?.data?.reason ??
      result?.view?.feedback?.code,
    result?.ok === false ? 'action-blocked' : '',
  );
}

function resultMessage(result) {
  return safeText(
    result?.message ??
      result?.data?.message ??
      result?.view?.feedback?.message ??
      result?.view?.feedback?.reason,
  );
}

function resultOk(result) {
  return Boolean(result && typeof result === 'object' && result.ok === true);
}

function sanitizeHistory(history) {
  return history.slice(-SETTLEMENT_EPISODE_DIRECTOR_LIMITS.history);
}

export function createSettlementEpisodeDirector(options = {}) {
  const runtime = options.runtime;
  if (!runtime || typeof runtime.open !== 'function' || typeof runtime.execute !== 'function') {
    throw new TypeError('Settlement Episode Director requires settlementCampaignRuntime.open/execute.');
  }

  const resolver = options.contentResolver ?? createSettlementEpisodeContentResolver();
  const validation = resolver.validation ?? validateSettlementEpisodeContent();
  const now = typeof options.now === 'function' ? options.now : () => Date.now();
  const onEvent = typeof options.onEvent === 'function' ? options.onEvent : null;
  const conditionEvaluator =
    typeof options.conditionEvaluator === 'function'
      ? options.conditionEvaluator
      : null;
  const historyLimit = integer(options.historyLimit, 8, 96, 96);

  let disposed = false;
  let revision = 0;
  let sequence = 0;
  let activeEpisodeId = null;
  let cursor = 0;
  let phase = validation.ok ? 'idle' : 'blocked';
  let history = [];
  let requestIds = [];

  const emit = (name, payload = {}) => {
    if (!onEvent || disposed) return;
    try {
      onEvent({
        name: safeText(name, 'event'),
        at: now(),
        revision,
        ...clone(payload),
      });
    } catch {
      // Consumer telemetry must never break the gameplay owner.
    }
  };

  const addHistory = (type, payload = {}) => {
    sequence += 1;
    history = sanitizeHistory([
      ...history,
      createHistoryEntry(sequence, type, payload, now()),
    ]).slice(-historyLimit);
    revision += 1;
  };

  const guardDisposed = (action) => {
    if (!disposed) return false;
    phase = 'disposed';
    return {
      ok: false,
      action: safeText(action),
      reason: 'disposed',
      message: 'Bölüm oturumu kapatıldı.',
    };
  };

  const getEpisode = () => (activeEpisodeId ? getSettlementEpisode(activeEpisodeId) : null);

  const getBeat = () => {
    const episode = getEpisode();
    if (!episode) return null;
    const step = episode.beats[cursor];
    return step ? getSettlementEpisodeBeat(episode.id, step.stepId) : null;
  };

  const buildConditionView = (chainId, stepId, snapshot) => {
    const step = getSettlementQuestChainStep(chainId, stepId);
    if (!step) return {
      ok: false,
      reason: 'missing-quest-step',
      checks: [],
    };
    if (!conditionEvaluator) {
      return {
        ok: true,
        authoritative: false,
        reason: 'condition-evaluator-not-provided',
        checks: [],
      };
    }
    try {
      const evaluated = evaluateSettlementQuestChainStep(
        chainId,
        stepId,
        snapshot,
        conditionEvaluator,
      );
      return clone(evaluated);
    } catch (error) {
      return {
        ok: false,
        authoritative: false,
        reason: safeText(error?.message, 'condition-evaluation-failed'),
        checks: [],
      };
    }
  };

  const buildState = () => {
    const runtimeState = readRuntimeState(runtime);
    const episode = getEpisode();
    const beat = getBeat();
    const chain = episode ? getSettlementQuestChain(episode.chainId) : null;
    const view = {
      version: SETTLEMENT_EPISODE_DIRECTOR_VERSION,
      revision,
      phase: VALID_PHASES.includes(phase) ? phase : 'blocked',
      episodeId: activeEpisodeId,
      cursor,
      episode: episode ? clone(episode) : null,
      beat: beat ? clone(beat) : null,
      chain: chain ? {
        id: chain.id,
        title: chain.title,
        stepCount: Array.isArray(chain.steps) ? chain.steps.length : 0,
      } : null,
      runtime: runtimeState.view,
      runtimeOk: runtimeState.ok,
      runtimeReason: runtimeState.reason,
      activeService: runtimeState.activeService,
      panel: runtimeState.panel,
      feedback: runtimeState.feedback,
      lastAction: runtimeState.lastAction,
      history: clone(history),
      requestCount: requestIds.length,
      contentValid: validation.ok,
      contentErrors: clone(validation.errors ?? []),
      contentWarnings: clone(validation.warnings ?? []),
    };
    return freeze(view);
  };

  const snapshot = () => buildState();

  const openEpisode = (episodeId, optionsForOpen = {}) => {
    const blocked = guardDisposed('openEpisode');
    if (blocked) return blocked;
    if (!validation.ok) {
      phase = 'blocked';
      return {
        ok: false,
        reason: 'content-invalid',
        errors: clone(validation.errors ?? []),
      };
    }
    const episode = getSettlementEpisode(episodeId);
    if (!episode) {
      phase = 'blocked';
      addHistory('episode-open-blocked', { episodeId, reason: 'unknown-episode' });
      return { ok: false, reason: 'unknown-episode', episodeId };
    }
    activeEpisodeId = episode.id;
    cursor = integer(optionsForOpen.cursor, 0, episode.beats.length - 1, 0);
    phase = 'entered';
    const openResult = runtime.open(
      episode.service,
      OPEN_PANEL_BY_ACTION[episode.beats[cursor]?.action] ?? 'overview',
    );
    revision += 1;
    addHistory('episode-opened', {
      episodeId,
      cursor,
      service: episode.service,
      openOk: resultOk(openResult),
    });
    emit('episode-opened', {
      episodeId,
      cursor,
      service: episode.service,
    });
    return {
      ok: true,
      phase,
      open: clone(openResult),
      view: snapshot(),
      manifestDigest: digest({
        episodeId,
        contentVersion: resolver.version,
      }),
    };
  };

  const setCursor = (index) => {
    const blocked = guardDisposed('setCursor');
    if (blocked) return blocked;
    const episode = getEpisode();
    if (!episode) return { ok: false, reason: 'episode-not-open' };
    const next = integer(index, 0, episode.beats.length, episode.beats.length);
    if (next === episode.beats.length) {
      cursor = next;
      phase = 'complete';
      addHistory('episode-complete', { episodeId: activeEpisodeId });
      emit('episode-complete', { episodeId: activeEpisodeId });
      return { ok: true, complete: true, view: snapshot() };
    }
    cursor = next;
    phase = 'ready';
    revision += 1;
    addHistory('beat-selected', {
      episodeId: activeEpisodeId,
      cursor,
      stepId: episode.beats[cursor]?.stepId,
    });
    return { ok: true, complete: false, view: snapshot() };
  };

  const next = () => {
    const blocked = guardDisposed('next');
    if (blocked) return blocked;
    if (!activeEpisodeId) return { ok: false, reason: 'episode-not-open' };
    return setCursor(cursor + 1);
  };

  const previous = () => {
    const blocked = guardDisposed('previous');
    if (blocked) return blocked;
    if (!activeEpisodeId) return { ok: false, reason: 'episode-not-open' };
    return setCursor(Math.max(0, cursor - 1));
  };

  const openCurrentService = () => {
    const blocked = guardDisposed('openCurrentService');
    if (blocked) return blocked;
    const beat = getBeat();
    if (!beat) return { ok: false, reason: 'no-current-beat' };
    const panel = OPEN_PANEL_BY_ACTION[beat.action] ?? 'overview';
    const result = runtime.open(beat.service, panel);
    phase = resultOk(result) ? 'service-open' : 'blocked';
    addHistory('service-opened', {
      episodeId: activeEpisodeId,
      cursor,
      service: beat.service,
      panel,
      ok: resultOk(result),
    });
    emit('service-opened', {
      episodeId: activeEpisodeId,
      cursor,
      service: beat.service,
      panel,
    });
    return {
      ok: resultOk(result),
      result: clone(result),
      view: snapshot(),
    };
  };

  const closeService = () => {
    const blocked = guardDisposed('closeService');
    if (blocked) return blocked;
    if (typeof runtime.close !== 'function') return {
      ok: false,
      reason: 'runtime-close-unavailable',
    };
    const result = runtime.close();
    phase = resultOk(result) ? 'entered' : 'blocked';
    addHistory('service-closed', {
      episodeId: activeEpisodeId,
      cursor,
      ok: resultOk(result),
    });
    emit('service-closed', {
      episodeId: activeEpisodeId,
      cursor,
    });
    return { ok: resultOk(result), result: clone(result), view: snapshot() };
  };

  const prepareCurrent = (input = {}) => {
    const blocked = guardDisposed('prepareCurrent');
    if (blocked) return blocked;
    const beat = getBeat();
    if (!beat) return { ok: false, reason: 'no-current-beat' };
    const step = getSettlementQuestChainStep(activeEpisodeId, beat.stepId);
    if (!step) return { ok: false, reason: 'missing-quest-step' };
    const runtimeState = readRuntimeState(runtime);
    const prepared = {
      ok: true,
      episodeId: activeEpisodeId,
      cursor,
      stepId: beat.stepId,
      action: beat.action,
      runtimeAction: ACTION_TO_RUNTIME[beat.action] ?? beat.action,
      service: beat.service,
      panel: OPEN_PANEL_BY_ACTION[beat.action] ?? 'overview',
      input: normalizeStepInput(step, input),
      runtime: runtimeState.view,
      conditionView: null,
    };
    const callerSnapshot = options.snapshot
      ? clone(typeof options.snapshot === 'function' ? options.snapshot() : options.snapshot)
      : null;
    if (callerSnapshot && conditionEvaluator) {
      prepared.conditionView = buildConditionView(activeEpisodeId, beat.stepId, callerSnapshot);
    }
    return freeze(prepared);
  };

  const executeCurrent = async (input = {}) => {
    const blocked = guardDisposed('executeCurrent');
    if (blocked) return blocked;
    if (!activeEpisodeId) return { ok: false, reason: 'episode-not-open' };
    const beat = getBeat();
    if (!beat) return { ok: false, reason: 'no-current-beat' };
    if (!ACTIONS.includes(beat.action)) {
      phase = 'blocked';
      return { ok: false, reason: 'unsupported-episode-action', action: beat.action };
    }
    const requestId = safeText(
      input?.requestId,
      `episode-${activeEpisodeId}-${beat.stepId}-${cursor}-${sequence + 1}`,
    );
    if (requestIds.includes(requestId)) {
      phase = 'blocked';
      addHistory('request-duplicate', {
        episodeId: activeEpisodeId,
        stepId: beat.stepId,
        requestId,
      });
      return { ok: false, reason: 'duplicate-request', requestId };
    }
    requestIds = [...requestIds, requestId].slice(-64);
    const prepared = prepareCurrent(input);
    phase = 'executing';
    addHistory('action-dispatched', {
      episodeId: activeEpisodeId,
      stepId: beat.stepId,
      action: beat.action,
      requestId,
    });
    emit('action-dispatched', {
      episodeId: activeEpisodeId,
      stepId: beat.stepId,
      action: beat.action,
      requestId,
    });

    let result;
    try {
      result = await runtime.execute(
        ACTION_TO_RUNTIME[beat.action] ?? beat.action,
        {
          ...prepared.input,
          requestId,
          nodeId: prepared.input.nodeId || beat.service,
          episodeId: activeEpisodeId,
          episodeStepId: beat.stepId,
        },
      );
    } catch (error) {
      result = {
        ok: false,
        reason: 'runtime-threw',
        message: safeText(error?.message, 'Yerleşim işlemi sırasında hata oluştu.'),
      };
    }

    const ok = resultOk(result);
    const payload = {
      ok,
      episodeId: activeEpisodeId,
      cursor,
      stepId: beat.stepId,
      action: beat.action,
      requestId,
      reason: resultReason(result),
      message: resultMessage(result),
      lastAction: clone(extractLastAction(result)),
    };

    if (ok) {
      addHistory('action-succeeded', payload);
      emit('action-succeeded', payload);
      phase = cursor + 1 >= (getEpisode()?.beats.length ?? SETTLEMENT_EPISODE_DIRECTOR_LIMITS.steps)
        ? 'complete'
        : 'ready';
      if (phase === 'complete') {
        addHistory('episode-complete', {
          episodeId: activeEpisodeId,
          cursor,
          stepId: beat.stepId,
        });
        emit('episode-complete', {
          episodeId: activeEpisodeId,
          cursor,
        });
      } else {
        cursor += 1;
        addHistory('advanced-after-success', {
          episodeId: activeEpisodeId,
          cursor,
          stepId: getEpisode()?.beats[cursor]?.stepId,
        });
      }
      revision += 1;
    } else {
      phase = 'blocked';
      addHistory('action-blocked', payload);
      emit('action-blocked', payload);
      revision += 1;
    }

    return {
      ok,
      action: beat.action,
      runtimeAction: ACTION_TO_RUNTIME[beat.action] ?? beat.action,
      result: clone(result),
      completedStep: ok ? beat.stepId : null,
      nextStep: ok ? getEpisode()?.beats[cursor]?.stepId ?? null : beat.stepId,
      phase,
      view: snapshot(),
    };
  };

  const chooseEpisode = (episodeId) => {
    const blocked = guardDisposed('chooseEpisode');
    if (blocked) return blocked;
    return openEpisode(episodeId);
  };

  const reset = () => {
    const blocked = guardDisposed('reset');
    if (blocked) return blocked;
    activeEpisodeId = null;
    cursor = 0;
    phase = validation.ok ? 'idle' : 'blocked';
    requestIds = [];
    history = [];
    sequence = 0;
    revision += 1;
    addHistory('reset', {});
    emit('reset', {});
    return { ok: true, view: snapshot() };
  };

  const manifest = () => freeze({
    ...buildSettlementEpisodeManifest(),
    directorVersion: SETTLEMENT_EPISODE_DIRECTOR_VERSION,
    activeEpisodeId,
    cursor,
    phase,
    digest: digest({
      content: buildSettlementEpisodeManifest(),
      activeEpisodeId,
      cursor,
      phase,
    }),
  });

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    phase = 'disposed';
    activeEpisodeId = null;
    cursor = 0;
    requestIds = [];
    history = [];
    revision += 1;
    emit('disposed', {});
  };

  return Object.freeze({
    version: SETTLEMENT_EPISODE_DIRECTOR_VERSION,
    openEpisode,
    chooseEpisode,
    next,
    previous,
    setCursor,
    openCurrentService,
    closeService,
    prepareCurrent,
    executeCurrent,
    snapshot,
    reset,
    manifest,
    dispose,
  });
}
