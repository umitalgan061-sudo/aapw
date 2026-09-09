/**
 * Lightweight QA telemetry for biome-driven asset distribution.
 *
 * This module records only deterministic summary data. It deliberately does not keep render objects,
 * browser state, player state, or mutable geometry. The purpose is to make visual-world regressions
 * measurable in CI: profile coverage, asset-family diversity, density direction, and exclusion health.
 *
 * @module world/biomeAssetDistributionTelemetry
 */

import { REFERENCE_BIOME_ZONES } from './worldReferenceMap.js';
import { BIOME_ASSET_PROFILES, resolveBiomeAssetDistribution } from './biomeAssetDistribution.js';

const VERSION = '2026-09-07-v1';

function round(value, digits = 4) {
	const factor = 10 ** digits;
	return Math.round((Number(value) || 0) * factor) / factor;
}

function freezeRows(rows) {
	return Object.freeze(rows.map((row) => Object.freeze({ ...row })));
}

export const BIOME_DISTRIBUTION_TELEMETRY_POLICY = Object.freeze({
	id: `biome-distribution-telemetry-${VERSION}`,
	version: VERSION,
	deterministic: true,
	storesGeometry: false,
	storesGameplay: false,
	storesBrowserState: false,
	zoneSampleCount: 17,
});

export function collectBiomeDistributionSnapshot({ seed = 'qa', sampleCount = 8 } = {}) {
	const rows = [];
	for (const zone of REFERENCE_BIOME_ZONES) {
		const context = resolveBiomeAssetDistribution(zone.center[0], zone.center[1], seed, { sampleCount });
		rows.push({
			zoneId: zone.id,
			requestedKind: zone.kind,
			profileId: context.profileId,
			confidence: round(context.confidence),
			densityMultiplier: round(context.densityMultiplier),
			waterSignal: round(context.water.signal),
			reliefSignal: round(context.relieif?.signal || context.relief?.signal || 0),
			primaryLandCover: context.landCover.primary,
			primaryScatterFamily: context.scatter[0]?.family || null,
			primaryGeologyFamily: context.geology?.family || null,
			architectureAsset: context.architecture?.asset || null,
		});
	}
	return Object.freeze({
		policyId: BIOME_DISTRIBUTION_TELEMETRY_POLICY.id,
		version: VERSION,
		seed,
		zoneCount: rows.length,
		rows: freezeRows(rows),
	});
}

export function compareSnapshots(first, second) {
	if (!first || !second) throw new TypeError('two snapshots are required');
	const firstMap = new Map((first.rows || []).map((row) => [row.zoneId, row]));
	const secondMap = new Map((second.rows || []).map((row) => [row.zoneId, row]));
	const differences = [];
	for (const zoneId of new Set([...firstMap.keys(), ...secondMap.keys()])) {
		const left = firstMap.get(zoneId);
		const right = secondMap.get(zoneId);
		if (!left || !right) {
			differences.push({ zoneId, reason: 'zone-presence-changed' });
			continue;
		}
		for (const field of ['profileId', 'primaryLandCover', 'primaryScatterFamily', 'primaryGeologyFamily', 'architectureAsset']) {
			if (left[field] !== right[field]) differences.push({ zoneId, field, left: left[field], right: right[field] });
		}
		for (const field of ['confidence', 'densityMultiplier', 'waterSignal', 'reliefSignal']) {
			if (left[field] !== right[field]) differences.push({ zoneId, field, left: left[field], right: right[field] });
		}
	}
	return Object.freeze({ identical: differences.length === 0, differences: freezeRows(differences) });
}

export function profileCoverageSnapshot() {
	const coverage = Object.fromEntries(Object.keys(BIOME_ASSET_PROFILES).map((id) => [id, 0]));
	for (const zone of REFERENCE_BIOME_ZONES) {
		const context = resolveBiomeAssetDistribution(zone.center[0], zone.center[1], 'coverage', { sampleCount: 2 });
		coverage[context.profileId] = (coverage[context.profileId] || 0) + 1;
	}
	return Object.freeze(coverage);
}

export function densityDirectionCheck() {
	const lush = resolveBiomeAssetDistribution(0.155, 0.585, 'density', { sampleCount: 4 });
	const jungle = resolveBiomeAssetDistribution(0.555, 0.9, 'density', { sampleCount: 4 });
	const desert = resolveBiomeAssetDistribution(0.18, 0.665, 'density', { sampleCount: 4 });
	return Object.freeze({
		lush: round(lush.densityMultiplier),
		jungle: round(jungle.densityMultiplier),
		desert: round(desert.densityMultiplier),
		vegetatedGreaterThanDesert: lush.densityMultiplier > desert.densityMultiplier && jungle.densityMultiplier > desert.densityMultiplier,
	});
}

export function summarizeAssetFamilies(profileId = null) {
	const profiles = profileId ? [BIOME_ASSET_PROFILES[profileId]].filter(Boolean) : Object.values(BIOME_ASSET_PROFILES);
	const counts = new Map();
	for (const profile of profiles) for (const item of profile.scatter) counts.set(item.family, (counts.get(item.family) || 0) + 1);
	return freezeRows([...counts.entries()].sort((a, b) => b[1] - a[1]).map(([family, profileCount]) => ({ family, profileCount })));
}

export function createQaDigest(snapshot) {
	const source = JSON.stringify(snapshot);
	let hash = 2166136261;
	for (let i = 0; i < source.length; i += 1) {
		hash ^= source.charCodeAt(i);
		hash = Math.imul(hash, 16777619);
	}
	return (hash >>> 0).toString(16).padStart(8, '0');
}
