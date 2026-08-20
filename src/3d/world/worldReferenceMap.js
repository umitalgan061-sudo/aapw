/**
 * Canonical 2D->3D geography contract for the owner-supplied world map.
 *
 * Coordinates are normalized image-space values in [0,1], where x grows left->right and y grows
 * top->bottom. Runtime terrain systems can project these controls into world X/Z without coupling
 * the canonical map to a particular chunk size or renderer. The source image is intentionally kept
 * as a reference asset; these controls are deterministic hand-audited anchors, not runtime OCR.
 *
 * Additive-only foundation: this module does not alter current terrain, roads, water, settlements,
 * 2D mode, or PWA behavior by itself. Follow-up terrain/biome passes must consume this contract.
 * @module world/worldReferenceMap
 */

export const WORLD_REFERENCE_MAP = Object.freeze({
	id: 'owner-world-map-2026-08-08',
	source: 'map.png/map.png',
	sha256: '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1',
	pixelWidth: 1536,
	pixelHeight: 1024,
	orientation: Object.freeze({ x: 'west-to-east', y: 'north-to-south' }),
});

export const REFERENCE_BIOME_ZONES = Object.freeze([
	Object.freeze({ id: 'lands-always-winter', kind: 'snow', center: [0.145, 0.115], radius: [0.09, 0.12], elevationBias: 0.62 }),
	Object.freeze({ id: 'north', kind: 'cold-grassland', center: [0.175, 0.285], radius: [0.10, 0.16], elevationBias: 0.18 }),
	Object.freeze({ id: 'neck', kind: 'marsh', center: [0.185, 0.445], radius: [0.055, 0.055], elevationBias: -0.18 }),
	Object.freeze({ id: 'vale-mountains', kind: 'mountain', center: [0.245, 0.445], radius: [0.065, 0.085], elevationBias: 0.82 }),
	Object.freeze({ id: 'westerlands', kind: 'rocky-hills', center: [0.135, 0.505], radius: [0.065, 0.11], elevationBias: 0.48 }),
	Object.freeze({ id: 'reach', kind: 'lush-grassland', center: [0.155, 0.585], radius: [0.095, 0.10], elevationBias: 0.04 }),
	Object.freeze({ id: 'dorne', kind: 'desert', center: [0.180, 0.665], radius: [0.105, 0.065], elevationBias: 0.08 }),
	Object.freeze({ id: 'dorne-mountains', kind: 'mountain', center: [0.225, 0.625], radius: [0.080, 0.045], elevationBias: 0.70 }),
	Object.freeze({ id: 'braavos-coast', kind: 'temperate-coast', center: [0.330, 0.455], radius: [0.070, 0.105], elevationBias: 0.02 }),
	Object.freeze({ id: 'dothraki-sea', kind: 'steppe', center: [0.545, 0.535], radius: [0.215, 0.145], elevationBias: 0.00 }),
	Object.freeze({ id: 'bone-mountains', kind: 'mountain', center: [0.700, 0.530], radius: [0.065, 0.180], elevationBias: 0.95 }),
	Object.freeze({ id: 'red-waste', kind: 'desert', center: [0.660, 0.680], radius: [0.105, 0.095], elevationBias: 0.12 }),
	Object.freeze({ id: 'yi-ti', kind: 'lush-grassland', center: [0.790, 0.705], radius: [0.115, 0.120], elevationBias: 0.04 }),
	Object.freeze({ id: 'jogos-nhai', kind: 'steppe', center: [0.825, 0.555], radius: [0.165, 0.105], elevationBias: 0.03 }),
	Object.freeze({ id: 'grey-waste', kind: 'arid', center: [0.925, 0.555], radius: [0.080, 0.095], elevationBias: 0.10 }),
	Object.freeze({ id: 'sothoryos', kind: 'jungle', center: [0.555, 0.900], radius: [0.165, 0.100], elevationBias: 0.14 }),
	Object.freeze({ id: 'ulthos', kind: 'jungle', center: [0.925, 0.945], radius: [0.090, 0.050], elevationBias: 0.18 }),
]);

export const REFERENCE_WATER_ZONES = Object.freeze([
	Object.freeze({ id: 'sunset-sea', kind: 'ocean', center: [0.055, 0.690], radius: [0.080, 0.250] }),
	Object.freeze({ id: 'narrow-sea', kind: 'sea', center: [0.285, 0.495], radius: [0.045, 0.205] }),
	Object.freeze({ id: 'shivering-sea-west', kind: 'sea', center: [0.475, 0.230], radius: [0.225, 0.115] }),
	Object.freeze({ id: 'shivering-sea-east', kind: 'sea', center: [0.805, 0.295], radius: [0.200, 0.105] }),
	Object.freeze({ id: 'summer-sea', kind: 'sea', center: [0.535, 0.835], radius: [0.235, 0.090] }),
]);

// Polyline controls hand-traced from the exact `map.png/map.png` owner reference. The first four
// chains are the historical live controls; the later three fill obvious painted relief that the
// earlier coarse contract omitted (Frostfangs, the long central/southern Essos ridge and Jogos Nhai's
// isolated north-south spine).
export const REFERENCE_RELIEF_CHAINS = Object.freeze([
	Object.freeze({ id: 'vale-chain', kind: 'mountain-chain', points: Object.freeze([[0.205, 0.370], [0.220, 0.405], [0.238, 0.440], [0.250, 0.485]]) }),
	Object.freeze({ id: 'red-mountains', kind: 'mountain-chain', points: Object.freeze([[0.115, 0.615], [0.150, 0.625], [0.190, 0.625], [0.240, 0.620]]) }),
	Object.freeze({ id: 'bone-mountains', kind: 'mountain-chain', points: Object.freeze([[0.690, 0.385], [0.700, 0.455], [0.705, 0.525], [0.710, 0.595], [0.715, 0.665]]) }),
	Object.freeze({ id: 'eastern-chain', kind: 'mountain-chain', points: Object.freeze([[0.955, 0.680], [0.950, 0.760], [0.948, 0.840], [0.945, 0.915]]) }),
	Object.freeze({ id: 'frostfangs', kind: 'mountain-chain', points: Object.freeze([[0.145, 0.060], [0.153, 0.095], [0.162, 0.130], [0.175, 0.170]]) }),
	Object.freeze({ id: 'painted-mountains', kind: 'mountain-chain', points: Object.freeze([[0.355, 0.605], [0.405, 0.610], [0.455, 0.610], [0.510, 0.605], [0.555, 0.600]]) }),
	Object.freeze({ id: 'jogos-spine', kind: 'mountain-chain', points: Object.freeze([[0.895, 0.505], [0.890, 0.545], [0.892, 0.585], [0.895, 0.625]]) }),
]);

export function normalizedMapToWorldXZ(normalizedX, normalizedY, mapBounds, metersPerMapUnit) {
	if (!Number.isFinite(normalizedX) || !Number.isFinite(normalizedY)) throw new TypeError('normalized coordinates must be finite');
	if (normalizedX < 0 || normalizedX > 1 || normalizedY < 0 || normalizedY > 1) throw new RangeError('normalized coordinates must be in [0,1]');
	const widthMapUnits = mapBounds.maxX - mapBounds.minX;
	const heightMapUnits = mapBounds.maxY - mapBounds.minY;
	const mapX = mapBounds.minX + normalizedX * widthMapUnits;
	const mapY = mapBounds.minY + normalizedY * heightMapUnits;
	return Object.freeze({
		x: (mapX - (mapBounds.minX + mapBounds.maxX) * 0.5) * metersPerMapUnit,
		z: (mapY - (mapBounds.minY + mapBounds.maxY) * 0.5) * metersPerMapUnit,
	});
}

export function sampleReferenceInfluence(normalizedX, normalizedY, zone) {
	const dx = (normalizedX - zone.center[0]) / zone.radius[0];
	const dy = (normalizedY - zone.center[1]) / zone.radius[1];
	const distanceSquared = dx * dx + dy * dy;
	if (distanceSquared >= 1) return 0;
	const t = 1 - Math.sqrt(distanceSquared);
	return t * t * (3 - 2 * t);
}
