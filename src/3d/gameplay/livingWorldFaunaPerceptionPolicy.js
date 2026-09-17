const DEFAULTS = Object.freeze({
  maxActors: 64,
  maxStimuliPerActor: 8,
  maxRange: 48,
  hearingRange: 28,
  fieldOfViewDegrees: 110,
  tickIntervalSeconds: 0.25,
});

function finite(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function distanceSquared(a, b) {
  const ax = finite(a?.x);
  const az = finite(a?.z);
  const bx = finite(b?.x);
  const bz = finite(b?.z);
  const dx = ax - bx;
  const dz = az - bz;
  return dx * dx + dz * dz;
}

function normalizePosition(position) {
  return Object.freeze({
    x: finite(position?.x),
    y: finite(position?.y),
    z: finite(position?.z),
  });
}

function normalizeStimulus(stimulus, index) {
  return {
    id: String(stimulus?.id ?? `stimulus-${index}`),
    type: String(stimulus?.type ?? 'unknown'),
    sourceId: stimulus?.sourceId == null ? null : String(stimulus.sourceId),
    position: normalizePosition(stimulus?.position),
    intensity: clamp(finite(stimulus?.intensity, 0), 0, 1),
    channel: stimulus?.channel === 'hearing' ? 'hearing' : 'vision',
  };
}

function headingVector(actor) {
  const radians = (finite(actor?.headingDegrees) * Math.PI) / 180;
  return { x: Math.sin(radians), z: Math.cos(radians) };
}

function withinFieldOfView(actor, stimulus, fovDegrees) {
  const deltaX = stimulus.position.x - finite(actor?.position?.x);
  const deltaZ = stimulus.position.z - finite(actor?.position?.z);
  const length = Math.hypot(deltaX, deltaZ);
  if (length <= Number.EPSILON) return true;
  const heading = headingVector(actor);
  const dot = clamp((heading.x * deltaX + heading.z * deltaZ) / length, -1, 1);
  const angle = (Math.acos(dot) * 180) / Math.PI;
  return angle <= fovDegrees / 2;
}

function visibilityMultiplier(actor, stimulus) {
  if (stimulus.channel === 'hearing') return 1;
  if (actor?.lineOfSight === false) return 0;
  return 1;
}

function scoreStimulus(actor, stimulus, options) {
  const distance = Math.sqrt(distanceSquared(actor.position, stimulus.position));
  const maxRange = stimulus.channel === 'hearing' ? options.hearingRange : options.maxRange;
  if (distance > maxRange) return null;
  if (stimulus.channel === 'vision' && !withinFieldOfView(actor, stimulus, options.fieldOfViewDegrees)) return null;
  const visibility = visibilityMultiplier(actor, stimulus);
  if (visibility <= 0) return null;
  const rangeScore = 1 - distance / maxRange;
  const score = clamp(rangeScore * (0.55 + stimulus.intensity * 0.45) * visibility, 0, 1);
  return Object.freeze({
    id: stimulus.id,
    type: stimulus.type,
    sourceId: stimulus.sourceId,
    channel: stimulus.channel,
    distance: Number(distance.toFixed(4)),
    score: Number(score.toFixed(6)),
    response: score >= 0.7 ? 'engage' : score >= 0.35 ? 'investigate' : 'ignore',
  });
}

export function createLivingWorldFaunaPerceptionPolicy(config = {}) {
  const options = Object.freeze({ ...DEFAULTS, ...config });
  if (options.maxActors <= 0 || options.maxStimuliPerActor <= 0) throw new RangeError('positive perception budgets required');
  let disposed = false;

  return Object.freeze({
    evaluate({ actors = [], stimuli = [], nowSeconds = 0 } = {}) {
      if (disposed) throw new Error('fauna perception policy disposed');
      const normalizedStimuli = stimuli.map(normalizeStimulus);
      const orderedActors = actors
        .slice()
        .sort((a, b) => String(a?.id ?? '').localeCompare(String(b?.id ?? '')))
        .slice(0, options.maxActors);
      const observations = orderedActors.map((actor) => {
        const candidates = normalizedStimuli
          .map((stimulus) => scoreStimulus(actor, stimulus, options))
          .filter(Boolean)
          .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
          .slice(0, options.maxStimuliPerActor);
        return Object.freeze({
          actorId: String(actor?.id ?? 'unknown'),
          tick: Math.floor(finite(nowSeconds) / options.tickIntervalSeconds),
          observations: Object.freeze(candidates),
          nextSenseInSeconds: options.tickIntervalSeconds,
        });
      });
      return Object.freeze({
        budget: Object.freeze({ maxActors: options.maxActors, maxStimuliPerActor: options.maxStimuliPerActor }),
        observations: Object.freeze(observations),
      });
    },
    dispose() {
      disposed = true;
    },
  });
}

export { DEFAULTS as LIVING_WORLD_FAUNA_PERCEPTION_DEFAULTS };
