/**
 * Read-only bridge for existing animal/creature controllers.
 * It turns their shipped flee/react flags into bounded telemetry for world events,
 * group AI and UI callers without owning fauna behavior or spawning.
 */
const MAX_SAMPLES = 128;

function finiteXZ(value) {
  return Number.isFinite(value?.x) && Number.isFinite(value?.z);
}

function distanceSquared(a, b) {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
}

function iteratorOf(value) {
  try {
    const factory = value?.[Symbol.iterator];
    return typeof factory === 'function' ? factory.call(value) : null;
  } catch {
    return null;
  }
}

function readThreat(entry) {
  const actor = entry?.controller ?? entry;
  const object3D = actor?.object3D ?? entry?.object3D ?? null;
  const position = object3D?.position ?? entry?.position ?? null;
  if (!finiteXZ(position)) return null;
  const fleeing = Boolean(actor?.isFleeing ?? actor?.currentlyFleeing ?? entry?.isFleeing);
  const reacting = Boolean(actor?.isReacting ?? actor?.currentlyReacting ?? entry?.isReacting);
  const species = String(entry?.species ?? entry?.kind ?? object3D?.userData?.species ?? 'fauna');
  const id = String(entry?.id ?? object3D?.uuid ?? object3D?.name ?? species);
  return { id, species, position: { x: position.x, z: position.z }, fleeing, reacting };
}

export function buildLivingWorldFaunaThreatSnapshot(entries, playerPosition, options = {}) {
  const radius = Number.isFinite(options.radiusMeters) && options.radiusMeters >= 0 ? options.radiusMeters : 24;
  const maxSamples = Number.isInteger(options.maxSamples) && options.maxSamples > 0 ? Math.min(options.maxSamples, MAX_SAMPLES) : MAX_SAMPLES;
  const player = finiteXZ(playerPosition) ? playerPosition : null;
  const iterator = iteratorOf(entries);
  if (!iterator) return Object.freeze({ version: 1, radiusMeters: radius, actors: Object.freeze([]), counts: Object.freeze({ fleeing: 0, reacting: 0, threat: 0 }), truncated: false });
  const actors = [];
  let scanned = 0;
  let truncated = false;
  while (scanned < maxSamples) {
    let next;
    try { next = iterator.next(); } catch { break; }
    if (next?.done) break;
    scanned += 1;
    const sample = readThreat(next.value);
    if (!sample) continue;
    const distanceMeters = player ? Math.sqrt(distanceSquared(sample.position, player)) : null;
    const inRadius = distanceMeters != null && distanceMeters <= radius;
    const threat = sample.fleeing || sample.reacting;
    actors.push(Object.freeze({ ...sample, distanceMeters, inRadius, threat }));
  }
  if (scanned >= maxSamples) {
    try { truncated = !iterator.next().done; } catch { truncated = false; }
  }
  actors.sort((a, b) => (Number(b.threat) - Number(a.threat)) || ((a.distanceMeters ?? Infinity) - (b.distanceMeters ?? Infinity)) || a.id.localeCompare(b.id));
  const counts = actors.reduce((acc, actor) => { acc.fleeing += Number(actor.fleeing); acc.reacting += Number(actor.reacting); acc.threat += Number(actor.threat && actor.inRadius); return acc; }, { fleeing: 0, reacting: 0, threat: 0 });
  return Object.freeze({ version: 1, radiusMeters: radius, actors: Object.freeze(actors), counts: Object.freeze(counts), truncated });
}

export function writeLivingWorldFaunaThreatTelemetry(object3D, snapshot) {
  if (!object3D || !snapshot || typeof snapshot !== 'object') return false;
  object3D.userData ??= {};
  object3D.userData.livingWorldFaunaThreat = Object.freeze({ version: snapshot.version, threatCount: snapshot.counts?.threat ?? 0, fleeingCount: snapshot.counts?.fleeing ?? 0, reactingCount: snapshot.counts?.reacting ?? 0, truncated: Boolean(snapshot.truncated) });
  return true;
}
