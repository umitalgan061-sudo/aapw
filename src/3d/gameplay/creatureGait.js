/**
 * Procedural gait animation for `gameplay/creatureRig.js` bodies — the declared next step after
 * run 326/ADR-0272 gave 19 species a real skeleton with nothing driving it. This module never
 * creates or removes geometry; it only sets `THREE.Bone.rotation` on an existing rig's bones each
 * frame, the same "mutate what already exists" contract `dragonController.js`'s wing-flap telegraph
 * and `npc.js`'s combat-stance idle-speed already use elsewhere in this codebase.
 *
 * **Why one driver covers 19 species instead of one per species.** Every quadruped/biped/bird rig
 * shares the same landmark names (`creatureRig.js`'s `hindKnee${L|R}` / `foreKnee${L|R}` / `wing${L|R}`
 * etc.), so a gait is data — which legs move together and how far out of phase — not code. That is
 * exactly the same "structurally identical, differ only in data" argument `creatureBodyPlans.js`'s
 * own header makes for proportions; this module makes it for motion.
 *
 * **Gait vocabulary.** `creatureBodyPlans.js`'s `restGait`/`alertGait` fields name ten distinct
 * gaits across all 19 species (`walk`, `trot`, `pace`, `prowl`, `stride`, `hop` at rest;
 * `gallop`, `bound`, `sprint`, `flap` when alert/fleeing). `GAIT_LEG_PHASES` below defines every one
 * of them as a phase offset (0..1 of one stride cycle) per leg role, so no plan's `restGait`/
 * `alertGait` value is ever left undriven.
 *
 * **Where the frequency and amplitude come from.** `plan.strideHz` already carries a per-species
 * `{walk, run}` cycles-per-second pair (run 326's own doc comment names this file as the consumer).
 * This driver reads the `run` tier when the requested gait equals the plan's own `alertGait`, and
 * the `walk` tier for every other gait (including `restGait` and any of the four/six-legged rest
 * gaits above) — the same rest/alert split `creatureBodyPlans.js` already encodes, just resolved
 * against whichever gait name the caller actually passed instead of assumed from the plan alone, so
 * a caller can drive a mid-transition gait explicitly if a future behaviour script wants to.
 *
 * **First-pass calibration, same pattern as every other feel constant in this codebase.** The phase
 * offsets below reproduce real quadruped/bird gait diagrams (walk = four-beat, trot/pace = paired
 * diagonals/laterals, bound/gallop = paired hind-then-fore) by ordinary zoological knowledge, the
 * same standard this file's neighbours (`creatureBodyPlans.js`'s header) already apply to
 * proportions. No real playtest has calibrated the swing amplitudes or ankle-bend feel — see this
 * run's `QUESTIONS_FOR_OWNER.md` entry, same "temporary default, single-constant fix" pattern as
 * every other calibrated feel value in this project (ADR-0075/0076/0085/0096/0111/0112/0116/0138/
 * 0139/0140).
 *
 * Determinism: every angle is a pure function of `elapsedSeconds` and the plan's own constants — no
 * `Math.random()`, so replaying the same `elapsedSeconds` on the same species always reproduces the
 * same pose (GOVERNANCE.md §5/§8.9).
 * @module gameplay/creatureGait
 */

/**
 * Phase offset (0..1 of one stride cycle) for each leg role, per named gait. Roles missing from a
 * pattern are simply not driven by that gait — birds have no `foreL`/`foreR` (their fore limbs are
 * wings, driven separately by `applyCreatureGait`'s own wing-flap block below), and `flap`/`hop`
 * deliberately omit whichever limb group that gait doesn't use.
 *
 * Every pattern here is a standard, named real-world gait diagram:
 * @type {Record<string, Partial<Record<'hindL'|'hindR'|'foreL'|'foreR', number>>>}
 */
export const GAIT_LEG_PHASES = Object.freeze({
	// Four-beat walk: one foot lifts at a time, evenly spaced around the cycle.
	walk: Object.freeze({ hindL: 0, foreL: 0.25, hindR: 0.5, foreR: 0.75 }),
	// Same even four-beat spacing, just this project's name for a slow/heavy walk (elephant, camel).
	stride: Object.freeze({ hindL: 0, foreL: 0.25, hindR: 0.5, foreR: 0.75 }),
	// Diagonal pairs move together: hind-left with fore-right, hind-right with fore-left.
	trot: Object.freeze({ hindL: 0, foreR: 0, hindR: 0.5, foreL: 0.5 }),
	// Same diagonal pairing as trot, driven slower/smaller (see GAIT_AMPLITUDE_SCALE) for a cat's
	// low stalking prowl rather than a dog's brisk trot.
	prowl: Object.freeze({ hindL: 0, foreR: 0, hindR: 0.5, foreL: 0.5 }),
	// Lateral pairs move together: both left legs, then both right legs.
	pace: Object.freeze({ hindL: 0, foreL: 0, hindR: 0.5, foreR: 0.5 }),
	// Both hind legs launch together, both fore legs land together — a bounding leap gait.
	bound: Object.freeze({ hindL: 0, hindR: 0, foreL: 0.5, foreR: 0.5 }),
	// Rotary gallop: hind legs lead the beat by a short stagger, fore legs follow at half-cycle.
	gallop: Object.freeze({ hindL: 0, hindR: 0.12, foreL: 0.5, foreR: 0.62 }),
	// Biped fast run: legs fully opposite phase; arms swing opposite their same-side leg.
	sprint: Object.freeze({ hindL: 0, hindR: 0.5, foreL: 0.5, foreR: 0 }),
	// Ground hop: both (only) legs push off together — birds have no fore legs to drive.
	hop: Object.freeze({ hindL: 0, hindR: 0 }),
	// Flight: legs tuck into the bind pose and stay there; only the wings move (WING_FLAP_PATTERN).
	flap: Object.freeze({}),
});

/** Swing amplitude multiplier per gait, layered on top of `LEG_SWING_AMPLITUDE_RADIANS`. A prowl
 * reads as a *low, careful* stalk rather than a brisk trot at the same phase pattern; a gallop/bound
 * reads as a bigger, more committed stride than a walk. */
const GAIT_AMPLITUDE_SCALE = Object.freeze({
	walk: 1, stride: 1, trot: 1, pace: 1, hop: 1,
	prowl: 0.55,
	bound: 1.35,
	gallop: 1.3,
	sprint: 1.15,
	flap: 1,
});

/** Base knee-bone swing, radians. Ankles counter-swing at `ANKLE_BEND_FRACTION` of this, twice per
 * stride (lifting the foot clear of the ground on both the forward and backward part of the swing),
 * which is what turns a rigid pendulum leg into a bent, stepping one. */
const LEG_SWING_AMPLITUDE_RADIANS = 0.5;
const ANKLE_BEND_FRACTION = 0.55;

/** Side-to-side tail wag. Always active (independent of gait/species locomotion state) at a fixed,
 * slow cadence — a resting animal's tail still moves; this is idle liveliness, not a gait output. */
const TAIL_SWAY_AMPLITUDE_RADIANS = 0.22;
const TAIL_SWAY_HZ = 0.6;

/** Wing flap driven only by the `flap` gait, at the plan's `run`-tier `strideHz` (flap is always
 * this project's `alertGait` for every bird — see `creatureBodyPlans.js`'s `BIRD_DEFAULTS`). The
 * wingtip leads a small extra flex behind the main wing beat for a whip-like tip, rather than the
 * whole wing moving as one rigid plane. */
const WING_FLAP_AMPLITUDE_RADIANS = 0.9;
const WING_TIP_AMPLITUDE_RADIANS = 0.5;
const WING_TIP_LAG_CYCLES = 0.15;

/** `roleKey -> [kneeBoneName, ankleBoneName]`, matching `creatureRig.js`'s landmark names exactly. */
const LEG_BONE_NAMES = Object.freeze({
	hindL: ['hindKneeL', 'hindAnkleL'],
	hindR: ['hindKneeR', 'hindAnkleR'],
	foreL: ['foreKneeL', 'foreAnkleL'],
	foreR: ['foreKneeR', 'foreAnkleR'],
});

/**
 * Returns `phase` (0..1, wrapping) advanced by `cyclesPerSecond` at `elapsedSeconds` — the one clock
 * every bone rotation below is a pure function of.
 * @param {number} elapsedSeconds
 * @param {number} cyclesPerSecond
 * @returns {number}
 */
function cyclePhase(elapsedSeconds, cyclesPerSecond) {
	const raw = elapsedSeconds * cyclesPerSecond;
	return raw - Math.floor(raw);
}

/**
 * Poses one creature rig's legs, tail and (for a bird mid-flap) wings for a single instant in time.
 * Bones outside the driven set (spine/neck/head/ears/muzzle) are left at their bind-pose rotation —
 * this run's scope is locomotion, not idle head-turns.
 *
 * @param {{bones: Record<string, import('three').Bone>, plan: import('./creatureBodyPlans.js').CreatureBodyPlan}} rig
 *   A rig as returned by `createCreatureRig()` (only `.bones` and `.plan` are read).
 * @param {object} options
 * @param {string} options.gaitName One of `GAIT_LEG_PHASES`' keys. Falls back to `'walk'` if unknown
 *   rather than throwing, so a typo degrades to a plausible pose instead of crashing a live scene.
 * @param {number} options.elapsedSeconds Monotonically increasing seconds (e.g. a running clock);
 *   the same value always produces the same pose for the same species+gait (determinism, §8.9).
 * @returns {void}
 */
export function applyCreatureGait(rig, { gaitName, elapsedSeconds }) {
	const { bones, plan } = rig;
	const gait = GAIT_LEG_PHASES[gaitName] ? gaitName : 'walk';
	const pattern = GAIT_LEG_PHASES[gait];
	const amplitudeScale = GAIT_AMPLITUDE_SCALE[gait] ?? 1;
	const tier = gait === plan.alertGait ? 'run' : 'walk';
	const cyclesPerSecond = plan.strideHz ? plan.strideHz[tier] : 1;

	for (const [role, offset] of Object.entries(pattern)) {
		const [kneeName, ankleName] = LEG_BONE_NAMES[role];
		const kneeBone = bones[kneeName];
		const ankleBone = bones[ankleName];
		if (!kneeBone) continue; // e.g. a bird has no foreL/foreR bones at all.
		const phase = cyclePhase(elapsedSeconds, cyclesPerSecond) + offset;
		const swing = Math.sin(phase * Math.PI * 2);
		kneeBone.rotation.x = swing * LEG_SWING_AMPLITUDE_RADIANS * amplitudeScale;
		if (ankleBone) {
			// Bends twice per stride (both when the foot lifts forward and when it lifts back),
			// always flexing the same direction so the ankle never hyper-extends past bind pose.
			ankleBone.rotation.x = -Math.abs(swing) * LEG_SWING_AMPLITUDE_RADIANS * ANKLE_BEND_FRACTION * amplitudeScale;
		}
	}

	if (plan.tailLengthFactor > 0 && bones.tailBase) {
		const tailPhase = cyclePhase(elapsedSeconds, TAIL_SWAY_HZ);
		bones.tailBase.rotation.y = Math.sin(tailPhase * Math.PI * 2) * TAIL_SWAY_AMPLITUDE_RADIANS;
	}

	if (gait === 'flap' && bones.wingL && bones.wingR) {
		const wingPhase = cyclePhase(elapsedSeconds, cyclesPerSecond);
		const wingSwing = Math.sin(wingPhase * Math.PI * 2);
		const tipSwing = Math.sin((wingPhase - WING_TIP_LAG_CYCLES) * Math.PI * 2);
		for (const [suffix, side] of [['L', 1], ['R', -1]]) {
			bones[`wing${suffix}`].rotation.z = side * wingSwing * WING_FLAP_AMPLITUDE_RADIANS;
			if (bones[`wingTip${suffix}`]) {
				bones[`wingTip${suffix}`].rotation.z = side * tipSwing * WING_TIP_AMPLITUDE_RADIANS;
			}
		}
	}
}

/**
 * Resets every bone `applyCreatureGait` can touch back to bind pose (rotation zero). Useful when a
 * creature stops moving entirely, or before/after a test poses a rig, so no residual rotation from a
 * previous gait leaks into an unrelated assertion.
 * @param {{bones: Record<string, import('three').Bone>}} rig
 * @returns {void}
 */
export function resetCreatureGaitPose(rig) {
	for (const name of Object.values(LEG_BONE_NAMES).flat()) {
		if (rig.bones[name]) rig.bones[name].rotation.x = 0;
	}
	if (rig.bones.tailBase) rig.bones.tailBase.rotation.y = 0;
	for (const suffix of ['L', 'R']) {
		if (rig.bones[`wing${suffix}`]) rig.bones[`wing${suffix}`].rotation.z = 0;
		if (rig.bones[`wingTip${suffix}`]) rig.bones[`wingTip${suffix}`].rotation.z = 0;
	}
}
