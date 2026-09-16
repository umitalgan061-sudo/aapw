/**
 * Declarative frame-graph resource planner.
 *
 * Tracks logical render resources and lifetimes without allocating GPU objects. Aliasing decisions are
 * deterministic and bounded, allowing a future WebGPU/RenderPipeline integration to reuse compatible
 * transient attachments while retaining explicit ownership at the renderer layer.
 *
 * @module frameGraphResourcePlanner
 */

const freeze = Object.freeze;
const integer = (value, fallback = 0) => Math.max(0, Math.floor(Number.isFinite(Number(value)) ? Number(value) : fallback));
const positive = (value, fallback = 1) => Math.max(1, integer(value, fallback));

export const FRAME_GRAPH_RESOURCE_POLICY = freeze({
  id: 'frame-graph-resource-planner-2026-09-v1',
  maxPasses: 64,
  maxResources: 128,
  maxDependenciesPerPass: 16,
  maxAliases: 128,
});

const USAGE_GROUPS = freeze({
  color: 'color',
  depth: 'depth',
  normal: 'color',
  velocity: 'color',
  mask: 'color',
  history: 'history',
});

function normalizeResource(resource, index) {
  const width = positive(resource?.width, 1);
  const height = positive(resource?.height, 1);
  const format = String(resource?.format || 'rgba8unorm').slice(0, 32);
  const usage = USAGE_GROUPS[resource?.usage] || 'color';
  const samples = positive(resource?.samples, 1);
  const transient = resource?.transient !== false;
  const id = String(resource?.id || `resource-${index}`).slice(0, 96);
  return freeze({ id, width, height, format, usage, samples, transient, firstPass: integer(resource?.firstPass, 0), lastPass: integer(resource?.lastPass, 0) });
}

function compatible(a, b) {
  return a.transient && b.transient
    && a.width === b.width && a.height === b.height
    && a.format === b.format && a.usage === b.usage && a.samples === b.samples;
}

export function createFrameGraphResourcePlanner(options = {}) {
  const policy = freeze({ ...FRAME_GRAPH_RESOURCE_POLICY, ...(options.policy || {}) });
  const passes = new Map();
  const resources = new Map();
  let revision = 0;

  function addPass(pass) {
    if (passes.size >= policy.maxPasses) return false;
    const id = String(pass?.id || `pass-${passes.size}`).slice(0, 96);
    const reads = Array.isArray(pass?.reads) ? pass.reads.slice(0, policy.maxDependenciesPerPass).map((value) => String(value).slice(0, 96)) : [];
    const writes = Array.isArray(pass?.writes) ? pass.writes.slice(0, policy.maxDependenciesPerPass).map((value) => String(value).slice(0, 96)) : [];
    passes.set(id, freeze({ id, order: integer(pass?.order, passes.size), reads: freeze([...new Set(reads)].sort()), writes: freeze([...new Set(writes)].sort()) }));
    revision += 1;
    return true;
  }

  function addResource(resource) {
    if (resources.size >= policy.maxResources) return false;
    const normalized = normalizeResource(resource, resources.size);
    resources.set(normalized.id, normalized);
    revision += 1;
    return true;
  }

  function inferLifetimes() {
    const ordered = [...passes.values()].sort((a, b) => (a.order - b.order) || a.id.localeCompare(b.id));
    const positions = new Map(ordered.map((pass, index) => [pass.id, index]));
    const lifetimes = [];
    for (const resource of resources.values()) {
      const uses = ordered.filter((pass) => pass.reads.includes(resource.id) || pass.writes.includes(resource.id));
      const firstPass = uses.length ? positions.get(uses[0].id) : resource.firstPass;
      const lastPass = uses.length ? positions.get(uses[uses.length - 1].id) : resource.lastPass;
      const updated = freeze({ ...resource, firstPass: integer(firstPass), lastPass: integer(lastPass) });
      resources.set(resource.id, updated);
      lifetimes.push(updated);
    }
    return freeze(lifetimes);
  }

  function planAliasing() {
    const lifetimes = inferLifetimes().sort((a, b) => (a.firstPass - b.firstPass) || a.id.localeCompare(b.id));
    const aliases = [];
    const slots = [];
    for (const resource of lifetimes) {
      if (!resource.transient) continue;
      let slot = slots.find((candidate) => candidate.lastPass < resource.firstPass && compatible(candidate.resource, resource));
      if (!slot) {
        if (slots.length >= policy.maxAliases) continue;
        slot = { index: slots.length, resource, lastPass: resource.lastPass };
        slots.push(slot);
      } else {
        aliases.push(freeze({ resourceId: resource.id, slot: slot.index, replaces: slot.resource.id }));
        slot.resource = resource;
        slot.lastPass = resource.lastPass;
      }
    }
    return freeze({ slots: freeze(slots.map((slot) => freeze({ index: slot.index, resourceId: slot.resource.id, lastPass: slot.lastPass }))), aliases: freeze(aliases), peakTransientSlots: slots.length });
  }

  function dependencyPlan() {
    const ordered = [...passes.values()].sort((a, b) => (a.order - b.order) || a.id.localeCompare(b.id));
    const producers = new Map();
    const edges = [];
    for (const pass of ordered) {
      for (const read of pass.reads) {
        const producer = producers.get(read);
        if (producer && producer !== pass.id) edges.push(freeze({ from: producer, to: pass.id, resource: read }));
      }
      for (const write of pass.writes) producers.set(write, pass.id);
    }
    return freeze({ order: freeze(ordered.map((pass) => pass.id)), edges: freeze(edges) });
  }

  function snapshot() {
    return freeze({ policy, revision, passes: freeze([...passes.values()].sort((a, b) => (a.order - b.order) || a.id.localeCompare(b.id))), resources: freeze([...resources.values()].sort((a, b) => a.id.localeCompare(b.id))), aliasing: planAliasing(), dependencies: dependencyPlan() });
  }

  function reset() { passes.clear(); resources.clear(); revision += 1; }

  return freeze({ addPass, addResource, inferLifetimes, planAliasing, dependencyPlan, snapshot, reset, get revision() { return revision; } });
}

export function estimateTransientMemory(plan = {}) {
  const slots = Math.max(0, integer(plan.peakTransientSlots, 0));
  const resources = Array.isArray(plan.resources) ? plan.resources : [];
  const bytes = resources.reduce((sum, resource) => {
    const bpp = /depth/i.test(resource.format) ? 4 : /rgba16/i.test(resource.format) ? 8 : 4;
    return sum + Math.max(1, integer(resource.width, 1)) * Math.max(1, integer(resource.height, 1)) * bpp * Math.max(1, integer(resource.samples, 1));
  }, 0);
  return Object.freeze({ peakTransientSlots: slots, conservativeBytes: bytes, conservativeMb: Number((bytes / (1024 * 1024)).toFixed(2)) });
}
