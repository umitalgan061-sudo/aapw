/**
 * Living World Companion Command Runtime
 *
 * A deterministic command gateway layered on top of the existing companion runtime.
 * The base runtime continues to own companion lifecycle decisions; this module only
 * buffers its downstream navigation/combat/world-event calls, arbitrates them, and
 * commits the winners to the existing injected owners.
 *
 * Ownership is intentionally narrow:
 * - livingWorldCompanionRuntimeAdapter remains authoritative for link state, LOD,
 *   formation, recovery, perception/reaction composition, and command intent creation.
 * - this gateway owns only command admission, ordering, dedupe, TTL and receipts.
 * - navigation/combat/world-event side effects remain owned by injected services.
 */

import {
  createLivingWorldCompanionRuntime,
} from './livingWorldCompanionRuntimeAdapter.js';

const freeze = (value) => Object.freeze(value);
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min, max) => Math.max(min, Math.min(max, finite(value, min)));
const asId = (value, fallback = '') => value == null ? fallback : String(value);

const COMMAND_KINDS = freeze([
  'follow',
  'hold',
  'assist-follow',
  'assist-hold',
  'formation-reposition',
  'regroup',
  'recover',
  'companion-runtime',
  'companion-combat-intent',
]);

const OWNER_TYPES = freeze(['navigation', 'combat', 'event']);
const RECEIPT_STATES = freeze(['accepted', 'rejected', 'failed', 'expired', 'deduped']);

export const LIVING_WORLD_COMPANION_COMMAND_RUNTIME_POLICY = freeze({
  id: 'living-world-companion-command-runtime-2026-09-10-v1',
  deterministic: true,
  maxQueuedCommands: 48,
  maxPendingExternalCommands: 24,
  maxNavigationCommands: 8,
  maxCombatCommands: 8,
  maxEventCommands: 6,
  maxReceiptHistory: 32,
  maxCompanionHistory: 12,
  commandTtlSeconds: 0.75,
  navigationTtlSeconds: 0.9,
  combatTtlSeconds: 0.5,
  eventTtlSeconds: 1.5,
  emergencyPriority: 80,
  minimumPriority: -100,
  maximumPriority: 100,
});

function stableHash(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 2246822507) >>> 0;
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 3266489909) >>> 0;
  return (hash ^ (hash >>> 16)) >>> 0;
}

function stableStringify(value) {
  if (value === null || value === undefined) return 'null';
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

function digest(value) {
  return stableHash(stableStringify(value)).toString(16).padStart(8, '0');
}

function normalizeOwner(owner) {
  if (owner === 'navigation') return 'navigation';
  if (owner === 'combat') return 'combat';
  if (owner === 'event') return 'event';
  return '';
}

function normalizeKind(kind, owner) {
  const candidate = asId(kind, owner === 'event' ? 'companion-runtime' : owner === 'combat' ? 'assist-follow' : 'follow');
  return COMMAND_KINDS.includes(candidate) ? candidate : owner === 'event' ? 'companion-runtime' : owner === 'combat' ? 'assist-follow' : 'follow';
}

function normalizePriority(value, fallback = 0) {
  return clamp(Math.round(finite(value, fallback)), LIVING_WORLD_COMPANION_COMMAND_RUNTIME_POLICY.minimumPriority, LIVING_WORLD_COMPANION_COMMAND_RUNTIME_POLICY.maximumPriority);
}

function ttlFor(owner, command) {
  if (Number.isFinite(Number(command?.ttlSeconds))) return Math.max(0.05, Number(command.ttlSeconds));
  if (owner === 'navigation') return LIVING_WORLD_COMPANION_COMMAND_RUNTIME_POLICY.navigationTtlSeconds;
  if (owner === 'combat') return LIVING_WORLD_COMPANION_COMMAND_RUNTIME_POLICY.combatTtlSeconds;
  if (owner === 'event') return LIVING_WORLD_COMPANION_COMMAND_RUNTIME_POLICY.eventTtlSeconds;
  return LIVING_WORLD_COMPANION_COMMAND_RUNTIME_POLICY.commandTtlSeconds;
}

function isEmergency(command) {
  return command.priority >= LIVING_WORLD_COMPANION_COMMAND_RUNTIME_POLICY.emergencyPriority ||
    command.kind === 'recover' || command.kind === 'regroup';
}

function commandCompanionId(command) {
  const explicit = asId(command?.companionId);
  if (explicit) return explicit;
  const id = asId(command?.id);
  const pivot = id.indexOf(':');
  return pivot > 0 ? id.slice(0, pivot) : id;
}

function normalizeCommand(command, nowSeconds, source = 'runtime') {
  const owner = normalizeOwner(command?.owner);
  const normalizedOwner = owner || (asId(command?.type).includes('combat') ? 'combat' : asId(command?.type).includes('runtime') ? 'event' : 'navigation');
  const createdAtSeconds = Number.isFinite(Number(command?.createdAtSeconds)) ? Number(command.createdAtSeconds) : nowSeconds;
  const companionId = commandCompanionId(command);
  const normalized = {
    id: asId(command?.id, `${source}:${normalizedOwner}:${companionId || 'anonymous'}:${digest(command).slice(0, 6)}`),
    owner: normalizedOwner,
    kind: normalizeKind(command?.kind ?? command?.type, normalizedOwner),
    companionId,
    actorId: asId(command?.actorId),
    targetId: asId(command?.targetId),
    priority: normalizePriority(command?.priority, isEmergency(command ?? {}) ? 100 : 0),
    createdAtSeconds,
    ttlSeconds: ttlFor(normalizedOwner, command),
    source: asId(source, 'runtime'),
    payload: command?.payload ?? command,
  };
  normalized.emergency = isEmergency(normalized);
  normalized.signature = digest({
    owner: normalized.owner,
    kind: normalized.kind,
    companionId: normalized.companionId,
    actorId: normalized.actorId,
    targetId: normalized.targetId,
    payload: normalized.payload,
  });
  return freeze(normalized);
}

function commandOrder(a, b) {
  return Number(b.emergency) - Number(a.emergency) ||
    b.priority - a.priority ||
    a.createdAtSeconds - b.createdAtSeconds ||
    a.owner.localeCompare(b.owner) ||
    a.actorId.localeCompare(b.actorId) ||
    a.targetId.localeCompare(b.targetId) ||
    a.id.localeCompare(b.id);
}

function ownerBudget(owner) {
  if (owner === 'navigation') return LIVING_WORLD_COMPANION_COMMAND_RUNTIME_POLICY.maxNavigationCommands;
  if (owner === 'combat') return LIVING_WORLD_COMPANION_COMMAND_RUNTIME_POLICY.maxCombatCommands;
  if (owner === 'event') return LIVING_WORLD_COMPANION_COMMAND_RUNTIME_POLICY.maxEventCommands;
  return 0;
}

function createCompanionRecord(id) {
  return {
    id,
    sequence: 0,
    accepted: 0,
    rejected: 0,
    failed: 0,
    expired: 0,
    deduped: 0,
    lastCommandDigest: '',
    history: [],
  };
}

function pushHistory(record, item) {
  record.history = [...record.history, freeze(item)].slice(-LIVING_WORLD_COMPANION_COMMAND_RUNTIME_POLICY.maxCompanionHistory);
}

function makeReceipt(command, state, sequence, reason, ownerResult = null) {
  return freeze({
    sequence,
    commandId: command.id,
    companionId: command.companionId,
    actorId: command.actorId,
    targetId: command.targetId,
    owner: command.owner,
    kind: command.kind,
    priority: command.priority,
    emergency: command.emergency,
    state,
    reason: asId(reason, state),
    accepted: state === 'accepted',
    failed: state === 'failed',
    ownerResult,
    digest: digest({
      sequence,
      commandId: command.id,
      state,
      reason,
    }),
  });
}

function createGatewayOwner(ownerType, bucket) {
  const methodNames = ownerType === 'navigation'
    ? ['requestTravel', 'requestMove', 'navigate', 'travel']
    : ownerType === 'combat'
      ? ['requestSupport', 'requestAttack', 'assist', 'attack']
      : ['publish', 'emit', 'dispatch'];

  return Object.freeze({
    ...Object.fromEntries(methodNames.map((method) => [method, (...args) => {
      const request = ownerType === 'event' ? args[0] : args[1];
      bucket.push({
        owner: ownerType,
        request,
        follower: ownerType === 'event' ? null : args[0],
        target: ownerType === 'combat' ? args[1] : null,
        preferredMethod: method,
      });
      return { accepted: true, buffered: true, owner: ownerType };
    }])),
  });
}

function callOwner(owner, methodNames, args) {
  if (!owner || typeof owner !== 'object') return { invoked: false, reason: 'owner-unavailable' };
  for (const method of methodNames) {
    if (typeof owner[method] !== 'function') continue;
    try {
      return { invoked: true, method, result: owner[method](...args) };
    } catch (error) {
      return { invoked: true, method, error: asId(error?.message, 'owner-call-failed') };
    }
  }
  return { invoked: false, reason: 'owner-method-unavailable' };
}

function resolveOwnerRequest(command, entry) {
  if (command.owner === 'event') return [entry.request];
  if (command.owner === 'combat') return [entry.follower, entry.target, entry.request];
  return [entry.follower, entry.request];
}

function methodsForOwner(owner) {
  if (owner === 'navigation') return ['requestTravel', 'requestMove', 'navigate', 'travel'];
  if (owner === 'combat') return ['requestSupport', 'requestAttack', 'assist', 'attack'];
  return ['publish', 'emit', 'dispatch'];
}

export function createLivingWorldCompanionCommandRuntime({
  seed = 0,
  clockSeconds = 0,
  services = {},
  integrationOptions = {},
} = {}) {
  const downstreamServices = services ?? {};
  const buffers = {
    navigation: [],
    combat: [],
    event: [],
  };
  const realOwners = {
    navigation: downstreamServices.navigation ?? downstreamServices.navigationService,
    combat: downstreamServices.combat ?? downstreamServices.encounters ?? downstreamServices.encounter,
    event: downstreamServices.worldEventsPublisher ?? downstreamServices.worldEvents,
  };
  const gatewayServices = {
    ...downstreamServices,
    navigation: createGatewayOwner('navigation', buffers.navigation),
    navigationService: undefined,
    combat: createGatewayOwner('combat', buffers.combat),
    encounters: undefined,
    encounter: undefined,
    worldEventsPublisher: createGatewayOwner('event', buffers.event),
    worldEvents: undefined,
  };

  const baseRuntime = createLivingWorldCompanionRuntime({
    seed,
    clockSeconds,
    services: gatewayServices,
    integrationOptions,
  });

  const companionRecords = new Map();
  const receiptHistory = [];
  const pendingExternal = [];
  let nowSeconds = Math.max(0, finite(clockSeconds));
  let commandSequence = 0;
  let tickCount = 0;
  let disposed = false;
  let stats = createStats();

  function createStats() {
    return {
      queued: 0,
      accepted: 0,
      rejected: 0,
      failed: 0,
      expired: 0,
      deduped: 0,
      navigationCommitted: 0,
      combatCommitted: 0,
      eventsCommitted: 0,
    };
  }

  function ensureRecord(companionId) {
    const id = asId(companionId, 'anonymous');
    if (!companionRecords.has(id)) companionRecords.set(id, createCompanionRecord(id));
    return companionRecords.get(id);
  }

  function recordReceipt(receipt) {
    const record = ensureRecord(receipt.companionId);
    if (receipt.state === 'accepted') record.accepted += 1;
    else if (receipt.state === 'failed') record.failed += 1;
    else if (receipt.state === 'expired') record.expired += 1;
    else if (receipt.state === 'deduped') record.deduped += 1;
    else record.rejected += 1;
    record.sequence = receipt.sequence;
    record.lastCommandDigest = receipt.digest;
    pushHistory(record, {
      sequence: receipt.sequence,
      commandId: receipt.commandId,
      state: receipt.state,
      reason: receipt.reason,
      atSeconds: nowSeconds,
      digest: receipt.digest,
    });
    receiptHistory.push(receipt);
    if (receiptHistory.length > LIVING_WORLD_COMPANION_COMMAND_RUNTIME_POLICY.maxReceiptHistory) receiptHistory.splice(0, receiptHistory.length - LIVING_WORLD_COMPANION_COMMAND_RUNTIME_POLICY.maxReceiptHistory);
  }

  function enqueueExternal(command) {
    if (disposed) return freeze({ accepted: false, reason: 'disposed' });
    if (pendingExternal.length >= LIVING_WORLD_COMPANION_COMMAND_RUNTIME_POLICY.maxPendingExternalCommands) {
      return freeze({ accepted: false, reason: 'external-queue-budget' });
    }
    const normalized = normalizeCommand(command, nowSeconds, 'external');
    pendingExternal.push(normalized);
    stats.queued += 1;
    return freeze({ accepted: true, commandId: normalized.id, digest: normalized.signature });
  }

  function companionPriorityMap(baseResult) {
    const map = new Map();
    for (const row of baseResult?.results ?? []) {
      if (!row?.companionId) continue;
      map.set(row.companionId, normalizePriority(row.priority));
    }
    return map;
  }

  function wrapGeneratedEntry(owner, entry, priorityMap) {
    const request = entry.request ?? {};
    const companionId = commandCompanionId(request);
    const priority = priorityMap.get(companionId) ?? normalizePriority(request.priority, 0);
    return normalizeCommand({
      ...request,
      id: request.id,
      owner,
      companionId,
      actorId: asId(request.actorId ?? entry.follower?.id),
      targetId: asId(request.targetId ?? entry.target?.id),
      priority,
      payload: request,
    }, nowSeconds, 'runtime');
  }

  function drainBuffers(baseResult) {
    const priorityMap = companionPriorityMap(baseResult);
    const generated = [];
    for (const owner of OWNER_TYPES) {
      const rows = buffers[owner].splice(0, buffers[owner].length);
      for (const entry of rows) generated.push({
        command: wrapGeneratedEntry(owner, entry, priorityMap),
        entry,
      });
    }
    return generated;
  }

  function arbitrationKey(command) {
    return command.signature;
  }

  function arbitrate(generated, external) {
    const all = [
      ...external.map((command) => ({ command, entry: null })),
      ...generated,
    ];
    all.sort((a, b) => commandOrder(a.command, b.command));
    const seen = new Set();
    const perOwner = { navigation: 0, combat: 0, event: 0 };
    const selected = [];
    const receipts = [];
    for (const item of all) {
      const command = item.command;
      const age = Math.max(0, nowSeconds - command.createdAtSeconds);
      if (age > command.ttlSeconds) {
        commandSequence += 1;
        stats.expired += 1;
        receipts.push(makeReceipt(command, 'expired', commandSequence, 'command-ttl'));
        continue;
      }
      const key = arbitrationKey(command);
      if (seen.has(key)) {
        commandSequence += 1;
        stats.deduped += 1;
        receipts.push(makeReceipt(command, 'deduped', commandSequence, 'duplicate-signature'));
        continue;
      }
      seen.add(key);
      const budget = ownerBudget(command.owner);
      if (perOwner[command.owner] >= budget && !command.emergency) {
        commandSequence += 1;
        stats.rejected += 1;
        receipts.push(makeReceipt(command, 'rejected', commandSequence, 'owner-budget'));
        continue;
      }
      if (perOwner[command.owner] >= budget && command.emergency) {
        const replacementIndex = selected.findIndex((candidate) => candidate.command.owner === command.owner && !candidate.command.emergency);
        if (replacementIndex >= 0) {
          const replaced = selected.splice(replacementIndex, 1)[0];
          perOwner[command.owner] -= 1;
          commandSequence += 1;
          stats.rejected += 1;
          receipts.push(makeReceipt(replaced.command, 'rejected', commandSequence, 'emergency-preempted'));
        } else {
          commandSequence += 1;
          stats.rejected += 1;
          receipts.push(makeReceipt(command, 'rejected', commandSequence, 'owner-budget-emergency'));
          continue;
        }
      }
      perOwner[command.owner] += 1;
      selected.push(item);
    }
    return { selected, receipts };
  }

  function commit(selected) {
    const receipts = [];
    for (const item of selected) {
      const command = item.command;
      commandSequence += 1;
      const owner = realOwners[command.owner];
      if (!owner) {
        stats.rejected += 1;
        receipts.push(makeReceipt(command, 'rejected', commandSequence, 'owner-unavailable'));
        continue;
      }
      const result = callOwner(owner, methodsForOwner(command.owner), resolveOwnerRequest(command, item.entry ?? {}));
      if (!result.invoked || result.error) {
        stats.failed += 1;
        receipts.push(makeReceipt(command, 'failed', commandSequence, result.error ?? result.reason, result));
        continue;
      }
      stats.accepted += 1;
      if (command.owner === 'navigation') stats.navigationCommitted += 1;
      else if (command.owner === 'combat') stats.combatCommitted += 1;
      else stats.eventsCommitted += 1;
      receipts.push(makeReceipt(command, 'accepted', commandSequence, 'owner-committed', result));
    }
    return receipts;
  }

  function finalizeReceipts(receipts) {
    for (const receipt of receipts) recordReceipt(receipt);
    return freeze(receipts);
  }

  function tick(input = {}) {
    if (disposed) return freeze({ accepted: false, reason: 'disposed' });
    const delta = clamp(input.deltaSeconds, 0, 0.25);
    nowSeconds += delta;
    tickCount += 1;
    const external = pendingExternal.splice(0, pendingExternal.length);
    const baseResult = baseRuntime.tick(input);
    const generated = drainBuffers(baseResult);
    const { selected, receipts: arbitrationReceipts } = arbitrate(generated, external);
    const committedReceipts = commit(selected);
    const receipts = finalizeReceipts([...arbitrationReceipts, ...committedReceipts]);
    const snapshot = {
      accepted: baseResult.accepted !== false,
      tick: tickCount,
      clockSeconds: nowSeconds,
      base: baseResult,
      selectedCount: selected.length,
      receiptCount: receipts.length,
      receipts,
      stats: freeze({ ...stats }),
      policyId: LIVING_WORLD_COMPANION_COMMAND_RUNTIME_POLICY.id,
      basePolicyId: baseResult.policyId,
      digest: digest({
        tick: tickCount,
        baseDigest: baseResult.digest,
        receipts: receipts.map((receipt) => ({
          commandId: receipt.commandId,
          state: receipt.state,
          sequence: receipt.sequence,
        })),
      }),
    };
    return freeze(snapshot);
  }

  function snapshot() {
    return freeze({
      disposed,
      tick: tickCount,
      clockSeconds: nowSeconds,
      pendingExternal: pendingExternal.length,
      companionCount: companionRecords.size,
      companions: freeze([...companionRecords.values()]
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((record) => freeze({
          id: record.id,
          sequence: record.sequence,
          accepted: record.accepted,
          rejected: record.rejected,
          failed: record.failed,
          expired: record.expired,
          deduped: record.deduped,
          lastCommandDigest: record.lastCommandDigest,
          history: freeze([...record.history]),
        }))),
      receipts: freeze([...receiptHistory]),
      stats: freeze({ ...stats }),
      policyId: LIVING_WORLD_COMPANION_COMMAND_RUNTIME_POLICY.id,
      digest: digest({
        tick: tickCount,
        companions: [...companionRecords.values()].map((record) => ({
          id: record.id,
          sequence: record.sequence,
          lastCommandDigest: record.lastCommandDigest,
        })).sort((a, b) => a.id.localeCompare(b.id)),
      }),
    });
  }

  function audit() {
    const errors = [];
    if (pendingExternal.length > LIVING_WORLD_COMPANION_COMMAND_RUNTIME_POLICY.maxPendingExternalCommands) errors.push('external-queue-overflow');
    if (receiptHistory.length > LIVING_WORLD_COMPANION_COMMAND_RUNTIME_POLICY.maxReceiptHistory) errors.push('receipt-history-overflow');
    for (const record of companionRecords.values()) {
      if (record.history.length > LIVING_WORLD_COMPANION_COMMAND_RUNTIME_POLICY.maxCompanionHistory) errors.push(`companion-history-overflow:${record.id}`);
      if (!Number.isFinite(record.sequence)) errors.push(`non-finite-sequence:${record.id}`);
      if (!RECEIPT_STATES.every((state) => typeof state === 'string')) errors.push('receipt-policy-invalid');
    }
    const baseAudit = baseRuntime.audit();
    errors.push(...(baseAudit.errors ?? []));
    return freeze({
      ok: errors.length === 0,
      errors: freeze(errors),
      tick: tickCount,
      trackedCompanions: companionRecords.size,
      policyId: LIVING_WORLD_COMPANION_COMMAND_RUNTIME_POLICY.id,
      base: baseAudit,
    });
  }

  function reset() {
    pendingExternal.splice(0, pendingExternal.length);
    for (const owner of OWNER_TYPES) buffers[owner].splice(0, buffers[owner].length);
    companionRecords.clear();
    receiptHistory.splice(0, receiptHistory.length);
    commandSequence = 0;
    tickCount = 0;
    nowSeconds = Math.max(0, finite(clockSeconds));
    stats = createStats();
    baseRuntime.reset();
    return true;
  }

  function dispose() {
    if (disposed) return false;
    disposed = true;
    for (const owner of OWNER_TYPES) buffers[owner].splice(0, buffers[owner].length);
    pendingExternal.splice(0, pendingExternal.length);
    baseRuntime.dispose();
    return true;
  }

  return freeze({
    tick,
    snapshot,
    audit,
    reset,
    dispose,
    enqueueCommand: enqueueExternal,
    get disposed() {
      return disposed;
    },
  });
}

export function auditLivingWorldCompanionCommandRuntime(result) {
  const errors = [];
  if (!result || result.accepted !== true) errors.push('command-runtime-not-accepted');
  if (result?.selectedCount > LIVING_WORLD_COMPANION_COMMAND_RUNTIME_POLICY.maxQueuedCommands) errors.push('selected-overflow');
  if (result?.receipts?.some((receipt) => !RECEIPT_STATES.includes(receipt.state))) errors.push('invalid-receipt-state');
  if (typeof result?.digest !== 'string' || result.digest.length !== 8) errors.push('command-digest-invalid');
  return freeze({ ok: errors.length === 0, errors: freeze(errors) });
}
