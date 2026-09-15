/**
 * Deterministic fauna encounter director.
 * Policy-only adapter over existing fauna owners; it does not spawn actors,
 * move transforms, own physics/navigation, load assets, or persist world state.
 * @module gameplay/livingWorldFaunaEncounterDirector
 */

const VERSION = 'fauna-encounter-director-v1';
const MAX_CANDIDATES = 64;
const MAX_DIRECTIVES = 24;
const MAX_SOCIAL_SIGNAL = 16;

const SPECIES = Object.freeze({
  wolf: { habitat: 'forest', social: 0.82, threatSensitivity: 0.94, curiosity: 0.58, energyDrain: 0.82 },
  horse: { habitat: 'meadow', social: 0.74, threatSensitivity: 0.65, curiosity: 0.42, energyDrain: 0.54 },
  cow: { habitat: 'meadow', social: 0.90, threatSensitivity: 0.55, curiosity: 0.31, energyDrain: 0.48 },
  bull: { habitat: 'meadow', social: 0.66, threatSensitivity: 0.62, curiosity: 0.27, energyDrain: 0.67 },
  deer: { habitat: 'forest', social: 0.72, threatSensitivity: 0.86, curiosity: 0.62, energyDrain: 0.59 },
  stag: { habitat: 'forest', social: 0.55, threatSensitivity: 0.80, curiosity: 0.56, energyDrain: 0.63 },
  boar: { habitat: 'forest', social: 0.48, threatSensitivity: 0.76, curiosity: 0.70, energyDrain: 0.72 },
  sheep: { habitat: 'meadow', social: 0.92, threatSensitivity: 0.69, curiosity: 0.20, energyDrain: 0.44 },
});

const ACTIONS = Object.freeze(['rest', 'graze', 'roam', 'regroup', 'flee', 'investigate', 'return', 'alert']);
const HABITATS = Object.freeze(['forest', 'meadow', 'highland', 'wetland', 'shore', 'rock', 'snow', 'unknown']);

const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, Number.isFinite(Number(value)) ? Number(value) : min));
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const normalizeId = (value, fallback = 'unknown') => {
  const text = String(value ?? '').trim();
  return text ? text.slice(0, 96) : fallback;
};

function fnv1a(input) {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function normalizeCandidate(input, index = 0) {
  const source = input && typeof input === 'object' ? input : {};
  const species = SPECIES[source.species] ? source.species : 'sheep';
  return Object.freeze({
    id: normalizeId(source.id, `fauna-${index}`),
    species,
    habitat: HABITATS.includes(source.habitat) ? source.habitat : 'unknown',
    playerDistance: Math.max(0, finite(source.playerDistance, 9999)),
    threat: clamp(source.threat),
    habitatFit: clamp(source.habitatFit),
    energy: clamp(source.energy),
    socialCount: Math.max(0, Math.min(MAX_SOCIAL_SIGNAL, Math.floor(finite(source.socialCount)))),
    recentThreat: Math.max(0, finite(source.recentThreat)),
    anchorDistance: Math.max(0, finite(source.anchorDistance, 9999)),
    active: source.active !== false,
  });
}

function habitatAffinity(species, habitat) {
  const profile = SPECIES[species];
  if (!profile) return 0.25;
  if (habitat === profile.habitat) return 1;
  if (habitat === 'highland' && profile.habitat === 'forest') return 0.72;
  if (habitat === 'wetland' && profile.habitat === 'meadow') return 0.68;
  if (habitat === 'snow' && profile.habitat === 'forest') return 0.54;
  if (habitat === 'rock') return 0.28;
  if (habitat === 'shore') return 0.20;
  return 0.12;
}

function proximityScore(distance) {
  if (distance <= 4) return 1;
  if (distance >= 80) return 0;
  return 1 - ((distance - 4) / 76);
}

function threatScore(candidate) {
  return clamp(Math.max(candidate.threat, Math.min(1, candidate.recentThreat / 8)));
}

function socialStability(candidate) {
  const profile = SPECIES[candidate.species];
  const members = clamp(candidate.socialCount / MAX_SOCIAL_SIGNAL);
  return clamp((members * profile.social) + ((1 - members) * 0.35));
}

function locomotionNeed(candidate) {
  const profile = SPECIES[candidate.species];
  return clamp(((1 - candidate.energy) * profile.energyDrain) + (candidate.threat * profile.threatSensitivity));
}

function chooseAction(candidate) {
  const threat = threatScore(candidate);
  const proximity = proximityScore(candidate.playerDistance);
  const social = socialStability(candidate);
  const habitat = clamp((candidate.habitatFit * 0.65) + (habitatAffinity(candidate.species, candidate.habitat) * 0.35));
  const locomotion = locomotionNeed(candidate);

  if (threat >= 0.78 || (proximity >= 0.82 && threat >= 0.48)) return 'flee';
  if (candidate.socialCount >= 2 && social < 0.46 && threat < 0.55) return 'regroup';
  if (candidate.recentThreat >= 3 && threat < 0.78 && proximity > 0.30) return 'investigate';
  if (habitat < 0.34) return 'return';
  if (candidate.energy < 0.18 && threat < 0.35) return 'rest';
  if (candidate.energy < 0.46 && threat < 0.30) return 'graze';
  if (proximity < 0.24 && locomotion < 0.38) return 'roam';
  if (threat >= 0.34) return 'alert';
  return 'roam';
}

const PRIORITY = Object.freeze({ flee: 1, return: 0.82, alert: 0.74, investigate: 0.68, regroup: 0.61, roam: 0.44, graze: 0.32, rest: 0.22 });

function scoreCandidate(candidate) {
  const threat = threatScore(candidate);
  const proximity = proximityScore(candidate.playerDistance);
  const habitat = clamp((candidate.habitatFit + habitatAffinity(candidate.species, candidate.habitat)) / 2);
  const social = socialStability(candidate);
  const energy = clamp(1 - candidate.energy);
  const action = chooseAction(candidate);
  return Object.freeze({
    action,
    urgency: clamp(
      (threat * 0.42) + (proximity * 0.20) + (energy * 0.12) +
      ((1 - social) * 0.08) + ((1 - habitat) * 0.08) + ((PRIORITY[action] ?? 0) * 0.10),
    ),
    components: Object.freeze({ threat, proximity, habitat, social, energy }),
  });
}

function buildDirective(candidate) {
  const scored = scoreCandidate(candidate);
  const speedScale = scored.action === 'flee' ? 1 : scored.action === 'return' ? 0.78 : 0.55;
  const radius = scored.action === 'flee' ? 28 : scored.action === 'return' ? 12 : 8;
  const profile = SPECIES[candidate.species];
  return Object.freeze({
    id: candidate.id,
    species: candidate.species,
    action: scored.action,
    priority: scored.urgency,
    move: Object.freeze({
      required: !['rest', 'alert'].includes(scored.action),
      speedScale,
      radius,
      anchorDistance: candidate.anchorDistance,
    }),
    social: Object.freeze({
      observe: candidate.socialCount > 0,
      regroup: scored.action === 'regroup',
      broadcast: scored.action === 'alert' || scored.action === 'flee',
      memberLimit: Math.min(MAX_SOCIAL_SIGNAL, Math.max(0, Math.floor(profile.social * 12))),
    }),
    safety: Object.freeze({
      preservePhysics: true,
      preserveNavigationOwner: true,
      preserveSpawnerOwner: true,
      preserveAssetOwner: true,
    }),
    evidence: Object.freeze({
      threat: scored.components.threat,
      habitatFit: scored.components.habitat,
      socialStability: scored.components.social,
      energyPressure: scored.components.energy,
      playerProximity: scored.components.proximity,
    }),
  });
}

export function createFaunaEncounterDirector(options = {}) {
  const state = {
    tick: 0,
    disposed: false,
    candidateLimit: Math.max(1, Math.min(MAX_CANDIDATES, Math.floor(finite(options.candidateLimit, MAX_CANDIDATES)))),
    directiveLimit: Math.max(1, Math.min(MAX_DIRECTIVES, Math.floor(finite(options.directiveLimit, MAX_DIRECTIVES)))),
    lastDigest: '',
  };

  const snapshot = () => Object.freeze({
    version: VERSION,
    tick: state.tick,
    disposed: state.disposed,
    lastDigest: state.lastDigest,
  });

  const evaluate = (candidates = [], runtime = {}) => {
    if (state.disposed) throw new Error('fauna encounter director is disposed');
    const list = Array.isArray(candidates) ? candidates.slice(0, state.candidateLimit).map(normalizeCandidate) : [];
    const active = list.filter((candidate) => candidate.active);
    const ranked = active
      .map((candidate) => ({ candidate, scored: scoreCandidate(candidate) }))
      .sort((a, b) => b.scored.urgency - a.scored.urgency || a.candidate.id.localeCompare(b.candidate.id));
    const directives = ranked.slice(0, state.directiveLimit).map(({ candidate }) => buildDirective(candidate));
    state.tick += 1;
    const context = Object.freeze({
      weather: normalizeId(runtime.weather, 'clear'),
      timeBucket: Math.max(0, Math.floor(finite(runtime.timeBucket))),
      paused: runtime.paused === true,
    });
    const payload = stable({
      version: VERSION,
      tick: state.tick,
      context,
      candidateCount: active.length,
      directiveCount: directives.length,
      directives,
    });
    state.lastDigest = fnv1a(JSON.stringify(payload)).toString(16).padStart(8, '0');
    return Object.freeze({
      version: VERSION,
      tick: state.tick,
      context,
      candidateCount: active.length,
      directiveCount: directives.length,
      directives: Object.freeze(directives),
      digest: state.lastDigest,
    });
  };

  const reset = () => {
    state.tick = 0;
    state.lastDigest = '';
    state.disposed = false;
    return snapshot();
  };

  const dispose = () => {
    state.disposed = true;
    return snapshot();
  };

  return Object.freeze({ version: VERSION, snapshot, evaluate, reset, dispose });
}

export function auditFaunaEncounterResult(result) {
  const issues = [];
  if (!result || result.version !== VERSION) issues.push('version');
  if (!Number.isInteger(result?.candidateCount) || result.candidateCount < 0) issues.push('candidate-count');
  if (!Number.isInteger(result?.directiveCount) || result.directiveCount < 0 || result.directiveCount > MAX_DIRECTIVES) issues.push('directive-count');
  if (!Array.isArray(result?.directives)) issues.push('directives-type');
  for (const directive of result?.directives ?? []) {
    if (!ACTIONS.includes(directive.action)) issues.push(`${directive.id}:action`);
    if (!Number.isFinite(directive.priority) || directive.priority < 0 || directive.priority > 1) issues.push(`${directive.id}:priority`);
    if (directive.safety?.preservePhysics !== true) issues.push(`${directive.id}:physics`);
    if (directive.safety?.preserveSpawnerOwner !== true) issues.push(`${directive.id}:spawner`);
  }
  return Object.freeze({ ok: issues.length === 0, issues: Object.freeze(issues) });
}

export function compareFaunaEncounterRuns(a, b) {
  return Object.freeze({
    equalDigest: String(a?.digest ?? '') === String(b?.digest ?? ''),
    equalDirectiveCount: Number(a?.directiveCount) === Number(b?.directiveCount),
    directiveOrder: JSON.stringify((a?.directives ?? []).map((d) => d.id)) === JSON.stringify((b?.directives ?? []).map((d) => d.id)),
  });
}

export function classifyFaunaEncounterCase({ species, habitat, behavior, threat, distance }) {
  const candidate = normalizeCandidate({
    id: `${species}-${behavior}-${threat}-${distance}`,
    species,
    habitat,
    threat: clamp(threat / 7),
    playerDistance: 4 + (Math.max(0, Math.min(7, distance)) * 12),
    habitatFit: behavior === 'calm' ? 1 : behavior === 'herd' ? 0.76 : 0.58,
    energy: 1 - clamp((Math.max(0, Math.min(7, threat)) / 7) * 0.55),
    socialCount: behavior === 'herd' ? 8 : behavior === 'alert' ? 3 : 1,
    recentThreat: behavior === 'flee' ? 4 : behavior === 'investigate' ? 2 : 0,
  });
  const score = scoreCandidate(candidate);
  return Object.freeze({
    action: score.action,
    tier: score.urgency >= 0.78 ? 'critical' : score.urgency >= 0.58 ? 'high' : score.urgency >= 0.34 ? 'normal' : 'low',
    urgency: Number(score.urgency.toFixed(6)),
  });
}

export const FAUNA_ENCOUNTER_LIMITS = Object.freeze({
  version: VERSION,
  maxCandidates: MAX_CANDIDATES,
  maxDirectives: MAX_DIRECTIVES,
  maxSocialSignal: MAX_SOCIAL_SIGNAL,
});
export const FAUNA_ENCOUNTER_SPECIES = Object.freeze(Object.keys(SPECIES));
export const FAUNA_ENCOUNTER_ACTIONS = ACTIONS;
