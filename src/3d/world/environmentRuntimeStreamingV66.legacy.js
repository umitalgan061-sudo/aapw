const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, Number(value) || 0));
export const V66_STREAMING_POLICY = Object.freeze({ id: 'environment-runtime-streaming-v66-2026-09-15', version: 66, deterministic: true, mutation: false, desktopFpsFloor: 50, mobileFpsFloor: 35, maxResidentChunks: 12 });
export const buildStreamingBudgetV66 = ({ platform = 'desktop', fps = 60, drawCalls = 0, triangles = 0, textureMb = 0, residentChunks = 0 } = {}) => {
  const mobile = platform === 'mobile';
  const floors = { fps: mobile ? V66_STREAMING_POLICY.mobileFpsFloor : V66_STREAMING_POLICY.desktopFpsFloor, draw: mobile ? 90 : 180, triangles: mobile ? 650000 : 1800000, texture: mobile ? 600 : 950, chunks: mobile ? 7 : V66_STREAMING_POLICY.maxResidentChunks };
  const usage = { fps: fps > 0 ? floors.fps / fps : 2, draw: drawCalls / floors.draw, triangles: triangles / floors.triangles, texture: textureMb / floors.texture, chunks: residentChunks / floors.chunks };
  const max = Math.max(...Object.values(usage));
  return { platform, floors, usage, max: Number(max.toFixed(4)), pressure: clamp(max / 1.25), throttle: max > 1, emergency: max > 1.22 };
};
export const buildStreamingTierV66 = (distance, pressure = 0) => { const d = Math.max(0, Number(distance) || 0); const p = clamp(pressure); if (p > 0.9) return d < 700 ? 'near' : d < 1400 ? 'mid' : 'impostor'; if (d < 420) return 'near'; if (d < 1200) return 'mid'; if (d < 2800) return 'far'; return 'impostor'; };
export const buildChunkAdmissionV66 = ({ chunks = [], camera = {}, budget = {} } = {}) => {
  const pressure = clamp(budget.pressure ?? 0);
  const speed = Math.max(0, Number(camera.velocity) || 0);
  const lookAhead = 360 + speed * 18;
  const scored = chunks.map((chunk) => { const distance = Math.max(0, Number(chunk.distance) || 0); const priority = clamp((1 - distance / Math.max(1, lookAhead)) * 0.7 + clamp(chunk.importance ?? 0.5) * 0.3); return { ...chunk, tier: buildStreamingTierV66(distance, pressure), priority }; }).sort((a, b) => b.priority - a.priority || a.tier.localeCompare(b.tier));
  const cap = Math.max(1, Math.round((budget.floors?.chunks ?? 12) * (1 - pressure * 0.28)));
  return { admitted: scored.slice(0, cap), deferred: scored.slice(cap), cap, lookAhead };
};
export const buildVisibilityHysteresisV66 = ({ previous = 'far', distance = 1000, velocity = 0 } = {}) => { const speed = Math.min(70, Math.abs(Number(velocity) || 0)); const bias = speed * 3; const enterFar = 1100 + bias; const leaveFar = 900 + bias * 0.3; if (previous === 'far' && distance < leaveFar) return 'mid'; if (previous === 'mid' && distance > enterFar) return 'far'; return previous; };
export const validateStreamingRuntimeV66 = (runtime) => { const errors = []; if (runtime?.policy !== V66_STREAMING_POLICY.id) errors.push('policy'); if (runtime?.deterministic !== true) errors.push('determinism'); if ((runtime?.budget?.max ?? 0) < 0) errors.push('budget'); if ((runtime?.admission?.admitted?.length ?? 0) > (runtime?.admission?.cap ?? Infinity)) errors.push('cap'); return { ok: errors.length === 0, errors }; };
export const streamingTelemetryV66 = (runtime) => ({ platform: runtime?.budget?.platform || 'unknown', maxUsage: runtime?.budget?.max || 0, pressure: runtime?.budget?.pressure || 0, admitted: runtime?.admission?.admitted?.length || 0, deferred: runtime?.admission?.deferred?.length || 0, emergency: runtime?.budget?.emergency === true });
export const getV66StreamingSummary = () => Object.freeze({ contract: V66_STREAMING_POLICY, features: ['adaptive-budget', 'chunk-admission', 'distance-tier', 'visibility-hysteresis'] });
