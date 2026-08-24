import assert from 'node:assert/strict';
import { clampAltitudeAboveGround } from '../src/3d/gameplay/dragonFlightMath.js';
import { createDragonReactionState, stepDragonReactionState } from '../src/3d/gameplay/dragonReactionState.js';

function createDragon({ x = 0, y = 5, z = 0, yaw = 0 } = {}) {
	return {
		position: { x, y, z },
		rotation: { y: yaw },
		userData: {},
	};
}

function createReactionConfig(sampleGroundY) {
	return {
		canNotice: false,
		canDive: false,
		canPursue: true,
		canBite: false,
		noticeRadiusMeters: 0,
		reactiveSpeedMultiplier: 1,
		reactiveBankAngleRadians: 0,
		reactiveTransitionSeconds: 1,
		bankAngleRadians: 0,
		speedMps: 10,
		circleRadiusMeters: 20,
		alarmRadiusMeters: 0,
		diveTelegraphSeconds: 0,
		diveTelegraphTransitionSeconds: 1,
		diveTransitionSeconds: 1,
		attackTriggerSeconds: 0,
		attackTransitionSeconds: 1,
		clampedDiveLateralPullFraction: 0,
		diveDropMeters: 0,
		clampedAttackLateralPullFraction: 0,
		attackDropMeters: 0,
		pursuitRadiusMeters: 100,
		pursuitCenterSpeedMps: 0,
		centerX: 0,
		centerZ: 0,
		centerY: 20,
		pursuitCircleRadiusMeters: 20,
		pursuitTransitionSeconds: 1,
		pursuitMaxSeconds: 100,
		cruiseAltitudeAboveGroundMeters: 10,
		sampleGroundY,
		giveUpBankAngleMultiplier: 1,
		giveUpTransitionSeconds: 1,
		playerPosition: { x: 0, z: 0 },
	};
}

function runIsolatedInvalidCurrentSampleProof() {
	const dragon = createDragon({ y: 5, yaw: 0 });
	const visited = [];
	const sampleGroundY = (x, z) => {
		visited.push([x, z]);
		if (Math.abs(x) < 1e-9 && Math.abs(z) < 1e-9) return Number.NaN;
		if (Math.abs(z - 3) < 1e-9) return 7;
		return 0;
	};

	clampAltitudeAboveGround(dragon, sampleGroundY, 10);

	assert.equal(dragon.position.y, 17, 'a valid forward ridge must still clamp altitude when the current sample is NaN');
	assert.equal(dragon.userData.dragonTerrainInvalidSampleCount, 1, 'the isolated invalid current sample must be counted');
	assert.equal(dragon.userData.dragonTerrainSampleExceptionCount, 0, 'non-finite samples must not be misclassified as sampler exceptions');
	assert.equal(dragon.userData.dragonTerrainSampleCount, 13, 'default current + 12m lookahead work budget must remain unchanged');
	assert.ok(visited.some(([, z]) => Math.abs(z - 3) < 1e-9), 'the valid ridge probe must be reached');
}

function runThrowingCurrentSampleProof() {
	const dragon = createDragon({ y: 5, yaw: 0 });
	const visited = [];
	const sampleGroundY = (x, z) => {
		visited.push([x, z]);
		if (Math.abs(x) < 1e-9 && Math.abs(z) < 1e-9) throw new Error('terrain tile temporarily unavailable');
		if (Math.abs(z - 3) < 1e-9) return 7;
		return 0;
	};

	assert.doesNotThrow(() => clampAltitudeAboveGround(dragon, sampleGroundY, 10), 'an isolated terrain sampler exception must not abort the dragon update');
	assert.equal(dragon.position.y, 17, 'valid probes after a thrown current sample must still clamp to the ridge clearance');
	assert.equal(dragon.userData.dragonTerrainSampleExceptionCount, 1, 'the thrown probe must be exposed separately in telemetry');
	assert.equal(dragon.userData.dragonTerrainInvalidSampleCount, 1, 'a thrown probe must also count toward total invalid terrain samples');
	assert.equal(dragon.userData.dragonTerrainSampleCount, 13, 'exception recovery must not expand the bounded terrain work budget');
	assert.ok(visited.some(([, z]) => Math.abs(z - 3) < 1e-9), 'sampling must continue to later valid ridge probes after the exception');
}

function runThrowingPursuitCenterProof() {
	const state = createDragonReactionState(0, 0, 20, 0);
	const throwingConfig = createReactionConfig(() => { throw new Error('pursuit-center tile temporarily unavailable'); });

	assert.doesNotThrow(
		() => stepDragonReactionState(state, 0.5, 1, throwingConfig),
		'a throwing pursuit-center terrain sample must not abort the configured dragon update',
	);
	assert.equal(state.center.y, 20, 'a throwing pursuit-center sample must preserve the previous center altitude');
	assert.equal(state.pursuitCenterTerrainSampleExceptionCount, 1, 'pursuit-center sampler exceptions must be observable');
	assert.equal(state.pursuitCenterTerrainInvalidSampleCount, 1, 'a throwing pursuit-center sample must count as invalid');

	stepDragonReactionState(state, 0.5, 1, createReactionConfig(() => Number.NaN));
	assert.equal(state.center.y, 20, 'a non-finite pursuit-center sample must also preserve the previous center altitude');
	assert.equal(state.pursuitCenterTerrainSampleExceptionCount, 1, 'non-finite pursuit-center data must not be misclassified as an exception');
	assert.equal(state.pursuitCenterTerrainInvalidSampleCount, 2, 'non-finite pursuit-center data must be counted separately as invalid');

	stepDragonReactionState(state, 0.5, 1, createReactionConfig(() => 6));
	assert.equal(state.center.y, 16, 'the pursuit center must resume terrain following as soon as a finite sample returns');
}

function runTransientAllThrowingSafeAltitudeProof() {
	const dragon = createDragon({ y: 5, yaw: 0 });
	clampAltitudeAboveGround(dragon, () => 10, 10);
	assert.equal(dragon.position.y, 20, 'a finite terrain frame must establish the safe rendered altitude');
	assert.equal(dragon.userData.dragonTerrainLastSafeAltitudeY, 20, 'the last finite terrain frame must latch its safe rendered altitude');
	assert.equal(dragon.userData.dragonTerrainUsingSafeAltitudeFallback, false, 'finite terrain must not report fallback use');

	dragon.position.y = 6;
	assert.doesNotThrow(() => clampAltitudeAboveGround(dragon, () => { throw new Error('terrain provider unavailable'); }, 10));
	assert.equal(dragon.position.y, 20, 'an all-throwing transient terrain frame must not let an active dive descend below the last proven safe altitude');
	assert.equal(dragon.userData.dragonTerrainUsingSafeAltitudeFallback, true, 'transient all-throwing terrain must expose last-safe-altitude fallback use');
	assert.equal(dragon.userData.dragonTerrainSampleCount, 13, 'safe-altitude fallback must keep the normal bounded sample budget');
	assert.equal(dragon.userData.dragonTerrainSampleExceptionCount, 13, 'every failed probe must remain observable during fallback');

	dragon.position.y = 6;
	clampAltitudeAboveGround(dragon, () => 0, 10);
	assert.equal(dragon.position.y, 10, 'finite terrain recovery must release the transient fallback and resume the current terrain floor');
	assert.equal(dragon.userData.dragonTerrainUsingSafeAltitudeFallback, false, 'finite recovery must clear fallback telemetry');
	assert.equal(dragon.userData.dragonTerrainLastSafeAltitudeY, 10, 'finite recovery must refresh the safe rendered altitude latch');
}

function runDiscontinuityClearsSafeAltitudeLatchProof() {
	const dragon = createDragon({ y: 90, yaw: 0 });
	clampAltitudeAboveGround(dragon, () => 90, 10);
	assert.equal(dragon.position.y, 100, 'finite terrain must establish the old-location safe altitude before a discontinuity');
	assert.equal(dragon.userData.dragonTerrainLastSafeAltitudeY, 100, 'the old location must publish its proven safe altitude');

	dragon.userData.dragonPreviousRenderedX = 0;
	dragon.userData.dragonPreviousRenderedZ = 0;
	dragon.position.x = 0;
	dragon.position.z = 1200;
	dragon.position.y = 10;
	clampAltitudeAboveGround(dragon, () => Number.NaN, 10);
	assert.equal(dragon.userData.dragonTerrainSweepDiscontinuity, true, 'kilometre-scale retained displacement must be classified as a discontinuity');
	assert.equal(dragon.position.y, 10, 'an all-invalid discontinuity must not reuse the old-location safe altitude on the teleport frame');
	assert.equal(dragon.userData.dragonTerrainLastSafeAltitudeY, undefined, 'an all-invalid discontinuity must invalidate the old-location safe-altitude latch');
	assert.equal(dragon.userData.dragonTerrainUsingSafeAltitudeFallback, false, 'discontinuity frames must not report safe-altitude fallback use');

	dragon.userData.dragonPreviousRenderedX = dragon.position.x;
	dragon.userData.dragonPreviousRenderedZ = dragon.position.z;
	dragon.position.y = 8;
	clampAltitudeAboveGround(dragon, () => Number.NaN, 10);
	assert.equal(dragon.userData.dragonTerrainSweepDiscontinuity, false, 'the destination frame must return to ordinary retained-motion handling');
	assert.equal(dragon.position.y, 8, 'a post-discontinuity outage must not resurrect the invalidated old-location safe altitude');
	assert.equal(dragon.userData.dragonTerrainUsingSafeAltitudeFallback, false, 'post-discontinuity outages must remain fallback-free until new finite terrain proof exists');
}

function runAllThrowingFailSafeProof() {
	const dragon = createDragon({ y: 23, yaw: Math.PI / 2 });
	assert.doesNotThrow(() => clampAltitudeAboveGround(dragon, () => { throw new Error('terrain unavailable'); }, 10));

	assert.equal(dragon.position.y, 23, 'all-throwing terrain data with no prior safe latch must preserve the requested rendered altitude');
	assert.equal(dragon.userData.dragonTerrainUsingSafeAltitudeFallback, false, 'fallback must remain off until a finite terrain frame establishes a safe altitude');
	assert.equal(dragon.userData.dragonTerrainSampleCount, 13, 'all-throwing sampling must remain bounded');
	assert.equal(dragon.userData.dragonTerrainInvalidSampleCount, 13, 'every thrown probe must count as invalid');
	assert.equal(dragon.userData.dragonTerrainSampleExceptionCount, 13, 'every thrown probe must be observable as a sampler exception');
}

function runAllInvalidFailSafeProof() {
	const dragon = createDragon({ y: 23, yaw: Math.PI / 2 });
	clampAltitudeAboveGround(dragon, () => Number.NaN, 10);

	assert.equal(dragon.position.y, 23, 'all-invalid terrain data with no prior safe latch must preserve the requested rendered altitude instead of manufacturing ground');
	assert.equal(dragon.userData.dragonTerrainUsingSafeAltitudeFallback, false, 'all-invalid data must not claim fallback without prior finite proof');
	assert.equal(dragon.userData.dragonTerrainSampleCount, 13, 'all-invalid sampling must stay within the normal bounded budget');
	assert.equal(dragon.userData.dragonTerrainInvalidSampleCount, 13, 'every invalid terrain probe must be observable');
	assert.equal(dragon.userData.dragonTerrainSampleExceptionCount, 0, 'non-finite terrain data must remain distinct from thrown sampler faults');
}

function runFiniteCompatibilityProof() {
	const dragon = createDragon({ y: 2, yaw: 0 });
	clampAltitudeAboveGround(dragon, (_x, z) => (z >= 4 && z <= 5 ? 6 : 1), 8);

	assert.equal(dragon.position.y, 14, 'finite terrain behavior must preserve the highest-ground + clearance contract');
	assert.equal(dragon.userData.dragonTerrainLastSafeAltitudeY, 14, 'finite terrain must publish the proven safe rendered altitude');
	assert.equal(dragon.userData.dragonTerrainUsingSafeAltitudeFallback, false, 'ordinary finite terrain must not use fallback');
	assert.equal(dragon.userData.dragonTerrainInvalidSampleCount, 0, 'finite terrain must report zero invalid probes');
	assert.equal(dragon.userData.dragonTerrainSampleExceptionCount, 0, 'finite terrain must report zero sampler exceptions');
}

runIsolatedInvalidCurrentSampleProof();
runThrowingCurrentSampleProof();
runThrowingPursuitCenterProof();
runTransientAllThrowingSafeAltitudeProof();
runDiscontinuityClearsSafeAltitudeLatchProof();
runAllThrowingFailSafeProof();
runAllInvalidFailSafeProof();
runFiniteCompatibilityProof();

console.log('DRAGON_TERRAIN_SAMPLE_RESILIENCE_PASS');