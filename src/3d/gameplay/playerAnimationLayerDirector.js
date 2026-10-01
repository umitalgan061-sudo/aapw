/**
 * Deterministic animation layer policy for the existing player presentation caller.
 * Does not own AnimationMixer, clips, transforms, combat state, or scene mutation.
 * @module gameplay/playerAnimationLayerDirector
 */
const LAYERS = Object.freeze({ locomotion: 0, defense: 1, combat: 2, reaction: 3, additive: 4 });
const DEFAULTS = Object.freeze({ maxLayers: 4, locomotionFloor: 0.2, additiveCeiling: 0.35, confidenceFloor: 0.25 });
function finite(value, fallback = 0) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function clamp01(value) { return clamp(finite(value), 0, 1); }
function round(value, digits = 4) { const factor = 10 ** digits; const n = Math.round(finite(value) * factor) / factor; return Object.is(n, -0) ? 0 : n; }
function normalizeName(value, fallback = 'locomotion') { const key = String(value ?? fallback).trim().toLowerCase(); return Object.hasOwn(LAYERS, key) ? key : fallback; }
function stableSort(rows) { return [...rows].sort((a, b) => (LAYERS[a.layer] - LAYERS[b.layer]) || a.layer.localeCompare(b.layer)); }

export function buildAnimationLayerPlan({ layers = [], locomotionWeight = 1, environmentalConfidence = 1, paused = false } = {}) {
  const confidence = clamp01(environmentalConfidence);
  const input = Array.isArray(layers) ? layers : [];
  const normalized = input.map((row, index) => {
    const source = row && typeof row === 'object' ? row : {};
    const layer = normalizeName(source.layer);
    const requestedWeight = clamp01(source.weight);
    const enabled = source.enabled !== false && !paused;
    const priority = Number.isFinite(Number(source.priority)) ? Number(source.priority) : index;
    const maxWeight = layer === 'additive' ? DEFAULTS.additiveCeiling : 1;
    return { layer, clip: String(source.clip ?? `${layer}-default`), weight: round(enabled ? clamp(requestedWeight, 0, maxWeight) : 0), priority, enabled, confidence: round(confidence) };
  });
  const deduped = new Map();
  for (const row of normalized) { const previous = deduped.get(row.layer); if (!previous || row.priority < previous.priority) deduped.set(row.layer, row); }
  const rows = stableSort([...deduped.values()]).slice(0, DEFAULTS.maxLayers);
  const locomotion = clamp(locomotionWeight, DEFAULTS.locomotionFloor, 1);
  const active = rows.filter(row => row.weight > 0);
  const total = active.reduce((sum, row) => sum + row.weight, 0);
  const scale = total > 1 ? 1 / total : 1;
  const outputRows = rows.map(row => ({ ...row, weight: round(row.weight * scale * (row.layer === 'locomotion' ? locomotion : 1)) }));
  return Object.freeze({ layers: Object.freeze(outputRows.map(row => Object.freeze(row))), activeCount: outputRows.filter(row => row.weight > 0).length, locomotionWeight: round(locomotion), environmentalConfidence: round(confidence), paused: Boolean(paused) });
}

export function resolveAnimationLayerBlend({ plan = null, previous = null, normalizedTime = 0, interruptible = true } = {}) {
  const current = plan && typeof plan === 'object' ? plan : buildAnimationLayerPlan();
  const prevRows = previous?.layers && Array.isArray(previous.layers) ? previous.layers : [];
  const time = clamp01(normalizedTime);
  const protectedCombat = current.layers?.some(row => row.layer === 'combat' && row.weight > 0 && time < 0.18) || false;
  const protectedDefense = current.layers?.some(row => row.layer === 'defense' && row.weight > 0 && time < 0.08) || false;
  const protectedWindow = protectedCombat || protectedDefense;
  const permitted = Boolean(interruptible) && !protectedWindow;
  const previousActive = prevRows.filter(row => finite(row.weight) > 0).map(row => row.layer).sort();
  const currentActive = (current.layers || []).filter(row => finite(row.weight) > 0).map(row => row.layer).sort();
  return Object.freeze({ permitted, protectedWindow, normalizedTime: round(time), previousActive: Object.freeze(previousActive), currentActive: Object.freeze(currentActive), changed: previousActive.join('|') !== currentActive.join('|'), crossfadeSeconds: round(protectedWindow ? 0.08 : 0.16) });
}

export function validateAnimationLayerPlan(plan) {
  const errors = []; const warnings = [];
  if (!plan || typeof plan !== 'object' || !Array.isArray(plan.layers)) return Object.freeze({ ok: false, errors: Object.freeze(['missing-plan']), warnings: Object.freeze([]) });
  const seen = new Set(); let total = 0;
  for (const row of plan.layers) {
    if (!Object.hasOwn(LAYERS, row.layer)) errors.push(`unknown-layer:${row.layer}`);
    if (seen.has(row.layer)) warnings.push(`duplicate-layer:${row.layer}`);
    seen.add(row.layer);
    if (row.weight < 0 || row.weight > 1) errors.push(`weight-out-of-range:${row.layer}`);
    total += finite(row.weight);
  }
  if (total > 1.00001) errors.push('weights-exceed-one');
  if (plan.environmentalConfidence < DEFAULTS.confidenceFloor && plan.activeCount > 0) warnings.push('low-environment-confidence');
  return Object.freeze({ ok: errors.length === 0, errors: Object.freeze([...new Set(errors)]), warnings: Object.freeze([...new Set(warnings)]) });
}

export function buildPlayerAnimationLayerDirector(input = {}) {
  const plan = buildAnimationLayerPlan(input);
  const transition = resolveAnimationLayerBlend({ plan, previous: input.previousPlan, normalizedTime: input.normalizedTime, interruptible: input.interruptible });
  return Object.freeze({ plan, transition, validation: validateAnimationLayerPlan(plan) });
}

export { DEFAULTS, LAYERS };
