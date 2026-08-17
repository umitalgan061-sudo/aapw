#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { REFERENCE_RELIEF_CHAINS, WORLD_REFERENCE_MAP } from '../src/3d/world/worldReferenceMap.js';
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
assert(widthPolicy, 'shoulder-width variation policy is missing');
assert(coastalPolicy, 'coastal relief taper policy is missing');
assert(talusPolicy, 'talus-breakup policy is missing');
assert(widthPolicy.minimumScale >= 0.80, 'minimum shoulder scale would pinch canonical ranges too aggressively');
assert(widthPolicy.maximumScale <= 1.70, 'maximum shoulder scale would over-grow canonical ranges');
assert(widthPolicy.maximumScale - widthPolicy.minimumScale >= 0.45, 'shoulder-width envelope is too uniform to naturalize long ridges');
assert(widthPolicy.broadFrequency > 0 && widthPolicy.detailFrequency > widthPolicy.broadFrequency, 'shoulder width needs broad + detail spatial scales');
assert(coastalPolicy.radiusNormalized >= 0.008 && coastalPolicy.radiusNormalized <= 0.018, 'coastal relief taper radius drifted');
assert(coastalPolicy.minimumScale >= 0.08 && coastalPolicy.minimumScale <= 0.20, 'coastal relief minimum is not bounded');
assert(talusPolicy.strength > 0.08 && talusPolicy.strength <= 0.22, 'talus breakup must be visible but bounded');
assert(talusPolicy.shoulderStart >= 0.1 && talusPolicy.shoulderStart < talusPolicy.shoulderEnd, 'talus shoulder envelope start drifted');
assert(talusPolicy.shoulderEnd <= 0.95, 'talus breakup must fade before the canonical outer boundary');
assert(source.includes('sampleShoulderWidthScale(normalizedX, normalizedY, chain.profile.seed)'), 'runtime relief no longer consumes shoulder-width variation');
assert(source.includes('Math.cos(normalizedDistance * Math.PI * 0.5)'), 'runtime ridge cross-section returned to a flat core plateau');
assert(source.includes('sampleCoastalReliefScale(normalizedX, normalizedY, dryLandWeight)'), 'runtime relief no longer tapers source-adjacent coastal cliffs');
assert(source.includes('sampleTalusBreakup(normalizedX, normalizedY, normalizedDistance, chain.profile.seed)'), 'runtime relief no longer consumes talus breakup');
assert(source.includes('profile.outerWidthNormalized * maximumWidthScale'), 'broad-phase bounds do not cover widened shoulders');

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
	const dry = sampleReferenceDryLandWeight(normalized.x, normalized.y);
	const height = sampleNormalizedReferenceMountainReliefMeters(normalized.x, normalized.y);
	const length = Math.hypot(b.x - a.x, b.y - a.y);
	if (length <= EPSILON) return null;
	return {
		segmentIndex,
		t,
		x,
		y,
		dry,
		height,
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
	const aspectX = center.x + center.nx * distance * sign;
	const y = center.y + center.ny * distance * sign;
	const normalized = normalizedFromAspect(aspectX, y);
	if (normalized.x < 0 || normalized.x > 1 || normalized.y < 0 || normalized.y > 1) {
		return { inBounds: false, height: 0, dry: 0 };
	}
	return {
		inBounds: true,
		height: sampleNormalizedReferenceMountainReliefMeters(normalized.x, normalized.y),
		dry: sampleReferenceDryLandWeight(normalized.x, normalized.y),
	};
}

function lateralProfile(chain, center, profile) {
	const safeWidth = profile.outerWidthNormalized * widthPolicy.minimumScale;
	const maximumWidth = profile.outerWidthNormalized * widthPolicy.maximumScale;
	const fractions = [0.22, 0.48, 0.74, 0.96];
	const rows = fractions.map((fraction) => {
		const distance = safeWidth * fraction;
		const left = sampleOffset(center, distance, -1);
		const right = sampleOffset(center, distance, 1);
		return {
			fraction,
			distance,
			left,
			right,
			bestHeight: Math.max(left.height, right.height),
		};
	});
	const outside = [
		sampleOffset(center, maximumWidth * 1.15, -1),
		sampleOffset(center, maximumWidth * 1.15, 1),
	];
	return { rows, outside, safeWidth, maximumWidth };
}

const evidence = {};
for (const chain of REFERENCE_RELIEF_CHAINS) {
	const profile = WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY.chains[chain.id];
	assert(profile, `${chain.id}: missing runtime mountain profile`);
	const center = strongestDryCenterlinePoint(chain);
	assert(center, `${chain.id}: no dry source-owned centerline candidate found`);
	assert(center.height > 20, `${chain.id}: selected centerline relief is not visibly elevated`);
	const lateral = lateralProfile(chain, center, profile);
	assert(lateral.rows[0].bestHeight > 1, `${chain.id}: inner shoulder vanished beside its strongest dry ridge point`);
	assert(lateral.rows.some((row, index) => index > 0 && row.bestHeight < lateral.rows[0].bestHeight * 0.92), `${chain.id}: shoulder profile is suspiciously flat laterally`);
	for (const sample of lateral.outside) {
		if (!sample.inBounds || sample.dry <= WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY.landGateZero) continue;
		assert(sample.height <= center.height * 0.08 + 2, `${chain.id}: mountain relief extends materially beyond declared maximum shoulder`);
	}
	for (const row of lateral.rows) {
		for (const side of [row.left, row.right]) {
			assert(Number.isFinite(side.height) && side.height >= 0, `${chain.id}: non-finite/negative lateral relief sample`);
			if (side.dry <= WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY.landGateZero) {
				assert(side.height === 0, `${chain.id}: lateral shoulder leaked into source-owned water`);
			}
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

const drySamples = [];
for (let y = 0; y <= 48; y += 1) {
	for (let x = 0; x <= 64; x += 1) {
		const nx = x / 64;
		const ny = y / 48;
		const dry = sampleReferenceDryLandWeight(nx, ny);
		const relief = sampleNormalizedReferenceMountainReliefMeters(nx, ny);
		assert(Number.isFinite(relief) && relief >= 0, `grid sample ${x}/${y} returned invalid relief`);
		if (dry <= WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY.landGateZero) assert(relief === 0, `grid sample ${x}/${y} leaked relief into water`);
		if (dry >= WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY.landGateFull && relief > 0) drySamples.push(relief);
	}
}
assert(drySamples.length > 80, 'naturalized mountain field has implausibly little dry-land relief coverage');
assert(Math.max(...drySamples) > 450, 'naturalized dry-land relief lacks a major peak');

console.log('MOUNTAIN_NATURALIZATION_PROFILE_OK', JSON.stringify({
	policyId: WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY.id,
	widthScale: [widthPolicy.minimumScale, widthPolicy.maximumScale],
	coastalReliefTaper: coastalPolicy,
	talusStrength: talusPolicy.strength,
	dryReliefSamples: drySamples.length,
	evidence,
}));
