/**
 * Runtime bridge for the settlement world-coverage slice.
 *
 * The existing settlementCampaignRuntime remains authoritative. This adapter
 * only translates its public-facing snapshot/handler seams into the world
 * coverage session. It never imports DOM/editor code and never owns a second
 * quest, inventory, economy, crafting, travel or persistence framework.
 */
import { createSettlementWorldCoverageSession, createSettlementWorldCoveragePlan, validateSettlementWorldCoveragePlan } from './settlementWorldCoverageSlice.js';
import { createSettlementWorldCoverageAcceptance, createSettlementWorldCoverageProof } from './settlementWorldCoverageAcceptance.js';

export const SETTLEMENT_WORLD_COVERAGE_RUNTIME_ADAPTER_VERSION = 1;

const text = (value, fallback = '') => {
  const normalized = String(value ?? '').trim();
  return normalized ? normalized.slice(0, 180) : fallback;
};
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const integer = (value, min, max, fallback = min) => Math.max(min, Math.min(max, Math.trunc(finite(value, fallback))));
const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));
const list = (value) => Array.isArray(value) ? value : [];
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
const deepFreeze = (value, seen = new Set()) => {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested, seen);
  return value;
};

const COVERAGE_ACTIONS = Object.freeze([
  'enter', 'exit', 'interact', 'talk', 'trade', 'buy', 'sell', 'craft', 'equip',
  'acceptQuest', 'advanceQuest', 'travel', 'rest', 'train', 'save',
]);

const RUNTIME_HANDLER_NAMES = Object.freeze({
  enter: 'enterSettlement',
  exit: 'exitSettlement',
  interact: 'interact',
  talk: 'talk',
  trade: 'trade',
  buy: 'buy',
  sell: 'sell',
  craft: 'craft',
  equip: 'equip',
  acceptQuest: 'acceptQuest',
  advanceQuest: 'advanceQuest',
  travel: 'travel',
  rest: 'rest',
  train: 'train',
  save: 'save',
});

const DEFAULT_ASSET_EVIDENCE = Object.freeze({
  gate: ['door', 'road'],
  market: ['vendor', 'stall'],
  tavern: ['interior', 'npc'],
  blacksmith: ['forge', 'workbench'],
  farm: ['field', 'barn'],
  barracks: ['barracks', 'training'],
  stable: ['stable', 'mount'],
  house: ['house', 'bed'],
});

function normalizeRuntimeResult(action, result) {
  const source = result && typeof result === 'object' ? result : {};
  return {
    ok: source.ok === true,
    action,
    nodeId: text(source.nodeId, text(source.serviceId, 'settlement')),
    reason: text(source.reason, source.ok === true ? '' : 'action-rejected'),
    message: text(source.message),
    data: clone(source.data),
    quote: clone(source.quote),
    snapshot: clone(source.snapshot),
  };
}

function runtimeSnapshot(runtime, fallback = {}) {
  if (runtime && typeof runtime.snapshot === 'function') {
    try { return clone(runtime.snapshot()) ?? clone(fallback) ?? {}; } catch { return clone(fallback) ?? {}; }
  }
  if (runtime && typeof runtime.getSnapshot === 'function') {
    try { return clone(runtime.getSnapshot()) ?? clone(fallback) ?? {}; } catch { return clone(fallback) ?? {}; }
  }
  return clone(fallback) ?? {};
}

function runtimeHandlers(runtime, options = {}) {
  const external = options.handlers && typeof options.handlers === 'object' ? options.handlers : {};
  const handlers = {};
  for (const action of COVERAGE_ACTIONS) {
    const name = RUNTIME_HANDLER_NAMES[action];
    const candidate = external[action] ?? runtime?.[name];
    if (typeof candidate === 'function') handlers[action] = candidate.bind(runtime);
  }
  return handlers;
}

function assetEvidenceFromRuntime(runtime, options = {}) {
  if (typeof options.assetEvidence === 'function') {
    try { return clone(options.assetEvidence()) ?? []; } catch { return []; }
  }
  if (runtime && typeof runtime.getAssetEvidence === 'function') {
    try { return clone(runtime.getAssetEvidence()) ?? []; } catch { return []; }
  }
  if (runtime?.assetEvidence) return clone(runtime.assetEvidence);
  return [];
}

function placementsFromRuntime(runtime, options = {}) {
  if (typeof options.placementEvidence === 'function') {
    try { return clone(options.placementEvidence()) ?? []; } catch { return []; }
  }
  if (runtime && typeof runtime.getPlacementEvidence === 'function') {
    try { return clone(runtime.getPlacementEvidence()) ?? []; } catch { return []; }
  }
  if (runtime?.placementEvidence) return clone(runtime.placementEvidence);
  return [];
}

function manifestsFromRuntime(runtime, options = {}) {
  if (typeof options.manifestEvidence === 'function') {
    try { return clone(options.manifestEvidence()) ?? []; } catch { return []; }
  }
  if (runtime && typeof runtime.getMaterialManifests === 'function') {
    try { return clone(runtime.getMaterialManifests()) ?? []; } catch { return []; }
  }
  if (runtime?.materialManifests) return clone(runtime.materialManifests);
  return [];
}

function materialsFromRuntime(runtime, options = {}) {
  if (typeof options.materialEvidence === 'function') {
    try { return clone(options.materialEvidence()) ?? []; } catch { return []; }
  }
  if (runtime && typeof runtime.getMaterialEvidence === 'function') {
    try { return clone(runtime.getMaterialEvidence()) ?? []; } catch { return []; }
  }
  if (runtime?.materialEvidence) return clone(runtime.materialEvidence);
  return [];
}

function cameraEvidenceFromRuntime(runtime, options = {}) {
  if (typeof options.cameraEvidence === 'function') {
    try { return clone(options.cameraEvidence()) ?? []; } catch { return []; }
  }
  if (runtime && typeof runtime.getCameraEvidence === 'function') {
    try { return clone(runtime.getCameraEvidence()) ?? []; } catch { return []; }
  }
  return clone(runtime?.cameraEvidence) ?? [];
}

function interactionEvidenceFromRuntime(runtime, options = {}) {
  if (typeof options.interactionEvidence === 'function') {
    try { return clone(options.interactionEvidence()) ?? []; } catch { return []; }
  }
  if (runtime && typeof runtime.getInteractionEvidence === 'function') {
    try { return clone(runtime.getInteractionEvidence()) ?? []; } catch { return []; }
  }
  return clone(runtime?.interactionEvidence) ?? [];
}

function makeAssetEvidence(runtime, options) {
  const direct = assetEvidenceFromRuntime(runtime, options);
  if (direct.length) return direct;
  const configured = [];
  for (const [serviceId, tokens] of Object.entries(DEFAULT_ASSET_EVIDENCE)) {
    for (const token of tokens) configured.push({
      id: `${serviceId}-${token}`,
      family: serviceId === 'tavern' || serviceId === 'house' || serviceId === 'barracks' ? 'houses' : 'settlements',
      assetId: `${serviceId}-${token}`,
      status: 'unknown',
      path: text(options.assetRoot),
      format: 'glb',
      materialSlots: 0,
      textured: false,
      grounded: false,
      lfsPointer: false,
    });
  }
  return configured;
}

function makePlacementEvidence(runtime, options) {
  const direct = placementsFromRuntime(runtime, options);
  return list(direct).slice(0, 96);
}
function makeManifestEvidence(runtime, options) {
  const direct = manifestsFromRuntime(runtime, options);
  return list(direct).slice(0, 96);
}
function makeMaterialEvidence(runtime, options) {
  const direct = materialsFromRuntime(runtime, options);
  return list(direct).slice(0, 128);
}
function makeCameraEvidence(runtime, options) {
  return list(cameraEvidenceFromRuntime(runtime, options)).slice(0, 8);
}
function makeInteractionEvidence(runtime, options) {
  return list(interactionEvidenceFromRuntime(runtime, options)).slice(-64);
}

function proofInput(runtime, options) {
  return {
    settlementId: text(options.settlementId, text(runtime?.settlementId, 'settlement')),
    assets: makeAssetEvidence(runtime, options),
    materials: makeMaterialEvidence(runtime, options),
    placements: makePlacementEvidence(runtime, options),
    manifests: makeManifestEvidence(runtime, options),
    cameras: makeCameraEvidence(runtime, options),
    interactions: makeInteractionEvidence(runtime, options),
  };
}

function makeHandlerOptions(runtime, options) {
  const handlers = runtimeHandlers(runtime, options);
  const hooks = options.hooks && typeof options.hooks === 'object' ? options.hooks : {};
  for (const action of COVERAGE_ACTIONS) {
    if (typeof handlers[action] !== 'function' && typeof hooks[action] === 'function') handlers[action] = hooks[action];
  }
  return handlers;
}

function assertRuntimeShape(runtime) {
  if (!runtime || typeof runtime !== 'object') return { ok:false, reason:'runtime-required' };
  const hasExecute = typeof runtime.execute === 'function';
  const hasHandler = Object.values(RUNTIME_HANDLER_NAMES).some((name) => typeof runtime[name] === 'function');
  return hasExecute || hasHandler ? { ok:true, reason:'' } : { ok:false, reason:'settlement-runtime-contract-missing' };
}

export function createSettlementWorldCoverageRuntimeAdapter(runtime, options = {}) {
  const shape = assertRuntimeShape(runtime);
  const initialState = runtimeSnapshot(runtime, options.initialState ?? {});
  const handlers = makeHandlerOptions(runtime, options);
  const session = createSettlementWorldCoverageSession({
    initialState,
    handlers,
    assets: makeAssetEvidence(runtime, options),
    now: options.now,
    historyLimit: options.historyLimit,
  });

  let sequence = 0;
  let disposed = false;

  const emit = (name, payload = {}) => {
    const event = deepFreeze({
      name,
      sequence: ++sequence,
      at: finite(options.now?.(), 0),
      ...clone(payload),
    });
    if (typeof options.onEvent === 'function') options.onEvent(event);
    return event;
  };

  const enter = async (serviceId = 'gate', panel = 'overview') => {
    if (disposed) return { ok:false, reason:'disposed' };
    const result = session.open(serviceId, panel);
    emit('settlement-world-coverage-open', { serviceId, panel, ok:result.ok });
    return result;
  };

  const interact = async (intent, payload = {}) => {
    if (disposed) return { ok:false, reason:'disposed', intent };
    const result = await session.execute(intent, payload);
    emit(result.ok ? 'settlement-world-coverage-action' : 'settlement-world-coverage-blocked', { intent, serviceId:result.serviceId, reason:result.reason });
    return result;
  };

  const travel = async (routeId, payload = {}) => interact('travel', { ...payload, routeId });
  const buy = async (itemId, quantity = 1, payload = {}) => interact('buy', { ...payload, itemId, quantity });
  const sell = async (itemId, quantity = 1, payload = {}) => interact('sell', { ...payload, itemId, quantity });
  const craft = async (recipeId, payload = {}) => interact('craft', { ...payload, recipeId });
  const save = async (metadata = {}) => {
    const result = session.checkpoint(metadata);
    emit(result.ok ? 'settlement-world-coverage-save' : 'settlement-world-coverage-save-blocked', { ok:result.ok });
    return result;
  };

  const verify = () => {
    const proofSource = proofInput(runtime, options);
    const acceptance = createSettlementWorldCoverageAcceptance(proofSource);
    const proof = createSettlementWorldCoverageProof(proofSource);
    const plan = createSettlementWorldCoveragePlan({ snapshot: runtimeSnapshot(runtime, initialState), assets: proofSource.assets });
    const planValidation = validateSettlementWorldCoveragePlan({ snapshot: runtimeSnapshot(runtime, initialState), assets: proofSource.assets });
    return deepFreeze({
      version: SETTLEMENT_WORLD_COVERAGE_RUNTIME_ADAPTER_VERSION,
      runtime: shape,
      acceptance,
      proof,
      plan,
      planValidation,
      fingerprint: digest({ acceptance:acceptance.fingerprint, proof:proof.fingerprint, plan:plan.fingerprint, runtime:shape }),
    });
  };

  const state = () => deepFreeze({
    adapterVersion: SETTLEMENT_WORLD_COVERAGE_RUNTIME_ADAPTER_VERSION,
    disposed,
    sequence,
    runtime: shape,
    session: session.snapshotState(),
    view: session.view(),
  });

  const dispose = () => {
    if (disposed) return false;
    disposed = true;
    const result = session.dispose();
    emit('settlement-world-coverage-dispose', { sessionDisposed:result });
    return result;
  };

  return Object.freeze({
    version: SETTLEMENT_WORLD_COVERAGE_RUNTIME_ADAPTER_VERSION,
    valid: shape.ok,
    shape,
    session,
    enter,
    interact,
    travel,
    buy,
    sell,
    craft,
    save,
    verify,
    state,
    dispose,
  });
}

export function buildSettlementWorldCoverageRuntimeProof(runtime, options = {}) {
  const input = proofInput(runtime, options);
  const acceptance = createSettlementWorldCoverageAcceptance(input);
  const proof = createSettlementWorldCoverageProof(input);
  return deepFreeze({
    version: SETTLEMENT_WORLD_COVERAGE_RUNTIME_ADAPTER_VERSION,
    settlementId: input.settlementId,
    acceptance,
    proof,
    fingerprint: digest({ acceptance: acceptance.fingerprint, proof: proof.fingerprint }),
  });
}

export function validateSettlementWorldCoverageRuntime(runtime, options = {}) {
  const adapter = createSettlementWorldCoverageRuntimeAdapter(runtime, options);
  const verification = adapter.verify();
  const errors = [];
  if (!verification.runtime.ok) errors.push(verification.runtime.reason);
  if (!verification.planValidation.ok) errors.push(...verification.planValidation.errors);
  return deepFreeze({ ok: errors.length === 0, errors, fingerprint: verification.fingerprint });
}
