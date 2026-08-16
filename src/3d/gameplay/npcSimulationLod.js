const DEFAULT_NEAR_RADIUS_METERS = 90;
const DEFAULT_FAR_INTERVAL_SECONDS = 0.25;
const DEFAULT_MAX_STEP_SECONDS = 0.25;

function clampDelta(delta, maxStepSeconds) {
	if (!Number.isFinite(delta) || delta <= 0) return 0;
	return Math.min(delta, maxStepSeconds);
}

export function deterministicNpcPhaseSeconds(id, intervalSeconds) {
	if (!(intervalSeconds > 0)) return 0;
	let hash = 2166136261;
	for (const char of String(id ?? 'npc')) {
		hash ^= char.charCodeAt(0);
		hash = Math.imul(hash, 16777619) >>> 0;
	}
	return (hash / 0x100000000) * intervalSeconds;
}

/**
 * Small deterministic scheduler owned by the existing NPC runtime. Near/urgent actors keep full
 * simulation cadence; far ambient actors coalesce work into bounded, staggered steps. It deliberately
 * uses no wall clock and no randomness so replay/CI behavior is stable.
 */
export function createNpcSimulationLod({
	id,
	nearRadiusMeters = DEFAULT_NEAR_RADIUS_METERS,
	farIntervalSeconds = DEFAULT_FAR_INTERVAL_SECONDS,
	maxStepSeconds = DEFAULT_MAX_STEP_SECONDS,
} = {}) {
	if (!(nearRadiusMeters > 0)) throw new Error('nearRadiusMeters must be > 0');
	if (!(farIntervalSeconds > 0)) throw new Error('farIntervalSeconds must be > 0');
	if (!(maxStepSeconds > 0)) throw new Error('maxStepSeconds must be > 0');

	let accumulatedSeconds = deterministicNpcPhaseSeconds(id, farIntervalSeconds);
	let tier = 'near';

	return {
		step(delta, distanceToPlayer, urgent = false) {
			const boundedDelta = clampDelta(delta, maxStepSeconds);
			const near = urgent || !Number.isFinite(distanceToPlayer) || distanceToPlayer <= nearRadiusMeters;
			if (near) {
				accumulatedSeconds = 0;
				tier = urgent ? 'urgent' : 'near';
				return boundedDelta;
			}

			tier = 'far';
			accumulatedSeconds = Math.min(maxStepSeconds, accumulatedSeconds + boundedDelta);
			if (accumulatedSeconds + Number.EPSILON < farIntervalSeconds) return 0;
			const simulationDelta = Math.min(accumulatedSeconds, maxStepSeconds);
			accumulatedSeconds = 0;
			return simulationDelta;
		},
		get tier() {
			return tier;
		},
		get accumulatedSeconds() {
			return accumulatedSeconds;
		},
	};
}
