/**
 * Regional sediment/rainwash surface profiles.
 *
 * Profiles are material-response presets only. They never create or move terrain.
 */

export const TERRAIN_SEDIMENT_PROFILES = Object.freeze([
  Object.freeze({ id: 'temperate-loam', weight: 1.00, deposit: 0.22, wash: 0.18, film: 0.16, crust: 0.09, aggregate: 0.16, cool: 0.04 }),
  Object.freeze({ id: 'river-meadow', weight: 0.92, deposit: 0.31, wash: 0.13, film: 0.25, crust: 0.05, aggregate: 0.11, cool: 0.02 }),
  Object.freeze({ id: 'silty-floodplain', weight: 0.88, deposit: 0.38, wash: 0.17, film: 0.28, crust: 0.04, aggregate: 0.08, cool: 0.01 }),
  Object.freeze({ id: 'dry-loess', weight: 0.78, deposit: 0.25, wash: 0.22, film: 0.07, crust: 0.21, aggregate: 0.19, cool: 0.00 }),
  Object.freeze({ id: 'coastal-silt', weight: 0.83, deposit: 0.34, wash: 0.12, film: 0.30, crust: 0.03, aggregate: 0.07, cool: 0.05 }),
  Object.freeze({ id: 'upland-gravel', weight: 0.71, deposit: 0.16, wash: 0.29, film: 0.05, crust: 0.14, aggregate: 0.33, cool: 0.00 }),
  Object.freeze({ id: 'windblown-sand', weight: 0.68, deposit: 0.29, wash: 0.12, film: 0.04, crust: 0.16, aggregate: 0.28, cool: 0.00 }),
  Object.freeze({ id: 'woodland-duff', weight: 0.81, deposit: 0.21, wash: 0.09, film: 0.19, crust: 0.05, aggregate: 0.12, cool: 0.08 }),
  Object.freeze({ id: 'heath-soil', weight: 0.77, deposit: 0.18, wash: 0.12, film: 0.13, crust: 0.11, aggregate: 0.14, cool: 0.10 }),
  Object.freeze({ id: 'chalky-marginal', weight: 0.63, deposit: 0.14, wash: 0.26, film: 0.04, crust: 0.19, aggregate: 0.37, cool: 0.00 }),
  Object.freeze({ id: 'clayey-basin', weight: 0.85, deposit: 0.42, wash: 0.10, film: 0.32, crust: 0.06, aggregate: 0.06, cool: 0.02 }),
  Object.freeze({ id: 'stony-bench', weight: 0.69, deposit: 0.12, wash: 0.24, film: 0.05, crust: 0.13, aggregate: 0.39, cool: 0.01 }),
  Object.freeze({ id: 'mudflat-edge', weight: 0.74, deposit: 0.36, wash: 0.09, film: 0.37, crust: 0.02, aggregate: 0.05, cool: 0.09 }),
  Object.freeze({ id: 'rainfed-pasture', weight: 0.96, deposit: 0.24, wash: 0.16, film: 0.21, crust: 0.06, aggregate: 0.12, cool: 0.05 }),
  Object.freeze({ id: 'storm-exposed-soil', weight: 0.64, deposit: 0.19, wash: 0.36, film: 0.06, crust: 0.11, aggregate: 0.31, cool: 0.00 }),
  Object.freeze({ id: 'cool-spring-ground', weight: 0.73, deposit: 0.26, wash: 0.15, film: 0.24, crust: 0.04, aggregate: 0.12, cool: 0.14 }),
  Object.freeze({ id: 'warm-valley-floor', weight: 0.91, deposit: 0.33, wash: 0.14, film: 0.22, crust: 0.12, aggregate: 0.10, cool: 0.00 }),
  Object.freeze({ id: 'foggy-coastal-plain', weight: 0.79, deposit: 0.29, wash: 0.10, film: 0.34, crust: 0.02, aggregate: 0.06, cool: 0.16 }),
  Object.freeze({ id: 'dry-rainshadow', weight: 0.57, deposit: 0.17, wash: 0.28, film: 0.03, crust: 0.25, aggregate: 0.33, cool: 0.00 }),
  Object.freeze({ id: 'mixed-colluvium', weight: 0.70, deposit: 0.27, wash: 0.27, film: 0.08, crust: 0.10, aggregate: 0.27, cool: 0.01 }),
  Object.freeze({ id: 'braided-channel-margin', weight: 0.76, deposit: 0.35, wash: 0.23, film: 0.18, crust: 0.04, aggregate: 0.18, cool: 0.02 }),
  Object.freeze({ id: 'peaty-lowland', weight: 0.72, deposit: 0.30, wash: 0.07, film: 0.31, crust: 0.02, aggregate: 0.04, cool: 0.18 }),
  Object.freeze({ id: 'forest-clearing-soil', weight: 0.80, deposit: 0.23, wash: 0.16, film: 0.15, crust: 0.10, aggregate: 0.15, cool: 0.06 }),
  Object.freeze({ id: 'orchard-like-loam', weight: 0.67, deposit: 0.28, wash: 0.14, film: 0.17, crust: 0.08, aggregate: 0.10, cool: 0.02 }),
  Object.freeze({ id: 'highland-brown-earth', weight: 0.61, deposit: 0.16, wash: 0.31, film: 0.08, crust: 0.12, aggregate: 0.29, cool: 0.04 }),
  Object.freeze({ id: 'marsh-fringe', weight: 0.75, deposit: 0.41, wash: 0.08, film: 0.38, crust: 0.01, aggregate: 0.04, cool: 0.12 }),
  Object.freeze({ id: 'scree-footsoil', weight: 0.55, deposit: 0.11, wash: 0.34, film: 0.03, crust: 0.10, aggregate: 0.42, cool: 0.03 }),
  Object.freeze({ id: 'sun-baked-bench', weight: 0.58, deposit: 0.18, wash: 0.25, film: 0.03, crust: 0.28, aggregate: 0.31, cool: 0.00 }),
  Object.freeze({ id: 'rain-washed-hill', weight: 0.73, deposit: 0.13, wash: 0.39, film: 0.07, crust: 0.09, aggregate: 0.30, cool: 0.03 }),
  Object.freeze({ id: 'river-terrace', weight: 0.82, deposit: 0.33, wash: 0.19, film: 0.18, crust: 0.10, aggregate: 0.16, cool: 0.04 }),
  Object.freeze({ id: 'alluvial-fan', weight: 0.78, deposit: 0.37, wash: 0.25, film: 0.10, crust: 0.08, aggregate: 0.24, cool: 0.02 }),
  Object.freeze({ id: 'coastal-blown-loam', weight: 0.65, deposit: 0.30, wash: 0.21, film: 0.18, crust: 0.07, aggregate: 0.20, cool: 0.08 }),
  Object.freeze({ id: 'rocky-grazing-ground', weight: 0.60, deposit: 0.13, wash: 0.29, film: 0.05, crust: 0.14, aggregate: 0.37, cool: 0.02 }),
  Object.freeze({ id: 'moist-heath-margin', weight: 0.69, deposit: 0.20, wash: 0.16, film: 0.20, crust: 0.07, aggregate: 0.13, cool: 0.10 }),
  Object.freeze({ id: 'valley-clay', weight: 0.84, deposit: 0.40, wash: 0.13, film: 0.27, crust: 0.08, aggregate: 0.08, cool: 0.01 }),
  Object.freeze({ id: 'red-brown-upland', weight: 0.56, deposit: 0.15, wash: 0.24, film: 0.05, crust: 0.23, aggregate: 0.29, cool: 0.00 }),
  Object.freeze({ id: 'cold-open-soil', weight: 0.62, deposit: 0.18, wash: 0.25, film: 0.18, crust: 0.03, aggregate: 0.22, cool: 0.15 }),
  Object.freeze({ id: 'spring-melt-margin', weight: 0.74, deposit: 0.34, wash: 0.22, film: 0.31, crust: 0.02, aggregate: 0.12, cool: 0.20 }),
  Object.freeze({ id: 'dry-steppe-like-loam', weight: 0.49, deposit: 0.15, wash: 0.29, film: 0.02, crust: 0.30, aggregate: 0.31, cool: 0.00 }),
  Object.freeze({ id: 'soft-depositional-soil', weight: 0.77, deposit: 0.44, wash: 0.12, film: 0.25, crust: 0.05, aggregate: 0.07, cool: 0.01 }),
  Object.freeze({ id: 'gravelly-floodplain', weight: 0.63, deposit: 0.27, wash: 0.26, film: 0.13, crust: 0.08, aggregate: 0.32, cool: 0.02 }),
  Object.freeze({ id: 'wind-scoured-loam', weight: 0.52, deposit: 0.12, wash: 0.37, film: 0.03, crust: 0.11, aggregate: 0.36, cool: 0.00 }),
  Object.freeze({ id: 'damp-forest-edge', weight: 0.71, deposit: 0.25, wash: 0.10, film: 0.24, crust: 0.03, aggregate: 0.10, cool: 0.12 }),
  Object.freeze({ id: 'shallow-basin-mud', weight: 0.81, deposit: 0.45, wash: 0.08, film: 0.39, crust: 0.01, aggregate: 0.04, cool: 0.10 }),
  Object.freeze({ id: 'sunlit-gravel-bench', weight: 0.58, deposit: 0.12, wash: 0.27, film: 0.04, crust: 0.24, aggregate: 0.40, cool: 0.00 }),
  Object.freeze({ id: 'meadow-alluvium', weight: 0.87, deposit: 0.36, wash: 0.17, film: 0.26, crust: 0.04, aggregate: 0.11, cool: 0.03 }),
  Object.freeze({ id: 'cool-peat-margin', weight: 0.68, deposit: 0.35, wash: 0.08, film: 0.33, crust: 0.01, aggregate: 0.05, cool: 0.19 }),
  Object.freeze({ id: 'mixed-rainfall-soil', weight: 0.80, deposit: 0.27, wash: 0.21, film: 0.15, crust: 0.10, aggregate: 0.18, cool: 0.05 }),
  Object.freeze({ id: 'colluvial-valley-edge', weight: 0.66, deposit: 0.24, wash: 0.30, film: 0.08, crust: 0.08, aggregate: 0.29, cool: 0.02 }),
  Object.freeze({ id: 'low-slope-sediment', weight: 0.73, deposit: 0.39, wash: 0.12, film: 0.29, crust: 0.05, aggregate: 0.09, cool: 0.04 }),
  Object.freeze({ id: 'high-runoff-soil', weight: 0.62, deposit: 0.16, wash: 0.40, film: 0.06, crust: 0.08, aggregate: 0.32, cool: 0.03 }),
  Object.freeze({ id: 'coastal-rainwash', weight: 0.67, deposit: 0.27, wash: 0.22, film: 0.23, crust: 0.04, aggregate: 0.14, cool: 0.10 }),
  Object.freeze({ id: 'granular-upland', weight: 0.54, deposit: 0.12, wash: 0.33, film: 0.03, crust: 0.13, aggregate: 0.43, cool: 0.01 }),
  Object.freeze({ id: 'wet-shoulder', weight: 0.75, deposit: 0.31, wash: 0.20, film: 0.28, crust: 0.03, aggregate: 0.10, cool: 0.08 }),
  Object.freeze({ id: 'dry-shoulder', weight: 0.61, deposit: 0.17, wash: 0.29, film: 0.04, crust: 0.20, aggregate: 0.28, cool: 0.01 }),
  Object.freeze({ id: 'mineral-rich-bench', weight: 0.57, deposit: 0.16, wash: 0.22, film: 0.05, crust: 0.19, aggregate: 0.41, cool: 0.00 }),
  Object.freeze({ id: 'shaded-basin-soil', weight: 0.70, deposit: 0.33, wash: 0.09, film: 0.35, crust: 0.02, aggregate: 0.08, cool: 0.17 }),
  Object.freeze({ id: 'open-plain-loam', weight: 0.85, deposit: 0.29, wash: 0.15, film: 0.18, crust: 0.09, aggregate: 0.15, cool: 0.02 }),
  Object.freeze({ id: 'coastal-marsh-soil', weight: 0.69, deposit: 0.39, wash: 0.06, film: 0.41, crust: 0.01, aggregate: 0.03, cool: 0.14 }),
  Object.freeze({ id: 'upland-clay', weight: 0.53, deposit: 0.23, wash: 0.32, film: 0.08, crust: 0.15, aggregate: 0.23, cool: 0.02 }),
  Object.freeze({ id: 'storm-scarred-ground', weight: 0.58, deposit: 0.18, wash: 0.41, film: 0.07, crust: 0.06, aggregate: 0.35, cool: 0.02 }),
  Object.freeze({ id: 'seasonally-wet-earth', weight: 0.79, deposit: 0.31, wash: 0.17, film: 0.33, crust: 0.06, aggregate: 0.11, cool: 0.08 }),
  Object.freeze({ id: 'seasonally-dry-earth', weight: 0.60, deposit: 0.18, wash: 0.28, film: 0.05, crust: 0.24, aggregate: 0.28, cool: 0.00 }),
  Object.freeze({ id: 'fine-fan-sediment', weight: 0.72, deposit: 0.43, wash: 0.20, film: 0.17, crust: 0.05, aggregate: 0.10, cool: 0.02 }),
  Object.freeze({ id: 'coarse-fan-sediment', weight: 0.59, deposit: 0.27, wash: 0.31, film: 0.08, crust: 0.07, aggregate: 0.36, cool: 0.01 }),
  Object.freeze({ id: 'cool-shaded-lowland', weight: 0.76, deposit: 0.30, wash: 0.12, film: 0.33, crust: 0.02, aggregate: 0.09, cool: 0.18 }),
  Object.freeze({ id: 'warm-exposed-lowland', weight: 0.64, deposit: 0.24, wash: 0.25, film: 0.08, crust: 0.21, aggregate: 0.23, cool: 0.00 })
]);

export function sedimentProfileAt(index) {
  const safe = Math.max(0, Math.min(TERRAIN_SEDIMENT_PROFILES.length - 1, Math.floor(index)));
  return TERRAIN_SEDIMENT_PROFILES[safe];
}

export function sedimentProfileIndex(field) {
  const scaled = Math.max(0, Math.min(0.999999, Number(field) || 0));
  const total = TERRAIN_SEDIMENT_PROFILES.reduce((sum, profile) => sum + profile.weight, 0);
  let cursor = scaled * total;
  for (let i = 0; i < TERRAIN_SEDIMENT_PROFILES.length; i += 1) {
    cursor -= TERRAIN_SEDIMENT_PROFILES[i].weight;
    if (cursor <= 0) return i;
  }
  return TERRAIN_SEDIMENT_PROFILES.length - 1;
}

export function sedimentProfileBlend(a, b, t) {
  const alpha = Math.max(0, Math.min(1, Number(t) || 0));
  const left = sedimentProfileAt(a);
  const right = sedimentProfileAt(b);
  return Object.freeze({
    deposit: left.deposit + (right.deposit - left.deposit) * alpha,
    wash: left.wash + (right.wash - left.wash) * alpha,
    film: left.film + (right.film - left.film) * alpha,
    crust: left.crust + (right.crust - left.crust) * alpha,
    aggregate: left.aggregate + (right.aggregate - left.aggregate) * alpha,
    cool: left.cool + (right.cool - left.cool) * alpha,
  });
}
