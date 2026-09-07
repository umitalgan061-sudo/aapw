#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import {
  WORLD_REFERENCE_MAP,
  REFERENCE_BIOME_ZONES,
  sampleReferenceInfluence,
} from '../src/3d/world/worldReferenceMap.js';
import {
  GEOGRAPHIC_ASSET_DISTRIBUTION_VERSION,
  CHARACTER_SURFACE_REQUIREMENTS,
  CHARACTER_ASSET_PROFILES,
  GEOGRAPHIC_BIOME_VISUAL_PROFILES,
  GEOGRAPHIC_DISTRIBUTION_RULES,
  getGeographicBiomeVisualProfile,
  getCharacterAssetProfile,
  isAssetAllowedInBiome,
  summarizeGeographicDistribution,
} from '../src/3d/world/geographicAssetDistributionContract.js';

const contractText = fs.readFileSync(
  path.join(process.cwd(), 'src/3d/world/geographicAssetDistributionContract.js'),
  'utf8',
);

const checks = [];
const fail = (condition, message) => {
  if (!condition) throw new Error(message);
  checks.push(message);
};

const zoneKinds = [...new Set(REFERENCE_BIOME_ZONES.map((zone) => zone.kind))].sort();
const profileKinds = Object.keys(GEOGRAPHIC_BIOME_VISUAL_PROFILES).sort();

fail(GEOGRAPHIC_ASSET_DISTRIBUTION_VERSION === '2026-09-07.v1', 'distribution contract version pinned');
fail(WORLD_REFERENCE_MAP.id === 'owner-world-map-2026-08-08', 'canonical source-map id preserved');
fail(WORLD_REFERENCE_MAP.sha256.length === 64, 'canonical source-map SHA pinned');
fail(REFERENCE_BIOME_ZONES.length === 17, 'all 17 authored biome zones remain visible to the audit');
fail(zoneKinds.length === profileKinds.length, 'every canonical biome kind has exactly one visual profile');

for (const kind of zoneKinds) {
  const profile = getGeographicBiomeVisualProfile(kind);
  fail(Boolean(profile), `profile exists for biome ${kind}`);
  fail(profile.characters.length > 0, `${kind} has at least one human visual family`);
  for (const assetId of profile.characters) {
    const asset = getCharacterAssetProfile(assetId);
    fail(Boolean(asset), `${kind} references known asset ${assetId}`);
    fail(isAssetAllowedInBiome(assetId, kind), `${assetId} explicitly allows ${kind}`);
    fail(!profile.forbiddenCharacterFamilies.includes(asset.family), `${kind} does not place forbidden family ${asset.family}`);
  }
  for (const forbiddenFamily of profile.forbiddenCharacterFamilies) {
    fail(!profile.characters.some((assetId) => getCharacterAssetProfile(assetId)?.family === forbiddenFamily),
      `${kind} forbidden family ${forbiddenFamily} is absent`);
  }
}

for (const zone of REFERENCE_BIOME_ZONES) {
  const [x, y] = zone.center;
  const influence = sampleReferenceInfluence(x, y, zone);
  fail(influence > 0.99, `${zone.id} centre has strong self-influence`);
  const profile = getGeographicBiomeVisualProfile(zone.kind);
  fail(profile.groundMood.length > 3, `${zone.id} keeps an explicit ground visual mood`);
}

for (const [assetId, asset] of Object.entries(CHARACTER_ASSET_PROFILES)) {
  fail(asset.source.startsWith('assets/models/'), `${assetId} uses repository model provenance`);
  fail(asset.family in CHARACTER_SURFACE_REQUIREMENTS, `${assetId} has a surface requirement family`);
  fail(asset.preferredBiomes.length > 0, `${assetId} has non-empty geographic preference`);
  for (const biome of asset.preferredBiomes) {
    fail(Boolean(getGeographicBiomeVisualProfile(biome)), `${assetId} biome ${biome} has visual profile`);
  }
  if (asset.textureEvidence) {
    fail(asset.textureEvidence.length >= 2, `${assetId} exposes multiple texture-evidence paths`);
    fail(asset.textureEvidence.every((entry) => entry.includes('/textures/')), `${assetId} texture provenance stays in textures/`);
  }
}

for (const [family, requirement] of Object.entries(CHARACTER_SURFACE_REQUIREMENTS)) {
  fail(requirement.requiredSemanticSurfaces.length >= 4, `${family} exposes distinct semantic surface roles`);
  fail(requirement.materialSeparation === 'named-or-layered', `${family} rejects flat material collapse`);
}

const summary = summarizeGeographicDistribution();
fail(summary.biomeCount === profileKinds.length, 'summary biome count matches contract');
fail(summary.assetProfileCount === Object.keys(CHARACTER_ASSET_PROFILES).length, 'summary asset count matches contract');
fail(summary.familyCount === Object.keys(CHARACTER_SURFACE_REQUIREMENTS).length, 'summary family count matches contract');
fail(GEOGRAPHIC_DISTRIBUTION_RULES.length >= 6, 'distribution rule registry is non-trivial');

const forbiddenByKind = Object.fromEntries(
  profileKinds.map((kind) => [kind, getGeographicBiomeVisualProfile(kind).forbiddenCharacterFamilies]),
);

const expectedSingleFamily = new Map([
  ['snow', 'knight'],
  ['marsh', 'peasant'],
  ['mountain', 'knight'],
  ['desert', 'soldier'],
  ['arid', 'soldier'],
  ['steppe', 'soldier'],
]);

for (const [kind, palette] of expectedSingleFamily) {
  const profile = getGeographicBiomeVisualProfile(kind);
  fail(profile.characters.every((assetId) => getCharacterAssetProfile(assetId)?.family === 'human'),
    `${kind} remains human-only ambient distribution`);
  fail(profile.characters.some((assetId) => getCharacterAssetProfile(assetId)?.palette === palette),
    `${kind} keeps its intended ${palette} palette family`);
}

fail(contractText.includes('preferredBiomes'), 'source contract retains geographic preference vocabulary');
fail(contractText.includes('textureEvidence'), 'source contract retains explicit texture provenance vocabulary');

const invariantReport = {
  sourceMap: WORLD_REFERENCE_MAP.id,
  zoneCount: REFERENCE_BIOME_ZONES.length,
  uniqueBiomeKinds: zoneKinds,
  assetProfileCount: Object.keys(CHARACTER_ASSET_PROFILES).length,
  familyCount: Object.keys(CHARACTER_SURFACE_REQUIREMENTS).length,
  forbiddenByKind,
  checks: checks.length,
  sourceLineCount: contractText.split('\n').length,
};

console.log(`[checkGeographicAssetDistributionCoverage] PASS ${JSON.stringify(invariantReport)}`);
