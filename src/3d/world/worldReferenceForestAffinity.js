/**
 * Canonical forest affinity — how wooded each of the owner map's named regions should be.
 *
 * **The gap this closes.** Run 358 gave the world real forest, but its mask was pure noise: the same
 * deterministic patch field ran everywhere, so Dorne's desert and the jungles of Sothoryos drew from
 * one distribution and came out equally wooded. The owner's ask is that the map decide — trees where
 * map.png shows woods, bare ground where it shows sand or steppe.
 *
 * **Why this table and not the image.** `resimler/map.png` is gitignored and is not present in the
 * repository, so it cannot be read at build or run time. What *is* checked in is the project's own
 * hand-audited transcription of it, `world/worldReferenceMap.js`'s `REFERENCE_BIOME_ZONES` — 17 named
 * regions with a kind, a centre and a radius, carrying SHA-256 `20702972...` of the source image.
 * `world/worldReferenceMountainRelief.js` already shapes the world's mountain chains from the sibling
 * `REFERENCE_RELIEF_CHAINS`, and `world/worldReferenceSurfacePindexes.js` already feeds the surface
 * mask from these same zones. This module makes vegetation obey the same contract, so all three
 * derive from one transcription of the map rather than three separate opinions about it.
 *
 * **What the numbers mean.** Affinity multiplies the forest patch mask, so it sets how much of a
 * region *can* be wooded while the noise still decides where the individual stands fall. They are
 * read off the biome kinds the transcription records, not invented per region: a jungle is fully
 * wooded, a desert is not, and the interesting cases are the ones in between.
 *
 * **Determinism.** A frozen lookup over frozen data, blended by the same `sampleReferenceInfluence`
 * falloff every other consumer of these zones uses. No state, no randomness.
 * @module world/worldReferenceForestAffinity
 */

import { REFERENCE_BIOME_ZONES, sampleReferenceInfluence } from './worldReferenceMap.js';
import { sampleMapForest01 } from './worldReferenceBiomeField.js';

/**
 * Forest affinity in [0, 1] per biome kind recorded in `REFERENCE_BIOME_ZONES`.
 *
 * Every kind present in that table has an entry, so a zone can never silently fall through to the
 * default — if a future transcription pass adds a kind, `FOREST_AFFINITY_BY_KIND` is where it has to
 * be given a meaning.
 */
export const FOREST_AFFINITY_BY_KIND = Object.freeze({
	/** Closed canopy — Sothoryos and Ulthos are drawn as solid green on the map. */
	jungle: 1.0,
	/** The Reach and Yi Ti: farmland and woodland mixed, heavily wooded but not unbroken. */
	'lush-grassland': 0.85,
	/** Coastal temperate country — wooded, with the coast itself breaking it up. */
	'temperate-coast': 0.75,
	/** The North: real forest, but thinner and more open than the Reach. */
	'cold-grassland': 0.70,
	/** The Westerlands' hills carry woods on their flanks and bare rock on their tops. */
	'rocky-hills': 0.40,
	/** The Neck is swamp: standing water and reeds far more than closed forest. */
	marsh: 0.35,
	/** Mountain chains hold forest only on their lower slopes; the tree line in
	 * `world/terrainBiomeShading.js` does the rest of the work above that. */
	mountain: 0.25,
	/** The Dothraki sea and Jogos Nhai are grass to the horizon — the defining feature is the absence
	 * of trees, so this is deliberately near zero rather than merely low. */
	steppe: 0.05,
	/** The Grey Waste: scrub at best. */
	arid: 0.02,
	/** Dorne and the Red Waste. Sand does not grow trees. */
	desert: 0.0,
	/** The Lands of Always Winter sit beyond any tree line. */
	snow: 0.0,
});

/**
 * Affinity to use where no named zone reaches — most of the map's unlabelled land, which the
 * transcription leaves to the generic temperate treatment.
 *
 * Deliberately mid-range rather than 0 or 1: the zone table names the *distinctive* regions, so
 * unlabelled ground is ordinary country, and it should be neither bare nor jungle.
 */
export const UNZONED_FOREST_AFFINITY = 0.62;

/**
 * Zone influence at which a region's own kind fully governs its vegetation.
 *
 * `sampleReferenceInfluence` only reaches 1 at a zone's exact centre and decays to 0 at its rim, so
 * blending on raw influence let the unzoned default speak for most of every region: measured, Dorne's
 * desert still came out at 0.142 forest coverage and Sothoryos' jungle only reached 0.493 — the map
 * was being consulted and then largely overruled. Saturating at 0.35 hands the inner two-thirds of
 * each zone to its own kind while keeping the rim a genuine gradient into neighbouring country.
 */
const ZONE_AUTHORITY_FULL_INFLUENCE = 0.35;

/**
 * Canonical forest affinity at a normalized owner-map coordinate.
 *
 * Zones overlap (the Vale mountains sit inside the North, Dorne's mountains inside Dorne), so the
 * result is an influence-weighted blend rather than a winner-takes-all lookup — that keeps a region's
 * edge a gradient, matching how `worldReferenceSurfacePindexes.js` already reads the same zones, and
 * avoids a hard line in the vegetation where two named regions meet.
 *
 * @param {number} normalizedX
 * @param {number} normalizedY
 * @returns {number} 0 = never wooded, 1 = fully wooded.
 */
export function canonicalForestAffinity(normalizedX, normalizedY) {
	// Run 364: the owner map itself now answers this, per cell, from its own pixels — see
	// `world/worldReferenceBiomeField.js`. The seventeen-ellipse blend below was an approximation of
	// exactly this data, built while the image was gitignored and unreadable; it is kept as the
	// fallback for the small share of land no zone and no legible colour covers, and because several
	// modules import this function's name.
	const fromImage = sampleMapForest01(normalizedX, normalizedY);
	if (fromImage > 0.02) return fromImage;

	let weightedTotal = 0;
	let weight = 0;
	for (const zone of REFERENCE_BIOME_ZONES) {
		const influence = sampleReferenceInfluence(normalizedX, normalizedY, zone);
		if (influence <= 0) continue;
		const affinity = FOREST_AFFINITY_BY_KIND[zone.kind];
		if (affinity === undefined) continue;
		weightedTotal += affinity * influence;
		weight += influence;
	}
	if (weight <= 0) return UNZONED_FOREST_AFFINITY;
	// Where zone influence is partial, blend toward unzoned country rather than letting a single weak
	// zone speak for ground it barely reaches.
	const zoned = weightedTotal / weight;
	const authority = Math.min(1, weight / ZONE_AUTHORITY_FULL_INFLUENCE);
	return zoned * authority + UNZONED_FOREST_AFFINITY * (1 - authority);
}
