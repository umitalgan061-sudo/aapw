/* placeholder detailed module */
export const SETTLEMENT_WORLD_COVERAGE_VERSION = 1;
export const SETTLEMENT_WORLD_COVERAGE_LIMITS = Object.freeze({ history: 48, intents: 48, services: 8, assets: 64 });
export const SETTLEMENT_WORLD_COVERAGE_API = Object.freeze({
  version: SETTLEMENT_WORLD_COVERAGE_VERSION,
  services: Object.freeze(['gate','market','tavern','blacksmith','farm','barracks','stable','house']),
  intents: Object.freeze(['enter','exit','interact','talk','trade','buy','sell','craft','equip','acceptQuest','advanceQuest','travel','rest','train','save']),
});

const text = (value, fallback = '') => {
  const normalized = String(value ?? '').trim();
  return normalized ? normalized.slice(0, 180) : fallback;
};
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const integer = (value, min, max, fallback = min) => Math.max(min, Math.min(max, Math.trunc(finite(value, fallback))));
const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));
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
const ids = SETTLEMENT_WORLD_COVERAGE_API.services;
const intents = SETTLEMENT_WORLD_COVERAGE_API.intents;

const serviceMeta = Object.freeze({
  gate: { role: 'door', domain: 'travel', panels: ['overview','travel'], intents: ['enter','exit','travel'], evidence: ['door','road'] },
  market: { role: 'vendor', domain: 'trade', panels: ['overview','trade'], intents: ['talk','trade','buy','sell'], evidence: ['vendor','stall'] },
  tavern: { role: 'interior', domain: 'rest-dialogue', panels: ['overview','dialogue','quests','rest'], intents: ['talk','rest','acceptQuest','advanceQuest'], evidence: ['interior','npc'] },
  blacksmith: { role: 'crafting', domain: 'smithing', panels: ['overview','craft','equipment'], intents: ['talk','trade','craft','equip'], evidence: ['forge','workbench'] },
  farm: { role: 'interior', domain: 'survival', panels: ['overview','rest','travel'], intents: ['interact','trade','rest','travel'], evidence: ['field','barn'] },
  barracks: { role: 'interior', domain: 'training', panels: ['overview','quests','equipment'], intents: ['talk','train','acceptQuest','equip'], evidence: ['barracks','training'] },
  stable: { role: 'interior', domain: 'mount-travel', panels: ['overview','travel','rest'], intents: ['talk','trade','travel','rest'], evidence: ['stable','mount'] },
  house: { role: 'interior', domain: 'persistence', panels: ['overview','equipment','rest','save'], intents: ['interact','talk','save','rest'], evidence: ['house','bed'] },
});

function normalizeSnapshot(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const copyMap = (value, limit, normalizer) => Object.fromEntries(Object.entries(value ?? {}).slice(0, limit).map(([key, item]) => [text(key), normalizer(item)]));
  const quests = {};
  for (const [questId, quest] of Object.entries(source.quests ?? {}).slice(0, 64)) {
    const record = quest && typeof quest === 'object' ? quest : {};
    quests[text(questId)] = {
      state: text(record.state, 'unknown'),
      step: integer(record.step, 0, 999, 0),
      completed: Boolean(record.completed),
      rewardClaimed: Boolean(record.rewardClaimed),
      objectiveId: text(record.objectiveId),
    };
  }
  return {
    version: integer(source.version, 1, 999, 1),
    settlementId: text(source.settlementId, 'settlement'),
    locationId: text(source.locationId),
    inSettlement: source.inSettlement !== false,
    settlementOpen: source.settlementOpen !== false,
    defeated: Boolean(source.defeated) || finite(source.health, 100) <= 0,
    saveEnabled: source.saveEnabled !== false,
    health: Math.max(0, Math.min(100, finite(source.health, 100))),
    maxHealth: Math.max(1, Math.min(999, finite(source.maxHealth, 100))),
    copper: integer(source.copper, 0, 999999, 0),
    fatigue: Math.max(0, Math.min(100, finite(source.fatigue, 0))),
    reputation: Math.max(-9999, Math.min(9999, finite(source.reputation, 0))),
    inventory: copyMap(source.inventory, 96, (item) => integer(item, 0, 9999, 0)),
    equipment: copyMap(source.equipment, 24, (item) => text(item)),
    skills: copyMap(source.skills, 24, (item) => integer(item, 0, 999, 0)),
    flags: copyMap(source.flags, 64, Boolean),
    quests,
    perks: [...new Set((Array.isArray(source.perks) ? source.perks : []).slice(0, 48).map((item) => text(item)).filter(Boolean))],
    survival: {
      hunger: Math.max(0, Math.min(100, finite(source.survival?.hunger, 0))),
      exposure: Math.max(0, Math.min(100, finite(source.survival?.exposure, 0))),
      morale: Math.max(-100, Math.min(100, finite(source.survival?.morale, 0))),
    },
  };
}

function normalizeAssetInventory(raw = []) {
  const rows = Array.isArray(raw) ? raw : Object.entries(raw ?? {}).flatMap(([family, items]) => (Array.isArray(items) ? items : []).map((item) => ({ ...item, family })));
  const seen = new Set();
  return rows.slice(0, 64).map((rawAsset) => {
    const asset = rawAsset && typeof rawAsset === 'object' ? rawAsset : {};
    return {
      family: text(asset.family),
      assetId: text(asset.assetId ?? asset.id),
      status: ['ready','hydrated','loaded','pointer','missing'].includes(text(asset.status)) ? text(asset.status) : 'unknown',
      path: text(asset.path),
      format: text(asset.format),
      materialSlots: integer(asset.materialSlots, 0, 32, 0),
      textured: Boolean(asset.textured),
      grounded: Boolean(asset.grounded),
      key: `${text(asset.family)}:${text(asset.assetId ?? asset.id)}`,
    };
  }).filter((asset) => asset.assetId && !seen.has(asset.key) && seen.add(asset.key));
}

function service(id) {
  if (!ids.includes(id)) return null;
  const meta = serviceMeta[id];
  return { id, ...clone(meta) };
}
function condition(id, snapshot) {
  const target = snapshot.flags[id];
  return target === true ? { ok: true, reason: '' } : { ok: false, reason: 'condition-required' };
}
function objective(id, snapshot) {
  const quest = snapshot.quests[id] ?? {};
  const step = integer(quest.step, 0, 999, 0);
  const target = integer(1, 0, 999, 1);
  return { id, questId: id, progress: step, target, complete: Boolean(quest.completed) || step >= target };
}
function assetCoverage(serviceId, assets) {
  const meta = serviceMeta[serviceId];
  const relevant = assets.filter((asset) => ['settlements','houses','props'].includes(asset.family));
  const evidence = (meta?.evidence ?? []).map((token) => {
    const found = relevant.find((asset) => asset.assetId.toLowerCase().includes(token));
    return { id: token, ok: Boolean(found), assetId: found?.assetId ?? '', family: found?.family ?? '', status: found?.status ?? 'missing' };
  });
  return {
    total: relevant.length,
    ready: relevant.filter((asset) => ['ready','hydrated','loaded'].includes(asset.status)).length,
    pointer: relevant.filter((asset) => asset.status === 'pointer').length,
    missing: relevant.filter((asset) => asset.status === 'missing').length,
    grounded: relevant.filter((asset) => asset.grounded).length,
    textured: relevant.filter((asset) => asset.textured).length,
    status: evidence.length && evidence.every((item) => item.ok) ? 'covered' : relevant.length ? 'partial' : 'unobserved',
    evidence,
  };
}
function gate(snapshot, intent, serviceId) {
  if (!intents.includes(intent)) return 'unknown-action';
  if (!snapshot.inSettlement && !['enter','exit'].includes(intent)) return 'outside-settlement';
  if (snapshot.defeated && !['save','exit'].includes(intent)) return 'player-defeated';
  if (intent === 'enter' && !snapshot.settlementOpen) return 'settlement-closed';
  if (intent === 'save' && !snapshot.saveEnabled) return 'save-disabled';
  if (!serviceMeta[serviceId]?.intents.includes(intent)) return 'service-intent-unsupported';
  return '';
}
function planAction(snapshot, intent, payload = {}) {
  const serviceId = ({ enter:'gate', exit:'gate', travel:'gate', talk:'tavern', trade:'market', buy:'market', sell:'market', craft:'blacksmith', equip:'blacksmith', acceptQuest:'tavern', advanceQuest:'tavern', rest:'tavern', train:'barracks', interact:'house', save:'house' })[intent] ?? '';
  const reason = gate(snapshot, intent, serviceId);
  if (reason) return { ready: false, reason, serviceId, panel: 'overview', quote: null };
  if (['buy','sell','trade'].includes(intent)) {
    const itemId = text(payload.itemId);
    const quantity = integer(payload.quantity, 1, 99, 1);
    const base = itemId ? Math.max(1, quantity * 1) : 0;
    if (!itemId) return { ready: false, reason: 'item-required', serviceId, panel: 'trade', quote: null };
    if (intent !== 'sell' && snapshot.copper < base) return { ready: false, reason: 'insufficient-copper', serviceId, panel: 'trade', quote: { total: base } };
    return { ready: true, reason: '', serviceId, panel: 'trade', quote: { itemId, quantity, total: base, direction: intent === 'sell' ? 'sell' : 'buy' } };
  }
  if (intent === 'craft') {
    if (!text(payload.recipeId)) return { ready: false, reason: 'recipe-required', serviceId, panel: 'craft', quote: null };
    return { ready: true, reason: '', serviceId, panel: 'craft', quote: { recipeId: text(payload.recipeId) } };
  }
  if (intent === 'travel') {
    const routeId = text(payload.routeId);
    if (!routeId) return { ready: false, reason: 'route-required', serviceId, panel: 'travel', quote: null };
    return { ready: true, reason: '', serviceId, panel: 'travel', quote: { routeId, cost: integer(payload.cost, 0, 9999, 0), fatigue: integer(payload.fatigue, 0, 100, 0) } };
  }
  if (intent === 'train' && snapshot.fatigue > 85) return { ready: false, reason: 'too-fatigued', serviceId, panel: 'quests', quote: null };
  if (intent === 'rest' && snapshot.fatigue <= 0 && snapshot.survival.exposure <= 0 && snapshot.survival.morale >= 0) return { ready: false, reason: 'nothing-to-recover', serviceId, panel: 'rest', quote: null };
  return { ready: true, reason: '', serviceId, panel: serviceMeta[serviceId]?.panels[1] ?? 'overview', quote: null };
}
function rowsForServices(snapshot, assets) {
  return ids.map((serviceId, index) => {
    const meta = serviceMeta[serviceId];
    const asset = assetCoverage(serviceId, assets);
    const blocked = !snapshot.inSettlement && serviceId !== 'gate' ? 'outside-settlement' : snapshot.defeated && serviceId !== 'gate' ? 'player-defeated' : '';
    const primary = planAction(snapshot, meta.intents[0], {});
    return {
      index, id: serviceId, label: text(meta.label, serviceId), role: meta.role, domain: meta.domain,
      intents: [...meta.intents], panels: [...meta.panels], primaryIntent: meta.intents[0],
      status: blocked ? 'blocked' : asset.status === 'covered' && primary.ready ? 'ready' : asset.status === 'partial' ? 'partial' : 'available-blocked',
      blockedReason: blocked || (primary.ready ? '' : primary.reason), assetCoverage: asset,
    };
  });
}
function serviceLabel(serviceId) { return text(serviceMeta[serviceId]?.label, serviceId); }
function summary(rows) { return rows.reduce((result, row) => { result[row.status === 'available-blocked' ? 'availableBlocked' : row.status] += 1; return result; }, { ready:0, blocked:0, partial:0, availableBlocked:0, unobserved:0 }); }
function manifestSummary() {
  const manifest = createSettlementContentManifest();
  return { contentVersion: SETTLEMENT_CONTENT_VERSION, validation: clone(validateSettlementContent()), digest: digest(manifest) };
}

export function createSettlementWorldCoveragePlan(input = {}) {
  const snapshot = normalizeSnapshot(input.snapshot ?? input.player ?? {});
  const assets = normalizeAssetInventory(input.assets);
  const services = rowsForServices(snapshot, assets);
  const objectives = Object.keys(snapshot.quests).slice(0, 32).map((questId) => objective(questId, snapshot));
  const plan = {
    version: SETTLEMENT_WORLD_COVERAGE_VERSION,
    contentVersion: SETTLEMENT_CONTENT_VERSION,
    settlementId: snapshot.settlementId,
    locationId: snapshot.locationId,
    services,
    serviceSummary: summary(services),
    nextService: services.find((row) => row.status === 'ready') ?? services.find((row) => row.status === 'partial') ?? services[0] ?? null,
    objectives,
    assetCoverage: services.map((row) => ({ serviceId: row.id, ...row.assetCoverage })),
    player: { inSettlement: snapshot.inSettlement, defeated: snapshot.defeated, health: snapshot.health, fatigue: snapshot.fatigue, copper: snapshot.copper },
    content: manifestSummary(),
  };
  return deepFreeze({ ...plan, fingerprint: digest(plan) });
}

export function validateSettlementWorldCoveragePlan(input = {}) {
  const plan = createSettlementWorldCoveragePlan(input);
  const errors = [];
  if (plan.services.length !== SETTLEMENT_WORLD_COVERAGE_LIMITS.services) errors.push('service-count');
  if (new Set(plan.services.map((row) => row.id)).size !== plan.services.length) errors.push('duplicate-service');
  for (const row of plan.services) {
    if (!row.intents.length) errors.push(`missing-intent:${row.id}`);
    if (!row.assetCoverage) errors.push(`missing-asset-coverage:${row.id}`);
  }
  return deepFreeze({ ok: errors.length === 0, errors, fingerprint: digest(plan) });
}

export function createSettlementWorldCoverageSession(options = {}) {
  let snapshot = normalizeSnapshot(options.initialState ?? {});
  const assets = normalizeAssetInventory(options.assets);
  const now = typeof options.now === 'function' ? options.now : () => Date.now();
  const handlers = options.handlers && typeof options.handlers === 'object' ? options.handlers : {};
  let state = { revision:0, sequence:0, activeService:'gate', panel:'overview', history:[], receipts:[], intents:[], checkpoint:null, disposed:false };
  const pushHistory = (entry) => {
    const next = { sequence: state.sequence + 1, at: finite(now(),0), ...clone(entry) };
    state = { ...state, sequence: next.sequence, revision: state.revision + 1, history: [...state.history, next].slice(-SETTLEMENT_WORLD_COVERAGE_LIMITS.history) };
    return next;
  };
  const blocked = (intent, reason, serviceId = '') => ({ ok:false, intent, reason, serviceId, view:view() });
  const readiness = (intent, payload = {}) => deepFreeze({ intent, payload: clone(payload), ...planAction(snapshot, intent, payload) });
  const open = (serviceId, panel = 'overview') => {
    const target = service(text(serviceId));
    if (!target) return blocked('interact','unknown-service');
    const nextPanel = serviceMeta[target.id].panels.includes(panel) || panel === 'overview' ? panel : 'overview';
    state = { ...state, revision: state.revision + 1, activeService: target.id, panel: nextPanel };
    pushHistory({ intent:'interact', serviceId:target.id, panel:nextPanel, ok:true, reason:'' });
    return deepFreeze({ ok:true, serviceId:target.id, panel:nextPanel, view:view() });
  };
  const setPanel = (panel) => {
    const meta = serviceMeta[state.activeService];
    const nextPanel = meta?.panels.includes(panel) ? panel : 'overview';
    state = { ...state, revision: state.revision + 1, panel:nextPanel };
    pushHistory({ intent:'interact', serviceId:state.activeService, panel:nextPanel, ok:true, reason:'' });
    return deepFreeze({ ok:true, panel:nextPanel, view:view() });
  };
  const execute = async (intent, payload = {}) => {
    if (state.disposed) return blocked(intent,'disposed',INTENT_SERVICE[intent] ?? '');
    const plan = readiness(intent,payload);
    if (!plan.ready) { pushHistory({ intent, serviceId:plan.serviceId, panel:plan.panel, ok:false, reason:plan.reason }); return blocked(intent,plan.reason,plan.serviceId); }
    let result;
    try { result = typeof handlers[intent] === 'function' ? await handlers[intent]({ intent, payload:clone(payload), snapshot:clone(snapshot), plan:clone(plan) }) : { ok:true, ...plan };
    } catch { pushHistory({ intent, serviceId:plan.serviceId, panel:plan.panel, ok:false, reason:'handler-threw' }); return blocked(intent,'handler-threw',plan.serviceId); }
    if (result?.ok === false) { pushHistory({ intent, serviceId:plan.serviceId, panel:plan.panel, ok:false, reason:text(result.reason,'action-rejected') }); return blocked(intent,text(result.reason,'action-rejected'),plan.serviceId); }
    if (intent === 'rest') snapshot = normalizeSnapshot({ ...snapshot, fatigue:Math.max(0,snapshot.fatigue - 20), survival:{ ...snapshot.survival, exposure:Math.max(0,snapshot.survival.exposure - 12) } });
    if (intent === 'train') snapshot = normalizeSnapshot({ ...snapshot, fatigue:Math.min(100,snapshot.fatigue + 8) });
    if (intent === 'talk') snapshot = normalizeSnapshot({ ...snapshot, reputation:Math.min(9999,snapshot.reputation + 1) });
    if (intent === 'travel') snapshot = normalizeSnapshot({ ...snapshot, copper:Math.max(0,snapshot.copper - finite(plan.quote?.cost,0)), fatigue:Math.min(100,snapshot.fatigue + finite(plan.quote?.fatigue,0)), locationId:text(plan.quote?.routeId,snapshot.locationId), inSettlement:false });
    pushHistory({ intent, serviceId:plan.serviceId, panel:plan.panel, ok:true, reason:'' });
    const receipt = { id:`receipt-${state.sequence}`, intent, serviceId:plan.serviceId, ok:true, reason:'', copperDelta: intent === 'travel' ? -finite(plan.quote?.cost,0) : 0, xpDelta: ['craft','train','advanceQuest'].includes(intent) ? 8 : 0, fatigueDelta: intent === 'rest' ? -20 : intent === 'train' ? 8 : intent === 'travel' ? finite(plan.quote?.fatigue,0) : 0, reputationDelta: intent === 'talk' ? 1 : 0 };
    state = { ...state, revision: state.revision + 1, receipts:[...state.receipts,receipt].slice(-32) };
    return deepFreeze({ ok:true, intent, serviceId:plan.serviceId, receipt, view:view() });
  };
  const queue = (intentsInput = []) => {
    const plans = (Array.isArray(intentsInput) ? intentsInput : []).slice(0, SETTLEMENT_WORLD_COVERAGE_LIMITS.intents).map((item) => readiness(item?.intent, item?.payload ?? {}));
    state = { ...state, revision:state.revision + 1, intents:plans };
    return deepFreeze({ ok:true, plans, digest:digest(plans) });
  };
  const runQueue = async (stopOnFailure = true) => {
    const results=[];
    for (const plan of state.intents) { const result = await execute(plan.intent, plan.payload ?? {}); results.push(result); if (stopOnFailure && !result.ok) break; }
    return deepFreeze({ ok:results.every((result)=>result.ok), completed:results.filter((result)=>result.ok).length, blocked:results.filter((result)=>!result.ok).length, results, view:view() });
  };
  const checkpoint = (metadata = {}) => {
    const value = deepFreeze({ version:1, settlementId:snapshot.settlementId, nodeId:state.activeService, activeService:state.activeService, panel:state.panel, stepIndex:state.sequence, sequence:state.sequence, savedAt:finite(now(),0), metadata:clone(metadata) });
    state = { ...state, revision:state.revision + 1, checkpoint:value };
    return deepFreeze({ ok:true, checkpoint:value, view:view() });
  };
  const resume = (value) => {
    const restored = value && typeof value === 'object' ? value : {};
    if (text(restored.settlementId,'settlement') !== snapshot.settlementId) return blocked('save','settlement-mismatch','house');
    if (!service(text(restored.activeService,'gate'))) return blocked('save','service-unavailable','house');
    state = { ...state, revision:state.revision + 1, sequence:Math.max(state.sequence,integer(restored.sequence,0,999999,0)), activeService:text(restored.activeService,'gate'), panel:text(restored.panel,'overview'), checkpoint:deepFreeze(clone(restored)) };
    return deepFreeze({ ok:true, checkpoint:state.checkpoint, view:view() });
  };
  const snapshotState = () => deepFreeze({ version:1, revision:state.revision, sequence:state.sequence, activeService:state.activeService, panel:state.panel, history:clone(state.history), receipts:clone(state.receipts), intents:clone(state.intents), checkpoint:clone(state.checkpoint), player:clone(snapshot), digest:digest({ state, snapshot }) });
  const view = () => buildWorldCoverageView(state,snapshot,assets);
  const dispose = () => { if (state.disposed) return false; state={...state,disposed:true,revision:state.revision+1,intents:[]}; return true; };
  return Object.freeze({ readiness, open, setPanel, execute, queue, runQueue, checkpoint, resume, snapshotState, view, dispose });
}

function buildWorldCoverageView(state,snapshot,assets) {
  const services = rowsForServices(snapshot,assets);
  const quests = Object.keys(snapshot.quests).slice(0,32).map((questId)=>objective(questId,snapshot));
  return deepFreeze({
    version:1, settlementId:snapshot.settlementId, locationId:snapshot.locationId, activeService:state.activeService, panel:state.panel, sequence:state.sequence,
    services, serviceSummary:summary(services), assetCoverage:services.map((row)=>({serviceId:row.id,...row.assetCoverage})), objectives:quests,
    history:clone(state.history), receipts:clone(state.receipts), checkpoint:clone(state.checkpoint), metrics:{ visitedServices:new Set(state.history.map((row)=>row.serviceId).filter(Boolean)).size, interactionCount:state.history.length, completedObjectives:quests.filter((row)=>row.complete).length },
    player:{inSettlement:snapshot.inSettlement,defeated:snapshot.defeated,health:snapshot.health,fatigue:snapshot.fatigue,copper:snapshot.copper,reputation:snapshot.reputation}, content:manifestSummary(), fingerprint:digest({state,snapshot,services,quests}),
  });
}
