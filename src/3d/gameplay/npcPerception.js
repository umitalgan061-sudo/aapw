const DEG_TO_RAD = Math.PI / 180;

export const DEFAULT_GUARD_PERCEPTION = Object.freeze({
	fieldOfViewDegrees: 120,
	peripheralRadiusMeters: 3.25,
	acquireSeconds: 0.22,
	memorySeconds: 2.0,
	investigationSpeedMps: 1.2,
	searchSeconds: 1.25,
	alertThreshold: 0.72,
	lineOfSightStepMeters: 0.5,
	maxLineOfSightSamples: 64,
});

function clamp01(value) {
	return Math.max(0, Math.min(1, Number(value) || 0));
}

function normalizeYaw(value) {
	const yaw = Number(value) || 0;
	return Math.atan2(Math.sin(yaw), Math.cos(yaw));
}

function finitePoint(point) {
	return Boolean(point && Number.isFinite(Number(point.x)) && Number.isFinite(Number(point.z)));
}

/**
 * Reuses the existing settlement/village composed collider as an X/Z visibility query without
 * taking ownership of world geometry. Points are sampled along the observer->target segment; when
 * `resolveXZ()` pushes a probe away, that probe lies inside a solid gameplay obstacle and sight is
 * blocked. The target and observer endpoints are deliberately excluded so touching a wall does not
 * make a guard blind to somebody standing immediately beside it.
 */
export function queryColliderLineOfSight({
	collider,
	observer,
	target,
	stepMeters = DEFAULT_GUARD_PERCEPTION.lineOfSightStepMeters,
	maxSamples = DEFAULT_GUARD_PERCEPTION.maxLineOfSightSamples,
	epsilonMeters = 1e-4,
} = {}) {
	if (!finitePoint(observer) || !finitePoint(target)) {
		return Object.freeze({ clear: false, samples: 0, reason: 'invalid', blockedAt: null });
	}
	if (!collider?.resolveXZ) {
		return Object.freeze({ clear: true, samples: 0, reason: 'no-collider', blockedAt: null });
	}

	const dx = Number(target.x) - Number(observer.x);
	const dz = Number(target.z) - Number(observer.z);
	const distanceMeters = Math.hypot(dx, dz);
	if (distanceMeters <= epsilonMeters) {
		return Object.freeze({ clear: true, samples: 0, reason: 'same-point', blockedAt: null });
	}

	const safeStep = Math.max(0.1, Number(stepMeters) || DEFAULT_GUARD_PERCEPTION.lineOfSightStepMeters);
	const sampleBudget = Math.max(1, Math.floor(Number(maxSamples) || DEFAULT_GUARD_PERCEPTION.maxLineOfSightSamples));
	const segmentCount = Math.max(1, Math.min(sampleBudget + 1, Math.ceil(distanceMeters / safeStep)));
	let samples = 0;
	for (let i = 1; i < segmentCount; i += 1) {
		const t = i / segmentCount;
		const x = Number(observer.x) + dx * t;
		const z = Number(observer.z) + dz * t;
		const resolved = collider.resolveXZ(x, z);
		samples += 1;
		if (!finitePoint(resolved) || Math.hypot(Number(resolved.x) - x, Number(resolved.z) - z) > epsilonMeters) {
			return Object.freeze({
				clear: false,
				samples,
				reason: 'blocked',
				blockedAt: Object.freeze({ x: Number(x.toFixed(3)), z: Number(z.toFixed(3)) }),
			});
		}
	}
	return Object.freeze({ clear: true, samples, reason: 'clear', blockedAt: null });
}

/**
 * Cheap deterministic 2D perception probe for settlement guards. It deliberately has no scene
 * ownership: callers provide positions/yaw and an LOS boolean produced by their own world query.
 */
export function evaluateGuardStimulus({
	observer,
	target,
	yawRadians = 0,
	visionRangeMeters,
	fieldOfViewDegrees = DEFAULT_GUARD_PERCEPTION.fieldOfViewDegrees,
	peripheralRadiusMeters = DEFAULT_GUARD_PERCEPTION.peripheralRadiusMeters,
	hasLineOfSight = true,
} = {}) {
	if (!observer || !target || !Number.isFinite(visionRangeMeters) || visionRangeMeters <= 0) {
		return Object.freeze({ sensed: false, visible: false, distanceMeters: Infinity, angleDegrees: 180, reason: 'invalid' });
	}

	const dx = Number(target.x) - Number(observer.x);
	const dz = Number(target.z) - Number(observer.z);
	const distanceMeters = Math.hypot(dx, dz);
	if (!Number.isFinite(distanceMeters) || distanceMeters > visionRangeMeters) {
		return Object.freeze({ sensed: false, visible: false, distanceMeters, angleDegrees: 180, reason: 'range' });
	}

	// A guard should not ignore someone almost touching them just because that person is outside the
	// forward vision cone. Preserve at least 60% of the configured alert radius as close 360-degree
	// awareness; the explicit peripheral radius can only widen this, never shrink it.
	const closeAwarenessRadius = Math.max(0, peripheralRadiusMeters, visionRangeMeters * 0.6);
	const peripheral = distanceMeters <= closeAwarenessRadius;
	if (distanceMeters <= 1e-6) {
		return Object.freeze({ sensed: Boolean(hasLineOfSight), visible: Boolean(hasLineOfSight), distanceMeters: 0, angleDegrees: 0, reason: hasLineOfSight ? 'peripheral' : 'occluded' });
	}

	const yaw = normalizeYaw(yawRadians);
	const forwardX = Math.sin(yaw);
	const forwardZ = Math.cos(yaw);
	const invDistance = 1 / distanceMeters;
	const dot = Math.max(-1, Math.min(1, forwardX * dx * invDistance + forwardZ * dz * invDistance));
	const angleDegrees = Math.acos(dot) / DEG_TO_RAD;
	const withinCone = angleDegrees <= Math.max(1, Math.min(179, fieldOfViewDegrees)) * 0.5;
	const visible = Boolean(hasLineOfSight) && (peripheral || withinCone);
	return Object.freeze({
		sensed: visible,
		visible,
		distanceMeters,
		angleDegrees,
		reason: !hasLineOfSight ? 'occluded' : peripheral ? 'peripheral' : withinCone ? 'vision' : 'behind',
	});
}

/**
 * Stateful suspicion + last-seen memory. Suspicion memory can cool quickly while an independent
 * travel/search budget keeps the investigate intent alive long enough to actually reach lastSeen.
 */
export function createGuardPerception({
	visionRangeMeters,
	fieldOfViewDegrees = DEFAULT_GUARD_PERCEPTION.fieldOfViewDegrees,
	peripheralRadiusMeters = DEFAULT_GUARD_PERCEPTION.peripheralRadiusMeters,
	acquireSeconds = DEFAULT_GUARD_PERCEPTION.acquireSeconds,
	memorySeconds = DEFAULT_GUARD_PERCEPTION.memorySeconds,
	investigationSpeedMps = DEFAULT_GUARD_PERCEPTION.investigationSpeedMps,
	searchSeconds = DEFAULT_GUARD_PERCEPTION.searchSeconds,
	alertThreshold = DEFAULT_GUARD_PERCEPTION.alertThreshold,
} = {}) {
	let suspicion = 0;
	let memoryRemaining = 0;
	let investigationRemaining = 0;
	let investigationDuration = 0;
	let lastReason = 'none';
	let lastSeen = null;

	function update({ observer, target, yawRadians = 0, deltaSeconds = 0, hasLineOfSight = true } = {}) {
		const delta = Math.max(0, Math.min(0.25, Number(deltaSeconds) || 0));
		const probe = evaluateGuardStimulus({
			observer,
			target,
			yawRadians,
			visionRangeMeters,
			fieldOfViewDegrees,
			peripheralRadiusMeters,
			hasLineOfSight,
		});

		if (probe.sensed) {
			const proximity = 1 - Math.min(1, probe.distanceMeters / Math.max(0.001, visionRangeMeters));
			const rate = 1 / Math.max(0.05, acquireSeconds * (1.1 - proximity * 0.45));
			suspicion = clamp01(suspicion + delta * rate);
			memoryRemaining = Math.max(0, memorySeconds);
			const travelSpeed = Math.max(0.25, Number(investigationSpeedMps) || DEFAULT_GUARD_PERCEPTION.investigationSpeedMps);
			const searchBudget = Math.max(0, Number(searchSeconds) || 0);
			investigationDuration = Math.max(memoryRemaining, probe.distanceMeters / travelSpeed + searchBudget);
			investigationRemaining = investigationDuration;
			lastSeen = target ? { x: Number(target.x), z: Number(target.z) } : lastSeen;
			lastReason = probe.reason;
		} else {
			memoryRemaining = Math.max(0, memoryRemaining - delta);
			investigationRemaining = Math.max(0, investigationRemaining - delta);
			const calmSeconds = Math.max(0.25, Math.min(1.0, memorySeconds || 1));
			suspicion = clamp01(suspicion - delta / calmSeconds);
			lastReason = memoryRemaining > 0 ? 'memory' : probe.reason;
		}

		const threshold = clamp01(alertThreshold);
		const alerted = suspicion >= threshold;
		const intent = probe.sensed
			? (alerted ? 'alert' : 'observe')
			: (investigationRemaining > 0 && lastSeen ? 'investigate' : 'patrol');
		const memoryFraction = memorySeconds > 0 ? clamp01(memoryRemaining / memorySeconds) : 0;
		const investigationFraction = investigationDuration > 0 ? clamp01(investigationRemaining / investigationDuration) : 0;
		return Object.freeze({
			...probe,
			alerted,
			suspicion,
			memoryRemaining,
			memoryFraction,
			investigationRemaining,
			investigationFraction,
			intent,
			lastSeen: lastSeen ? Object.freeze({ ...lastSeen }) : null,
			reason: intent === 'investigate' ? 'memory' : lastReason,
		});
	}

	return Object.freeze({
		update,
		reset() {
			suspicion = 0;
			memoryRemaining = 0;
			investigationRemaining = 0;
			investigationDuration = 0;
			lastReason = 'none';
			lastSeen = null;
		},
		snapshot() {
			const memoryFraction = memorySeconds > 0 ? clamp01(memoryRemaining / memorySeconds) : 0;
			const investigationFraction = investigationDuration > 0 ? clamp01(investigationRemaining / investigationDuration) : 0;
			return Object.freeze({
				suspicion,
				memoryRemaining,
				memoryFraction,
				investigationRemaining,
				investigationFraction,
				lastSeen: lastSeen ? Object.freeze({ ...lastSeen }) : null,
				reason: lastReason,
			});
		},
	});
}
