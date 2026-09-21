// @ts-nocheck
/**
 * Texture residency and mip-selection policy.
 *
 * Browser GPU memory is finite. This policy estimates texture footprint, derives a conservative mip bias,
 * and produces a deterministic residency plan from camera distance, screen coverage, importance and
 * quality tier. It never uploads or disposes textures itself; the asset layer applies the plan.
 * @module textureResidencyPolicy
 */

export const TEXTURE_RESIDENCY_DEFAULTS = Object.freeze({
  maxResidentBytes: 384 * 1024 * 1024,
  minimumMip: 0,
  maximumMip: 12,
  biasPerMeter: 0.0025,
  reserveDistanceMeters: 180,
});

const FORMAT_BYTES = Object.freeze({ rgba8: 4, rgb8: 3, rg8: 2, r8: 1, rgba16f: 8, rg16f: 4, r16f: 2, bc1: 0.5, bc3: 1, bc5: 1, bc7: 1, astc4x4: 1 });
function n(v, f = 0) { return Number.isFinite(Number(v)) ? Number(v) : f; }
function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, n(v, lo))); }
function formatBytes(format) { return FORMAT_BYTES[String(format).toLowerCase()] ?? 4; }
function idOf(item, index) { return String(item?.id ?? `texture-${index}`); }

export function estimateTextureBytes({ width = 1, height = 1, mipLevels = 1, format = 'rgba8' } = {}) {
  let total = 0;
  let w = Math.max(1, Math.trunc(n(width, 1)));
  let h = Math.max(1, Math.trunc(n(height, 1)));
  const bytesPerPixel = formatBytes(format);
  const levels = Math.max(1, Math.trunc(n(mipLevels, 1)));
  for (let level = 0; level < levels; level += 1) {
    total += w * h * bytesPerPixel;
    w = Math.max(1, Math.floor(w / 2));
    h = Math.max(1, Math.floor(h / 2));
  }
  return Math.ceil(total);
}

export function deriveTextureMip({ distanceMeters = 0, screenCoverage = 1, importance = 50, tier = 'balanced', minimumMip = 0, maximumMip = 12 } = {}) {
  const distance = Math.max(0, n(distanceMeters));
  const coverage = clamp(screenCoverage, 0, 1);
  const importanceFactor = 1 - clamp(importance, 0, 100) / 130;
  const tierBias = tier === 'ultra' ? 0 : tier === 'high' ? 0.35 : tier === 'balanced' ? 0.8 : 1.35;
  const distanceBias = Math.log2(1 + distance / 24) * 0.78;
  const coverageBias = (1 - coverage) * 2.2;
  const mip = Math.round(clamp(tierBias + distanceBias + coverageBias + importanceFactor, minimumMip, maximumMip));
  return mip;
}

export function rankTextureResidency(textures, { cameraX = 0, cameraZ = 0, tier = 'balanced' } = {}) {
  return (Array.isArray(textures) ? textures : [])
    .map((texture, index) => {
      const id = idOf(texture, index);
      const dx = n(texture?.x) - n(cameraX);
      const dz = n(texture?.z) - n(cameraZ);
      const distance = Math.sqrt(dx * dx + dz * dz);
      const screenCoverage = clamp(texture?.screenCoverage ?? 0, 0, 1);
      const importance = clamp(texture?.importance ?? 50, 0, 100);
      const mip = deriveTextureMip({ distanceMeters: distance, screenCoverage, importance, tier, minimumMip: 0, maximumMip: Math.max(0, n(texture?.mipCount, 1) - 1) });
      const residencyScore = importance * 0.55 + screenCoverage * 38 + (distance < 180 ? 32 : 0) + (texture?.pinned ? 1000 : 0) - mip * 4;
      return Object.freeze({ ...texture, id, distanceMeters: Number(distance.toFixed(3)), requestedMip: mip, estimatedBytes: estimateTextureBytes(texture), residencyScore: Number(residencyScore.toFixed(5)) });
    })
    .sort((a, b) => b.residencyScore - a.residencyScore || a.id.localeCompare(b.id));
}

export function buildTextureResidencyPlan({ textures = [], cameraX = 0, cameraZ = 0, tier = 'balanced', maxResidentBytes = TEXTURE_RESIDENCY_DEFAULTS.maxResidentBytes } = {}) {
  const ranked = rankTextureResidency(textures, { cameraX, cameraZ, tier });
  let bytes = 0;
  const resident = [];
  const deferred = [];
  const limit = Math.max(1024 * 1024, n(maxResidentBytes, TEXTURE_RESIDENCY_DEFAULTS.maxResidentBytes));
  for (const texture of ranked) {
    const reserved = texture.pinned || texture.distanceMeters <= TEXTURE_RESIDENCY_DEFAULTS.reserveDistanceMeters;
    const mipMultiplier = 1 / (2 ** Math.max(0, texture.requestedMip));
    const effectiveBytes = Math.max(64, Math.ceil(texture.estimatedBytes * mipMultiplier));
    if (reserved || bytes + effectiveBytes <= limit) {
      resident.push(Object.freeze({ ...texture, effectiveBytes }));
      bytes += effectiveBytes;
    } else deferred.push(texture);
  }
  return Object.freeze({ resident: Object.freeze(resident), deferred: Object.freeze(deferred), residentBytes: bytes, deferredCount: deferred.length, capacityBytes: limit, coverage: ranked.length ? Number((resident.length / ranked.length).toFixed(4)) : 1 });
}

export function createTextureResidencyController(options = {}) {
  const config = { ...TEXTURE_RESIDENCY_DEFAULTS, ...options };
  let disposed = false;
  let frame = 0;
  let last = null;
  const history = [];
  return {
    plan(input = {}) {
      if (disposed) throw new Error('TEXTURE_RESIDENCY_CONTROLLER_DISPOSED');
      frame += 1;
      last = Object.freeze({ ...buildTextureResidencyPlan({ ...input, maxResidentBytes: input.maxResidentBytes ?? config.maxResidentBytes }), frame });
      history.push(last);
      while (history.length > 16) history.shift();
      return last;
    },
    snapshot() { return Object.freeze({ frame, last, history: Object.freeze(history.slice(-6)) }); },
    reset() { frame = 0; last = null; history.length = 0; },
    dispose() { disposed = true; last = null; history.length = 0; },
  };
}

export function validateTextureResidencyPlan(plan) {
  return Boolean(plan && plan.residentBytes >= 0 && plan.residentBytes <= plan.capacityBytes && Array.isArray(plan.resident) && Array.isArray(plan.deferred));
}
