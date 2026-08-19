#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
	REFERENCE_BIOME_ZONES,
	REFERENCE_RELIEF_CHAINS,
	WORLD_REFERENCE_MAP,
	sampleReferenceInfluence,
} from '../src/3d/world/worldReferenceMap.js';
import {
	WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY,
	sampleNormalizedReferenceMountainReliefMeters,
	sampleReferenceDryLandWeight,
} from '../src/3d/world/worldReferenceMountainRelief.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(ROOT, 'src/3d/world/worldReferenceMountainRelief.js'), 'utf8');
const MAP_ASPECT = WORLD_REFERENCE_MAP.pixelWidth / WORLD_REFERENCE_MAP.pixelHeight;
const EPSILON = 1e-9;
const rounded = (value, digits = 6) => Number(value.toFixed(digits));

const widthPolicy = WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY.shoulderWidthVariation;
const coastalPolicy = WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY.coastalReliefTaper;
const talusPolicy = WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY.talusBreakup;
const ridgePolicy = WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY.ridgeNaturalization;
const highlandPolicy = WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY.highlands;
const seatPolicy = WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY.habitableSeatProtection;
assert(widthPolicy, 'shoulder-width variation policy is missing');
assert(coastalPolicy, 'coastal relief taper policy is missing');
assert(talusPolicy, 'talus-breakup policy is missing');
assert(ridgePolicy, 'multi-ridge naturalization policy is missing');
assert(highlandPolicy, 'map-supported highland policy is missing');
assert(seatPolicy, 'habitable-seat relief protection is missing');
assert(widthPolicy.minimumScale >= 0.80, 'minimum shoulder scale would pinch canonical ranges too aggressively');
assert(widthPolicy.maximumScale <= 1.70, 'maximum shoulder scale would over-grow canonical ranges');
assert(widthPolicy.maximumScale - widthPolicy.minimumScale >= 0.45, 'shoulder-width envelope is too uniform to naturalize long ridges');
assert(widthPolicy.broadFrequency > 0 && widthPolicy.detailFrequency > widthPolicy.broadFrequency, 'shoulder width needs broad + detail spatial scales');
assert(coastalPolicy.radiusNormalized >= 0.020 && coastalPolicy.radiusNormalized <= 0.035, 'coastal/lake relief taper is not long enough to prevent mask-edge walls');
assert(coastalPolicy.minimumScale >= 0.005 && coastalPolicy.minimumScale <= 0.05, 'water-edge relief floor must approach foothill scale');
assert(talusPolicy.strength > 0.08 && talusPolicy.strength <= 0.22, 'talus breakup must be visible but bounded');
assert(talusPolicy.shoulderStart >= 0.1 && talusPolicy.shoulderStart < talusPolicy.shoulderEnd, 'talus shoulder envelope start drifted');
assert(talusPolicy.shoulderEnd <= 0.95, 'talus breakup must fade before the canonical outer boundary');
assert(ridgePolicy.primarySharpness >= 1.15 && ridgePolicy.primarySharpness <= 1.6, 'primary ridge sharpness is not realistic/bounded');
assert(ridgePolicy.secondaryStrength >= 0.18 && ridgePolicy.secondaryStrength <= 0.40, 'secondary ridge is either invisible or dominant');
assert(ridgePolicy.outerRidgeStrength > 0 && ridgePolicy.outerRidgeStrength < ridgePolicy.secondaryStrength, 'outer ridge must remain weaker than secondary ridge');
assert(ridgePolicy.valleyStrength >= 0.20 && ridgePolicy.valleyStrength <= 0.45, 'drainage valley cuts are not bounded');
assert(ridgePolicy.crestDetailFrequency > 25, 'crest breakup is too broad to separate individual summits');
assert.deepEqual(Object.keys(highlandPolicy).sort(), ['lands-always-winter', 'north', 'westerlands'], 'highland coverage expanded beyond map-supported elevated regions');
assert(seatPolicy.innerRadiusNormalized > 0 && seatPolicy.outerRadiusNormalized > seatPolicy.innerRadiusNormalized, 'habitable seat protection radii are invalid');
assert(seatPolicy.minimumMultiplier >= 0.10 && seatPolicy.minimumMultiplier <= 0.40, 'capital basin relief floor drifted');
for (const chainId of ['bone-mountains', 'eastern-chain']) {
	const p = WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY.chains[chainId]?.longitudinalMassifs;
	assert(p, `${chainId}: longitudinal massif policy missing`);
	assert(p.saddleFloor >= 0.08 && p.saddleFloor <= 0.18, `${chainId}: saddle floor would disconnect or re-form a tube`);
	assert(p.anchorWidth >= 0.045 && p.anchorWidth <= 0.08, `${chainId}: anchor massif width drifted`);
	assert(p.segmentWidth >= 0.05 && p.segmentWidth <= 0.09, `${chainId}: segment massif width drifted`);
	assert(p.endpointStrength >= 0.4 && p.endpointStrength <= 0.65, `${chainId}: chain ends are not tapered`);
}
assert(!WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY.chains['vale-chain'].longitudinalMassifs, 'Vale pass geometry must not inherit long-chain massif gating');
assert(!WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY.chains['red-mountains'].longitudinalMassifs, 'Red Mountains pass geometry must not inherit long-chain massif gating');
assert(source.includes('sampleShoulderWidthScale(normalizedX, normalizedY, chain.profile.seed)'), 'runtime relief no longer consumes shoulder-width variation');
assert(source.includes('Math.cos(normalizedDistance * Math.PI * 0.5)'), 'runtime ridge cross-section returned to a flat core plateau');
assert(source.includes('sampleCoastalReliefScale(normalizedX, normalizedY, dryLandWeight)'), 'runtime relief no longer tapers source-adjacent coastal cliffs');
assert(source.includes('pointSegmentProjection(px, py'), 'runtime no longer derives an axial chain projection');
assert(source.includes('sampleLongitudinalMassifEnvelope(chain, axialProgress'), 'runtime no longer breaks long chains into massifs and saddles');
assert(source.includes('sampleTalusBreakup(normalizedX, normalizedY, normalizedDistance, chain.profile.seed)'), 'runtime relief no longer consumes talus breakup');
assert(source.includes('sampleNaturalizedRidgeShape(normalizedX, normalizedY, normalizedDistance, coreRatio, chain.profile.seed)'), 'runtime relief no longer builds primary/secondary ridge morphology');
assert(source.includes('sampleMappedHighlandMeters(normalizedX, normalizedY)'), 'runtime relief no longer consumes map-supported highlands');
assert(source.includes('sampleHabitableSeatMultiplier(normalizedX, normalizedY)'), 'runtime relief no longer protects kingdom-seat basins');
assert(source.includes('profile.outerWidthNormalized * maximumWidthScale'), 'broad-phase bounds do not cover widened shoulders');

const highlandZones = Object.entries(highlandPolicy).map(([zoneId, profile]) => {
	const zone = REFERENCE_BIOME_ZONES.find((candidate) => candidate.id === zoneId);
	assert(zone, `${zoneId}: canonical biome anchor missing`);
	return { zoneId, zone, profile };
});
function isMappedHighland(normalizedX, normalizedY) {
	return highlandZones.some(({ zone, profile }) => sampleReferenceInfluence(normalizedX, normalizedY, zone) > profile.minimumInfluence);
}
function aspectPoint(point) {
	return { x: point[0] * MAP_ASPECT, y: point[1] };
}
function normalizedFromAspect(x, y) {
	return { x: x / MAP_ASPECT, y };
}
function candidateAt(chain, segmentIndex, t) {
	const a = aspectPoint(chain.points[segmentIndex]);
	const b = aspectPoint(chain.points[segmentIndex + 1]);
	const x = a.x + (b.x - a.x) * t;
	const y = a.y + (b.y - a.y) * t;
	const normalized = normalizedFromAspect(x, y);
	if (normalized.x < 0 || normalized.x > 1 || normalized.y < 0 || normalized.y > 1) return null;
	const length = Math.hypot(b.x - a.x, b.y - a.y);
	if (length <= EPSILON) return null;
	return {
		segmentIndex,
		t,
		x,
		y,
		dry: sampleReferenceDryLandWeight(normalized.x, normalized.y),
		height: sampleNormalizedReferenceMountainReliefMeters(normalized.x, normalized.y),
		nx: -(b.y - a.y) / length,
		ny: (b.x - a.x) / length,
	};
}
function strongestDryCenterlinePoint(chain) {
	let best = null;
	for (let segmentIndex = 0; segmentIndex < chain.points.length - 1; segmentIndex += 1) {
		for (const t of [0.18, 0.32, 0.46, 0.60, 0.74, 0.86]) {
			const candidate = candidateAt(chain, segmentIndex, t);
			if (!candidate || candidate.dry < WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY.landGateFull) continue;
			if (!best || candidate.height > best.height) best = candidate;
		}
	}
	return best;
}
function sampleOffset(center, distance, sign) {
	const normalized = normalizedFromAspect(center.x + center.nx * distance * sign, center.y + center.ny * distance * sign);
	if (normalized.x < 0 || normalized.x > 1 || normalized.y < 0 || normalized.y > 1) {
		return { inBounds: false, height: 0, dry: 0, normalizedX: normalized.x, normalizedY: normalized.y };
	}
	return {
		inBounds: true,
		normalizedX: normalized.x,
		normalizedY: normalized.y,
		height: sampleNormalizedReferenceMountainReliefMeters(normalized.x, normalized.y),
		dry: sampleReferenceDryLandWeight(normalized.x, normalized.y),
	};
}
function lateralProfile(center, profile) {
	const safeWidth = profile.outerWidthNormalized * widthPolicy.minimumScale;
	const maximumWidth = profile.outerWidthNormalized * widthPolicy.maximumScale;
	const rows = [0.22, 0.48, 0.74, 0.96].map((fraction) => {
		const distance = safeWidth * fraction;
		const left = sampleOffset(center, distance, -1);
		const right = sampleOffset(center, distance, 1);
		return { fraction, distance, left, right, bestHeight: Math.max(left.height, right.height) };
	});
	return {
		rows,
		outside: [sampleOffset(center, maximumWidth * 1.15, -1), sampleOffset(center, maximumWidth * 1.15, 1)],
		safeWidth,
		maximumWidth,
	};
}
function centerlineSeries(chain, stepsPerSegment = 120) {
	const rows = [];
	for (let segmentIndex = 0; segmentIndex < chain.points.length - 1; segmentIndex += 1) {
		for (let step = segmentIndex === 0 ? 0 : 1; step <= stepsPerSegment; step += 1) {
			const candidate = candidateAt(chain, segmentIndex, step / stepsPerSegment);
			if (candidate?.dry >= WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY.landGateFull) rows.push(candidate.height);
		}
	}
	return rows;
}
function countRuns(values, predicate) {
	let runs = 0;
	let active = false;
	for (const value of values) {
		if (predicate(value)) {
			if (!active) runs += 1;
			active = true;
		} else active = false;
	}
	return runs;
}

const evidence = {};
for (const chain of REFERENCE_RELIEF_CHAINS) {
	const profile = WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY.chains[chain.id];
	assert(profile, `${chain.id}: missing runtime mountain profile`);
	const center = strongestDryCenterlinePoint(chain);
	assert(center, `${chain.id}: no dry source-owned centerline candidate found`);
	assert(center.height > 20, `${chain.id}: selected centerline relief is not visibly elevated`);
	const lateral = lateralProfile(center, profile);
	assert(lateral.rows[0].bestHeight > 1, `${chain.id}: inner shoulder vanished beside its strongest dry ridge point`);
	assert(lateral.rows.some((row, index) => index > 0 && row.bestHeight < lateral.rows[0].bestHeight * 0.92), `${chain.id}: shoulder profile is suspiciously flat laterally`);
	for (const sample of lateral.outside) {
		if (!sample.inBounds || sample.dry <= WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY.landGateZero) continue;
		if (isMappedHighland(sample.normalizedX, sample.normalizedY)) continue;
		assert(sample.height <= center.height * 0.08 + 2, `${chain.id}: mountain relief extends materially beyond declared maximum shoulder`);
	}
	for (const row of lateral.rows) {
		for (const side of [row.left, row.right]) {
			assert(Number.isFinite(side.height) && side.height >= 0, `${chain.id}: non-finite/negative lateral relief sample`);
			if (side.dry <= WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY.landGateZero) assert(side.height === 0, `${chain.id}: lateral shoulder leaked into source-owned water`);
		}
	}
	evidence[chain.id] = {
		centerHeightMeters: rounded(center.height),
		centerDryWeight: rounded(center.dry),
		safeWidthNormalized: rounded(lateral.safeWidth),
		maximumWidthNormalized: rounded(lateral.maximumWidth),
		lateralHeightsMeters: lateral.rows.map((row) => rounded(row.bestHeight)),
	};
}

const longitudinalEvidence = {};
for (const chainId of ['bone-mountains', 'eastern-chain']) {
	const chain = REFERENCE_RELIEF_CHAINS.find((candidate) => candidate.id === chainId);
	const series = centerlineSeries(chain);
	assert(series.length > 150, `${chainId}: insufficient dry centerline evidence`);
	const peak = Math.max(...series);
	const over100Ratio = series.filter((height) => height > 100).length / series.length;
	const lowRatio = series.filter((height) => height < peak * 0.30).length / series.length;
	const highRuns = countRuns(series, (height) => height > peak * 0.55);
	assert(peak > (chainId === 'bone-mountains' ? 500 : 350), `${chainId}: massif peaks lost required relief`);
	assert(over100Ratio < 0.88, `${chainId}: >100m relief remains too continuous and still risks a stadium/tube silhouette`);
	assert(lowRatio >= 0.08, `${chainId}: no meaningful low saddles separate major massifs`);
	assert(highRuns >= 3, `${chainId}: long chain does not resolve into at least three high massif groups`);
	longitudinalEvidence[chainId] = { peakMeters: rounded(peak), over100Ratio: rounded(over100Ratio, 4), lowRatio: rounded(lowRatio, 4), highRuns, samples: series.length };
}

const highlandEvidence = {};
for (const { zoneId, zone } of highlandZones) {
	const dry = sampleReferenceDryLandWeight(zone.center[0], zone.center[1]);
	const relief = sampleNormalizedReferenceMountainReliefMeters(zone.center[0], zone.center[1]);
	assert(dry > WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY.landGateZero, `${zoneId}: highland center is not source-owned land`);
	assert(relief >= 8, `${zoneId}: map-supported highland has no visible elevation`);
	highlandEvidence[zoneId] = { dryWeight: rounded(dry), reliefMeters: rounded(relief) };
}
const plainEvidence = {};
for (const zoneId of ['braavos-coast', 'dothraki-sea', 'yi-ti', 'grey-waste']) {
	const zone = REFERENCE_BIOME_ZONES.find((candidate) => candidate.id === zoneId);
	assert(zone, `${zoneId}: canonical lowland/plain anchor missing`);
	const dry = sampleReferenceDryLandWeight(zone.center[0], zone.center[1]);
	const relief = sampleNormalizedReferenceMountainReliefMeters(zone.center[0], zone.center[1]);
	if (dry >= WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY.landGateFull) {
		assert(relief <= 3, `${zoneId}: broad plain/settlement region was promoted into mountain/highland relief (${relief.toFixed(2)}m)`);
	}
	plainEvidence[zoneId] = { dryWeight: rounded(dry), reliefMeters: rounded(relief) };
}

const drySamples = [];
let zeroReliefDrySamples = 0;
for (let y = 0; y <= 192; y += 1) {
	for (let x = 0; x <= 256; x += 1) {
		const nx = x / 256;
		const ny = y / 192;
		const dry = sampleReferenceDryLandWeight(nx, ny);
		const relief = sampleNormalizedReferenceMountainReliefMeters(nx, ny);
		assert(Number.isFinite(relief) && relief >= 0, `grid sample ${x}/${y} returned invalid relief`);
		if (dry <= WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY.landGateZero) assert(relief === 0, `grid sample ${x}/${y} leaked relief into water`);
		if (dry >= WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY.landGateFull) {
			if (relief > 0) drySamples.push(relief);
			else zeroReliefDrySamples += 1;
		}
	}
}
assert(drySamples.length > 80, 'naturalized mountain/highland field has implausibly little dry-land relief coverage');
assert(Math.max(...drySamples) > 600, 'naturalized dry-land relief lacks the stronger major peaks requested by visual QA');
assert(zeroReliefDrySamples > drySamples.length * 1.4, 'too much source-owned dry land received mountain/highland relief; habitable plains are no longer dominant');

console.log('MOUNTAIN_NATURALIZATION_PROFILE_OK', JSON.stringify({
	policyId: WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY.id,
	widthScale: [widthPolicy.minimumScale, widthPolicy.maximumScale],
	coastalReliefTaper: coastalPolicy,
	talusStrength: talusPolicy.strength,
	ridgeNaturalization: ridgePolicy,
	dryReliefSamples: drySamples.length,
	zeroReliefDrySamples,
	highlandEvidence,
	plainEvidence,
	longitudinalEvidence,
	evidence,
}));