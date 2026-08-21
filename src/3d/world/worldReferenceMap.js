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
	source: 'owner-supplied-reference-image',
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

export const REFERENCE_RELIEF_CHAINS = Object.freeze([
	Object.freeze({ id: 'vale-chain', kind: 'mountain-chain', points: Object.freeze([[0.215, 0.390], [0.235, 0.435], [0.250, 0.485]]) }),
	// Corrected in run 363 against the source image itself, which run 361 finally committed. The
	// previous line ran [[0.125,0.630],[0.180,0.625],[0.240,0.620]]: its middle point sat south of the
	// range in Dorne's lowland and its eastern point was not on land at all — 0.240 is open water in the
	// Sea of Dorne, near Tyrosh. On the map the ridge runs south-west to north-east from about
	// (0.128,0.636) to (0.190,0.591), where it meets the coast. Corroborated by this chain's own
	// authored passes in `worldReferenceMountainRelief.js`, which were already centred near the real
	// ridge (0.145,0.610) rather than near the recorded points — they had been tuned to compensate.
	Object.freeze({ id: 'red-mountains', kind: 'mountain-chain', points: Object.freeze([[0.128, 0.636], [0.158, 0.604], [0.190, 0.591]]) }),
	Object.freeze({ id: 'bone-mountains', kind: 'mountain-chain', points: Object.freeze([[0.700, 0.385], [0.705, 0.500], [0.715, 0.650]]) }),
	Object.freeze({ id: 'eastern-chain', kind: 'mountain-chain', points: Object.freeze([[0.955, 0.680], [0.950, 0.800], [0.945, 0.910]]) }),

	// ---- ridges read off map.png itself (run 380) -------------------------------------------------
	//
	// **The four chains above were the entire mountain system of the world**, three points each, and the
	// owner's complaint followed directly from that: "tek büyük kocaman dağ yerine daha sivri ama sıra
	// dağ gruplarına önem ver". A one-kilometre chain under a 1.6 km-wide relief profile can only ever
	// be a single lump, however sharp its flanks are made. Westeros' whole mountain content was two
	// three-point polylines.
	//
	// These are not invented. `resimler/map.png` draws its mountains as hachured grey ridges; eroding
	// that grey (which drops the castle icons and the text labels, both of which are also grey) leaves
	// 13,769 pixels in 1,464 marks, and the twenty marks larger than 120 px are the ranges the
	// cartographer actually drew. Each one's points are the centroids of seven bins along its own
	// principal axis, so a polyline follows the mark's real spine rather than a straight line through
	// its ends. They are short — 200 to 750 m — because that is how long the drawn ridges are, and a
	// scatter of short ranges is what "sıra dağ grupları" means.
	//
	// Adding twenty chains costs almost nothing per height sample: `worldReferenceMountainRelief.js`
	// rejects a chain on its bounding box before touching its segments, so a point away from a ridge
	// still does twenty cheap comparisons and no distance maths.
	//
	// The numbering has gaps — 01, 06, 13, 15 and 18 are absent — because five of the twenty extracted
	// marks landed on water. `coastalReliefTaper` scales relief to a floor of 0.12 there, so a 328 m
	// profile produced 41 m and the mark was cartography (a label or an icon over sea) rather than a
	// drawn ridge. `checkMountainRanges.js` is what says so: it measures each chain's own peak relief
	// and fails any that clears under 40 m. A dead chain is not free — it reads in this list as though
	// that range exists, and costs a bounding-box test on every height sample forever — so they are
	// deleted rather than left in as decor. The ids are kept stable so the extraction can be re-run
	// against this list; do not renumber to close the gaps.
	Object.freeze({ id: 'map-ridge-02', kind: 'mountain-chain', points: Object.freeze([[0.4103, 0.7283], [0.4160, 0.7244], [0.4218, 0.7227], [0.4273, 0.7208], [0.4351, 0.7261], [0.4390, 0.7141], [0.4419, 0.7038]]) }),
	Object.freeze({ id: 'map-ridge-03', kind: 'mountain-chain', points: Object.freeze([[0.7645, 0.4434], [0.7682, 0.4506], [0.7733, 0.4529], [0.7775, 0.4571], [0.7812, 0.4637], [0.7866, 0.4666], [0.7898, 0.4709]]) }),
	Object.freeze({ id: 'map-ridge-04', kind: 'mountain-chain', points: Object.freeze([[0.9039, 0.8210], [0.9100, 0.8164], [0.9123, 0.8116], [0.9184, 0.8076], [0.9186, 0.8013], [0.9187, 0.7908], [0.9190, 0.7835]]) }),
	Object.freeze({ id: 'map-ridge-05', kind: 'mountain-chain', points: Object.freeze([[0.4487, 0.7613], [0.4483, 0.7559], [0.4488, 0.7517], [0.4517, 0.7487], [0.4539, 0.7446], [0.4524, 0.7390], [0.4536, 0.7355]]) }),
	Object.freeze({ id: 'map-ridge-07', kind: 'mountain-chain', points: Object.freeze([[0.9116, 0.8343], [0.9151, 0.8343], [0.9189, 0.8299], [0.9223, 0.8255], [0.9261, 0.8240], [0.9313, 0.8281], [0.9339, 0.8256]]) }),
	Object.freeze({ id: 'map-ridge-08', kind: 'mountain-chain', points: Object.freeze([[0.0946, 0.3048], [0.0947, 0.2991], [0.0960, 0.2951], [0.0959, 0.2898], [0.0972, 0.2855], [0.0980, 0.2804], [0.1001, 0.2769]]) }),
	Object.freeze({ id: 'map-ridge-09', kind: 'mountain-chain', points: Object.freeze([[0.7088, 0.4769], [0.7095, 0.4835], [0.7089, 0.4907], [0.7111, 0.4978], [0.7143, 0.5022], [0.7172, 0.5065], [0.7229, 0.5117]]) }),
	Object.freeze({ id: 'map-ridge-10', kind: 'mountain-chain', points: Object.freeze([[0.9468, 0.7664], [0.9450, 0.7729], [0.9458, 0.7779], [0.9479, 0.7816], [0.9489, 0.7874], [0.9515, 0.7908], [0.9523, 0.7965]]) }),
	Object.freeze({ id: 'map-ridge-11', kind: 'mountain-chain', points: Object.freeze([[0.2147, 0.2232], [0.2148, 0.2191], [0.2135, 0.2152], [0.2150, 0.2115], [0.2138, 0.2073], [0.2141, 0.2033], [0.2159, 0.1987]]) }),
	Object.freeze({ id: 'map-ridge-12', kind: 'mountain-chain', points: Object.freeze([[0.9319, 0.7779], [0.9312, 0.7844], [0.9310, 0.7887], [0.9304, 0.7945], [0.9299, 0.7997], [0.9316, 0.8044], [0.9344, 0.8110]]) }),
	Object.freeze({ id: 'map-ridge-14', kind: 'mountain-chain', points: Object.freeze([[0.6767, 0.6011], [0.6791, 0.6049], [0.6813, 0.6095], [0.6838, 0.6135], [0.6872, 0.6161], [0.6901, 0.6201], [0.6931, 0.6228]]) }),
	Object.freeze({ id: 'map-ridge-16', kind: 'mountain-chain', points: Object.freeze([[0.1736, 0.2022], [0.1766, 0.2032], [0.1784, 0.1986], [0.1803, 0.1945], [0.1832, 0.1936], [0.1854, 0.1915], [0.1905, 0.1979]]) }),
	Object.freeze({ id: 'map-ridge-17', kind: 'mountain-chain', points: Object.freeze([[0.1994, 0.1851], [0.2024, 0.1843], [0.2048, 0.1857], [0.2072, 0.1921], [0.2097, 0.1918], [0.2129, 0.1866], [0.2153, 0.1867]]) }),
	Object.freeze({ id: 'map-ridge-19', kind: 'mountain-chain', points: Object.freeze([[0.1065, 0.2152], [0.1090, 0.2182], [0.1110, 0.2220], [0.1131, 0.2257], [0.1158, 0.2299], [0.1183, 0.2327], [0.1195, 0.2374]]) }),
	Object.freeze({ id: 'map-ridge-20', kind: 'mountain-chain', points: Object.freeze([[0.7156, 0.4597], [0.7148, 0.4547], [0.7124, 0.4508], [0.7108, 0.4456], [0.7151, 0.4415], [0.7155, 0.4369], [0.7143, 0.4316]]) }),
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
