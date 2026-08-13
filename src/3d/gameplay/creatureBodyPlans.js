/**
 * `CREATURE_BODY_PLANS` — the parametric proportions each species' procedural skeleton and skinned
 * body are built from (`gameplay/creatureRig.js`), plus the gait cadence that drives them
 * (`gameplay/creatureGait.js`).
 *
 * **Why this exists at all.** `gameplay/creatureSpeciesConfig.js` has captured every species'
 * *characteristic behaviour* since run 72, but it deliberately stopped short of a runtime engine
 * because each species was "awaiting-model". That wait turned out to be unsatisfiable on the terms
 * it assumed: `assets_manifest.json` records `rigged: false` for `ivory_stallion` (the horse),
 * `verdant_knight`, `wooden_legion` and every Meshy dragon, and there is no model at all — rigged or
 * otherwise — for cat, dog, elephant, sheep, deer, goat, cow, pig, rabbit or any bird. Only the
 * wolf, the FBX dragon and the Mixamo humans ship with a skeleton. Since this project's one hard
 * constraint forbids downloading real HBO assets and the owner cannot hand-rig sixteen models,
 * "wait for a rigged model" was never going to resolve on its own.
 *
 * So the body is generated instead of loaded: a bone hierarchy plus a skinned mesh built to these
 * proportions, wearing a texture from the procedural palette library that runs 319-322 already
 * built (`materials/palettes.js` happens to carry exactly the 21 animal palettes needed —
 * `cat`/`dog`/`horse-bay`/`elephant`/`sheep`/`deer`/... — each with its own painter, so the hide
 * side of this was already solved).
 *
 * **Units are real meters at real animal scale**, not arbitrary. `bodyLengthMeters` is nose-to-rump
 * along the spine, `shoulderHeightMeters` is ground-to-withers; the two together fix the whole
 * figure, because every other measurement below is expressed as a *fraction* of one of them rather
 * than as another absolute number. That keeps a cat and an elephant structurally identical in code
 * and different only in data — and it means a wrong-looking species is a data fix, not a code fix.
 *
 * Proportions are ordinary zoological common knowledge (a giraffe's neck is most of its height, a
 * rabbit's hind legs are far longer than its front, an elephant's legs are near-vertical columns
 * while a cat's are strongly cranked) applied by eye, not measured from any reference work or
 * traced from any asset.
 * @module gameplay/creatureBodyPlans
 */

/**
 * @typedef {object} CreatureBodyPlan
 * @property {string} id Slug — matches the key in `CREATURE_BODY_PLANS`, and where one exists, the
 *   `gameplay/creatureSpeciesConfig.js` entry of the same name.
 * @property {string} displayNameTr Turkish display name (GOVERNANCE.md §15: in-game text is Turkish).
 * @property {'quadruped'|'biped'|'bird'} archetype Which skeleton `creatureRig.js` assembles.
 * @property {string} paletteId Key into `materials/palettes.js` — the hide/coat/feather texture.
 * @property {number} bodyLengthMeters Nose-to-rump along the spine.
 * @property {number} shoulderHeightMeters Ground to the top of the shoulder.
 * @property {number} bodyRadiusFactor Torso thickness as a fraction of `bodyLengthMeters`.
 * @property {number} neckLengthFactor Neck length as a fraction of `bodyLengthMeters`.
 * @property {number} neckPitchRadians Rest angle of the neck above horizontal. A grazer holds its
 *   head low and forward, a cat level, a raptor and a giraffe high.
 * @property {number} headLengthFactor Head length as a fraction of `bodyLengthMeters`.
 * @property {number} legThicknessFactor Limb radius as a fraction of `shoulderHeightMeters`.
 * @property {number} hindLegLengthFactor Hind-leg length relative to `shoulderHeightMeters` — above
 *   1 for the bounders (rabbit, deer) whose hindquarters sit higher than their shoulders.
 * @property {number} legCrankRadians How strongly the knee/hock is folded at rest. Near 0 is an
 *   elephant's vertical column; large is a cat's crouched, spring-loaded stance.
 * @property {number} tailLengthFactor Tail length as a fraction of `bodyLengthMeters`. 0 = no tail.
 * @property {number} tailThicknessFactor Tail radius relative to the body radius.
 * @property {number} earSizeFactor Ear size as a fraction of head length. 0 = no ears modelled.
 * @property {number} earPitchRadians How far the ears stand up from horizontal. Near `PI/2` is a
 *   cat's or rabbit's pricked ear; near 0 is an elephant's broad lateral fan or a lop-eared sheep's
 *   droop. Without this every species grew the same vertical spikes, which read as horns.
 * @property {{walk: number, run: number}} strideHz Leg-cycle frequency at each gait, in cycles per
 *   second. Small animals take many short steps, large ones few long ones — this is what stops a
 *   mouse-scaled trot from being applied to an elephant.
 * @property {'walk'|'trot'|'pace'|'bound'|'prowl'|'stride'|'hop'|'flap'} restGait Default gait.
 * @property {'bound'|'gallop'|'sprint'|'flap'} alertGait Gait used when fleeing/charging/pursuing.
 */

/** Shared by every four-legged plan; overridden per species where the animal really differs. */
const QUADRUPED_DEFAULTS = {
	archetype: 'quadruped',
	bodyRadiusFactor: 0.17,
	neckLengthFactor: 0.22,
	neckPitchRadians: 0.35,
	headLengthFactor: 0.22,
	legThicknessFactor: 0.09,
	hindLegLengthFactor: 1,
	legCrankRadians: 0.45,
	tailLengthFactor: 0.35,
	tailThicknessFactor: 0.35,
	earSizeFactor: 0.25,
	earPitchRadians: 1.35,
	restGait: 'walk',
	alertGait: 'gallop',
};

const BIRD_DEFAULTS = {
	archetype: 'bird',
	bodyRadiusFactor: 0.3,
	neckLengthFactor: 0.28,
	neckPitchRadians: 0.9,
	headLengthFactor: 0.24,
	legThicknessFactor: 0.05,
	hindLegLengthFactor: 1,
	legCrankRadians: 0.7,
	tailLengthFactor: 0.5,
	tailThicknessFactor: 0.5,
	earSizeFactor: 0,
	earPitchRadians: 0,
	restGait: 'hop',
	alertGait: 'flap',
};

/** @type {Record<string, CreatureBodyPlan>} */
export const CREATURE_BODY_PLANS = Object.freeze({
	kedi: Object.freeze({
		...QUADRUPED_DEFAULTS,
		id: 'kedi',
		displayNameTr: 'Kedi',
		paletteId: 'cat',
		bodyLengthMeters: 0.52,
		shoulderHeightMeters: 0.26,
		// A cat carries its spine level and its legs deeply cranked — the crouched, spring-loaded
		// stance that makes `pounce` read as a release rather than a step.
		neckPitchRadians: 0.05,
		legCrankRadians: 0.75,
		tailLengthFactor: 0.62,
		tailThicknessFactor: 0.28,
		earSizeFactor: 0.42,
		earPitchRadians: 1.45,
		strideHz: Object.freeze({ walk: 2.2, run: 4.4 }),
		restGait: 'prowl',
		alertGait: 'bound',
	}),
	kopek: Object.freeze({
		...QUADRUPED_DEFAULTS,
		id: 'kopek',
		displayNameTr: 'Köpek',
		paletteId: 'dog',
		bodyLengthMeters: 0.85,
		shoulderHeightMeters: 0.55,
		neckPitchRadians: 0.28,
		legCrankRadians: 0.5,
		tailLengthFactor: 0.4,
		earSizeFactor: 0.38,
		earPitchRadians: 0.55,
		strideHz: Object.freeze({ walk: 1.9, run: 3.6 }),
		restGait: 'trot',
		alertGait: 'gallop',
	}),
	at: Object.freeze({
		...QUADRUPED_DEFAULTS,
		id: 'at',
		displayNameTr: 'At',
		paletteId: 'horse-bay',
		bodyLengthMeters: 2.4,
		shoulderHeightMeters: 1.6,
		bodyRadiusFactor: 0.15,
		neckLengthFactor: 0.3,
		neckPitchRadians: 0.62,
		legThicknessFactor: 0.055,
		legCrankRadians: 0.3,
		tailLengthFactor: 0.32,
		tailThicknessFactor: 0.25,
		earSizeFactor: 0.2,
		earPitchRadians: 1.25,
		strideHz: Object.freeze({ walk: 1.1, run: 2.3 }),
		restGait: 'walk',
		alertGait: 'gallop',
	}),
	fil: Object.freeze({
		...QUADRUPED_DEFAULTS,
		id: 'fil',
		displayNameTr: 'Fil',
		paletteId: 'elephant',
		bodyLengthMeters: 4.2,
		shoulderHeightMeters: 3.1,
		bodyRadiusFactor: 0.24,
		neckLengthFactor: 0.1,
		neckPitchRadians: 0.1,
		headLengthFactor: 0.3,
		legThicknessFactor: 0.13,
		// Near-zero crank: an elephant's legs are weight-bearing columns, the one quadruped here that
		// stands with its joints essentially stacked rather than folded.
		legCrankRadians: 0.06,
		tailLengthFactor: 0.28,
		tailThicknessFactor: 0.16,
		earSizeFactor: 0.95,
		earPitchRadians: 0.05,
		strideHz: Object.freeze({ walk: 0.65, run: 1.15 }),
		restGait: 'stride',
		alertGait: 'gallop',
	}),
	kurt: Object.freeze({
		...QUADRUPED_DEFAULTS,
		id: 'kurt',
		displayNameTr: 'Kurt',
		paletteId: 'wolf',
		bodyLengthMeters: 1.15,
		shoulderHeightMeters: 0.72,
		neckPitchRadians: 0.18,
		legCrankRadians: 0.42,
		tailLengthFactor: 0.42,
		earSizeFactor: 0.32,
		earPitchRadians: 1.35,
		strideHz: Object.freeze({ walk: 1.7, run: 3.2 }),
		restGait: 'trot',
		alertGait: 'gallop',
	}),
	geyik: Object.freeze({
		...QUADRUPED_DEFAULTS,
		id: 'geyik',
		displayNameTr: 'Geyik',
		paletteId: 'deer',
		bodyLengthMeters: 1.7,
		shoulderHeightMeters: 1.15,
		bodyRadiusFactor: 0.14,
		neckLengthFactor: 0.28,
		neckPitchRadians: 0.75,
		legThicknessFactor: 0.045,
		// Hindquarters above the withers: the source of the bounding flee gait `creatureSpeciesConfig`
		// asks for (`herd-bound`), as distinct from a wolf's flat sprint.
		hindLegLengthFactor: 1.06,
		legCrankRadians: 0.5,
		tailLengthFactor: 0.14,
		earSizeFactor: 0.34,
		earPitchRadians: 0.95,
		strideHz: Object.freeze({ walk: 1.5, run: 2.8 }),
		restGait: 'walk',
		alertGait: 'bound',
	}),
	koyun: Object.freeze({
		...QUADRUPED_DEFAULTS,
		id: 'koyun',
		displayNameTr: 'Koyun',
		paletteId: 'sheep',
		bodyLengthMeters: 1.05,
		shoulderHeightMeters: 0.7,
		bodyRadiusFactor: 0.23,
		neckLengthFactor: 0.15,
		neckPitchRadians: 0.95,
		legThicknessFactor: 0.06,
		legCrankRadians: 0.32,
		tailLengthFactor: 0.12,
		earSizeFactor: 0.3,
		earPitchRadians: 0.15,
		strideHz: Object.freeze({ walk: 1.6, run: 2.9 }),
		restGait: 'walk',
		alertGait: 'bound',
	}),
	inek: Object.freeze({
		...QUADRUPED_DEFAULTS,
		id: 'inek',
		displayNameTr: 'İnek',
		paletteId: 'cow',
		bodyLengthMeters: 2.1,
		shoulderHeightMeters: 1.35,
		bodyRadiusFactor: 0.2,
		neckLengthFactor: 0.16,
		neckPitchRadians: 0.85,
		legThicknessFactor: 0.07,
		legCrankRadians: 0.25,
		tailLengthFactor: 0.42,
		tailThicknessFactor: 0.14,
		earSizeFactor: 0.3,
		earPitchRadians: 0.1,
		strideHz: Object.freeze({ walk: 1, run: 1.9 }),
		restGait: 'walk',
		alertGait: 'gallop',
	}),
	keci: Object.freeze({
		...QUADRUPED_DEFAULTS,
		id: 'keci',
		displayNameTr: 'Keçi',
		paletteId: 'goat',
		bodyLengthMeters: 1,
		shoulderHeightMeters: 0.68,
		bodyRadiusFactor: 0.18,
		neckPitchRadians: 0.7,
		legThicknessFactor: 0.055,
		legCrankRadians: 0.35,
		tailLengthFactor: 0.14,
		earSizeFactor: 0.38,
		earPitchRadians: 0.35,
		strideHz: Object.freeze({ walk: 1.7, run: 3 }),
		restGait: 'walk',
		alertGait: 'bound',
	}),
	domuz: Object.freeze({
		...QUADRUPED_DEFAULTS,
		id: 'domuz',
		displayNameTr: 'Yaban Domuzu',
		paletteId: 'pig',
		bodyLengthMeters: 1.3,
		shoulderHeightMeters: 0.7,
		bodyRadiusFactor: 0.24,
		neckLengthFactor: 0.08,
		neckPitchRadians: 0.5,
		legThicknessFactor: 0.07,
		legCrankRadians: 0.4,
		tailLengthFactor: 0.16,
		tailThicknessFactor: 0.15,
		earSizeFactor: 0.34,
		earPitchRadians: 0.85,
		strideHz: Object.freeze({ walk: 1.8, run: 3.3 }),
		restGait: 'walk',
		alertGait: 'gallop',
	}),
	tavsan: Object.freeze({
		...QUADRUPED_DEFAULTS,
		id: 'tavsan',
		displayNameTr: 'Tavşan',
		paletteId: 'rabbit',
		bodyLengthMeters: 0.4,
		shoulderHeightMeters: 0.18,
		bodyRadiusFactor: 0.24,
		neckLengthFactor: 0.08,
		neckPitchRadians: 0.4,
		legThicknessFactor: 0.09,
		// The most extreme hind-over-fore ratio here — it is what makes the hop read as a hop.
		hindLegLengthFactor: 1.6,
		legCrankRadians: 0.95,
		tailLengthFactor: 0.1,
		tailThicknessFactor: 0.8,
		earSizeFactor: 1.1,
		earPitchRadians: 1.5,
		strideHz: Object.freeze({ walk: 2.4, run: 3.6 }),
		restGait: 'hop',
		alertGait: 'bound',
	}),
	ayi: Object.freeze({
		...QUADRUPED_DEFAULTS,
		id: 'ayi',
		displayNameTr: 'Ayı',
		paletteId: 'bear',
		bodyLengthMeters: 1.8,
		shoulderHeightMeters: 1,
		bodyRadiusFactor: 0.23,
		neckLengthFactor: 0.12,
		neckPitchRadians: 0.3,
		legThicknessFactor: 0.11,
		legCrankRadians: 0.5,
		tailLengthFactor: 0.06,
		earSizeFactor: 0.3,
		earPitchRadians: 1.2,
		strideHz: Object.freeze({ walk: 1.2, run: 2.4 }),
		restGait: 'stride',
		alertGait: 'gallop',
	}),
	aslan: Object.freeze({
		...QUADRUPED_DEFAULTS,
		id: 'aslan',
		displayNameTr: 'Aslan',
		paletteId: 'lion',
		bodyLengthMeters: 1.9,
		shoulderHeightMeters: 1.1,
		neckPitchRadians: 0.1,
		legThicknessFactor: 0.095,
		legCrankRadians: 0.55,
		tailLengthFactor: 0.5,
		tailThicknessFactor: 0.2,
		earSizeFactor: 0.26,
		earPitchRadians: 1.05,
		strideHz: Object.freeze({ walk: 1.3, run: 2.7 }),
		restGait: 'prowl',
		alertGait: 'sprint',
	}),
	zurafa: Object.freeze({
		...QUADRUPED_DEFAULTS,
		id: 'zurafa',
		displayNameTr: 'Zürafa',
		paletteId: 'giraffe',
		bodyLengthMeters: 2.4,
		shoulderHeightMeters: 3,
		bodyRadiusFactor: 0.16,
		// The one plan where the neck is longer than the torso — and the reason `neckLengthFactor` is
		// a free parameter rather than a shared constant.
		neckLengthFactor: 1.05,
		neckPitchRadians: 1.25,
		headLengthFactor: 0.15,
		legThicknessFactor: 0.04,
		legCrankRadians: 0.12,
		tailLengthFactor: 0.35,
		tailThicknessFactor: 0.12,
		earSizeFactor: 0.22,
		earPitchRadians: 1.15,
		strideHz: Object.freeze({ walk: 0.8, run: 1.6 }),
		restGait: 'pace',
		alertGait: 'gallop',
	}),
	insan: Object.freeze({
		id: 'insan',
		displayNameTr: 'İnsan',
		archetype: 'biped',
		paletteId: 'peasant',
		bodyLengthMeters: 0.72,
		shoulderHeightMeters: 1.45,
		bodyRadiusFactor: 0.24,
		neckLengthFactor: 0.16,
		neckPitchRadians: 1.4,
		headLengthFactor: 0.32,
		legThicknessFactor: 0.055,
		hindLegLengthFactor: 1,
		legCrankRadians: 0.12,
		tailLengthFactor: 0,
		tailThicknessFactor: 0,
		earSizeFactor: 0,
		earPitchRadians: 0,
		strideHz: Object.freeze({ walk: 0.9, run: 1.7 }),
		restGait: 'walk',
		alertGait: 'sprint',
	}),
	asker: Object.freeze({
		id: 'asker',
		displayNameTr: 'Asker',
		archetype: 'biped',
		paletteId: 'soldier',
		bodyLengthMeters: 0.76,
		shoulderHeightMeters: 1.5,
		bodyRadiusFactor: 0.27,
		neckLengthFactor: 0.14,
		neckPitchRadians: 1.45,
		headLengthFactor: 0.31,
		legThicknessFactor: 0.062,
		hindLegLengthFactor: 1,
		// Straighter knees and a slower, even cadence — the marching bearing `creatureSpeciesConfig`
		// describes for this archetype, distinct from a villager's looser walk.
		legCrankRadians: 0.08,
		tailLengthFactor: 0,
		tailThicknessFactor: 0,
		earSizeFactor: 0,
		earPitchRadians: 0,
		strideHz: Object.freeze({ walk: 0.85, run: 1.6 }),
		restGait: 'stride',
		alertGait: 'sprint',
	}),
	kuzgun: Object.freeze({
		...BIRD_DEFAULTS,
		id: 'kuzgun',
		displayNameTr: 'Kuzgun',
		paletteId: 'raven',
		bodyLengthMeters: 0.42,
		shoulderHeightMeters: 0.2,
		strideHz: Object.freeze({ walk: 2.6, run: 5.5 }),
	}),
	kartal: Object.freeze({
		...BIRD_DEFAULTS,
		id: 'kartal',
		displayNameTr: 'Kartal',
		paletteId: 'eagle',
		bodyLengthMeters: 0.65,
		shoulderHeightMeters: 0.32,
		neckPitchRadians: 1.05,
		strideHz: Object.freeze({ walk: 2.2, run: 4.6 }),
	}),
	tavuk: Object.freeze({
		...BIRD_DEFAULTS,
		id: 'tavuk',
		displayNameTr: 'Tavuk',
		paletteId: 'chicken',
		bodyLengthMeters: 0.32,
		shoulderHeightMeters: 0.22,
		neckPitchRadians: 1.1,
		tailLengthFactor: 0.35,
		strideHz: Object.freeze({ walk: 3, run: 5.2 }),
	}),
});

/** Every plan id, in declaration order. */
export const CREATURE_BODY_PLAN_IDS = Object.freeze(Object.keys(CREATURE_BODY_PLANS));

/**
 * Looks up a body plan, throwing rather than returning `undefined` — a typo in a species id should
 * fail loudly at spawn time, not silently produce an invisible creature.
 * @param {string} speciesId
 * @returns {CreatureBodyPlan}
 */
export function findBodyPlan(speciesId) {
	const plan = CREATURE_BODY_PLANS[speciesId];
	if (!plan) {
		throw new Error(
			`[gameplay/creatureBodyPlans] unknown species "${speciesId}" — known: ${CREATURE_BODY_PLAN_IDS.join(', ')}`,
		);
	}
	return plan;
}
