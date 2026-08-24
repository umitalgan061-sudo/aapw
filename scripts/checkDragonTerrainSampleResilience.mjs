import assert from 'node:assert/strict';
import { clampAltitudeAboveGround } from '../src/3d/gameplay/dragonFlightMath.js';
import { createDragonReactionState, stepDragonReactionState } from '../src/3d/gameplay/dragonReactionState.js';

function createDragon({ x = 0, y = 5, z = 0, yaw = 0 } = {}) {
	return { position: { x, y, z }, rotation: { y: yaw }, userData: {} };
}

function createReactionConfig(sampleGroundY) {
	return {
		canNotice: false, canDive: false, canPursue: true, canBite: false,
		noticeRadiusMeters: 0, reactiveSpeedMultiplier: 1, reactiveBankAngleRadians: 0,
		reactiveTransitionSeconds: 1, bankAngleRadians: 0, speedMps: 10, circleRadiusMeters: 20,
		alarmRadiusMeters: 0, diveTelegraphSeconds: 0, diveTelegraphTransitionSeconds: 1,
		diveTransitionSeconds: 1, attackTriggerSeconds: 0, attackTransitionSeconds: 1,
		clampedDiveLateralPullFraction: 0, diveDropMeters: 0, clampedAttackLateralPullFraction: 0,
		attackDropMeters: 0, pursuitRadiusMeters: 100, pursuitCenterSpeedMps: 0,
		centerX: 0, centerZ: 0, centerY: 20, pursuitCircleRadiusMeters: 20,
		pursuitTransitionSeconds: 1, pursuitMaxSeconds: 100, cruiseAltitudeAboveGroundMeters: 10,
		sampleGroundY, giveUpBankAngleMultiplier: 1, giveUpTransitionSeconds: 1,
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
	assert.equal(dragon.userData.dragonTerrainInvalidSampleCount, 1);
	assert.equal(dragon.userData.dragonTerrainSampleExceptionCount, 0);
	assert.equal(dragon.userData.dragonTerrainSampleCount, 13);
	assert.ok(visited.some(([, z]) => Math.abs(z - 3) < 1e-9));
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
	assert.equal(dragon.position.y, 17);
	assert.equal(dragon.userData.dragonTerrainSampleExceptionCount, 1);
	assert.equal(dragon.userData.dragonTerrainInvalidSampleCount, 1);
	assert.equal(dragon.userData.dragonTerrainSampleCount, 13);
	assert.ok(visited.some(([, z]) => Math.abs(z - 3) < 1e-9));
}

function runThrowingPursuitCenterProof() {
	const state = createDragonReactionState(0, 0, 20, 0);
	const throwingConfig = createReactionConfig(() => { throw new Error('pursuit-center tile temporarily unavailable'); });
	assert.doesNotThrow(() => stepDragonReactionState(state, 0.5, 1, throwingConfig), 'a throwing pursuit-center terrain sample must not abort the configured dragon update');
	assert.equal(state.center.y, 20);
	assert.equal(state.pursuitCenterTerrainSampleExceptionCount, 1);
	assert.equal(state.pursuitCenterTerrainInvalidSampleCount, 1);
	stepDragonReactionState(state, 0.5, 1, createReactionConfig(() => Number.NaN));
	assert.equal(state.center.y, 20);
	assert.equal(state.pursuitCenterTerrainSampleExceptionCount, 1);
	assert.equal(state.pursuitCenterTerrainInvalidSampleCount, 2);
	stepDragonReactionState(state, 0.5, 1, createReactionConfig(() => 6));
	assert.equal(state.center.y, 16);
}

function runTransientAllThrowingSafeAltitudeProof() {
	const dragon = createDragon({ y: 5, yaw: 0 });
	clampAltitudeAboveGround(dragon, () => 10, 10);
	assert.equal(dragon.position.y, 20, 'a finite terrain frame must establish the safe rendered altitude');
	assert.equal(dragon.userData.dragonTerrainLastSafeAltitudeY, 20);
	assert.equal(dragon.userData.dragonTerrainUsingSafeAltitudeFallback, false);
	dragon.position.y = 6;
	assert.doesNotThrow(() => clampAltitudeAboveGround(dragon, () => { throw new Error('terrain provider unavailable'); }, 10));
	assert.equal(dragon.position.y, 20, 'an all-throwing transient terrain frame must not let an active dive descend below the last proven safe altitude');
	assert.equal(dragon.userData.dragonTerrainUsingSafeAltitudeFallback, true);
	assert.equal(dragon.userData.dragonTerrainSampleCount, 13);
	assert.equal(dragon.userData.dragonTerrainSampleExceptionCount, 13);
	dragon.position.y = 6;
	clampAltitudeAboveGround(dragon, () => 0, 10);
	assert.equal(dragon.position.y, 10, 'finite terrain recovery must release the transient fallback and resume the current terrain floor');
	assert.equal(dragon.userData.dragonTerrainUsingSafeAltitudeFallback, false);
	assert.equal(dragon.userData.dragonTerrainLastSafeAltitudeY, 10);
}

function runDiscontinuityClearsSafeAltitudeLatchProof() {
	const dragon = createDragon({ y: 90, yaw: 0 });
	clampAltitudeAboveGround(dragon, () => 90, 10);
	assert.equal(dragon.position.y, 100);
	assert.equal(dragon.userData.dragonTerrainLastSafeAltitudeY, 100);
	dragon.userData.dragonPreviousRenderedX = 0;
	dragon.userData.dragonPreviousRenderedZ = 0;
	dragon.position.x = 0;
	dragon.position.z = 1200;
	dragon.position.y = 10;
	clampAltitudeAboveGround(dragon, () => Number.NaN, 10);
	assert.equal(dragon.userData.dragonTerrainSweepDiscontinuity, true, 'kilometre-scale retained displacement must be classified as a discontinuity');
	assert.equal(dragon.position.y, 10);
	assert.equal(dragon.userData.dragonTerrainLastSafeAltitudeY, undefined, 'an all-invalid discontinuity must invalidate the old-location safe-altitude latch');
	assert.equal(dragon.userData.dragonTerrainUsingSafeAltitudeFallback, false);
	dragon.userData.dragonPreviousRenderedX = dragon.position.x;
	dragon.userData.dragonPreviousRenderedZ = dragon.position.z;
	dragon.position.y = 8;
	clampAltitudeAboveGround(dragon, () => Number.NaN, 10);
	assert.equal(dragon.userData.dragonTerrainSweepDiscontinuity, false);
	assert.equal(dragon.position.y, 8, 'a post-discontinuity outage must not resurrect the invalidated old-location safe altitude');
	assert.equal(dragon.userData.dragonTerrainUsingSafeAltitudeFallback, false);
}

function runAllThrowingFailSafeProof() {
	const dragon = createDragon({ y: 23, yaw: Math.PI / 2 });
	assert.doesNotThrow(() => clampAltitudeAboveGround(dragon, () => { throw new Error('terrain unavailable'); }, 10));
	assert.equal(dragon.position.y, 23, 'all-throwing terrain data with no prior safe latch must preserve the requested rendered altitude');
	assert.equal(dragon.userData.dragonTerrainUsingSafeAltitudeFallback, false);
	assert.equal(dragon.userData.dragonTerrainSampleCount, 13);
	assert.equal(dragon.userData.dragonTerrainInvalidSampleCount, 13);
	assert.equal(dragon.userData.dragonTerrainSampleExceptionCount, 13);
}

function runAllInvalidFailSafeProof() {
	const dragon = createDragon({ y: 23, yaw: Math.PI / 2 });
	clampAltitudeAboveGround(dragon, () => Number.NaN, 10);
	assert.equal(dragon.position.y, 23, 'all-invalid terrain data with no prior safe latch must preserve the requested rendered altitude instead of manufacturing ground');
	assert.equal(dragon.userData.dragonTerrainUsingSafeAltitudeFallback, false);
	assert.equal(dragon.userData.dragonTerrainSampleCount, 13);
	assert.equal(dragon.userData.dragonTerrainInvalidSampleCount, 13);
	assert.equal(dragon.userData.dragonTerrainSampleExceptionCount, 0);
}

function runFiniteCompatibilityProof() {
	const dragon = createDragon({ y: 2, yaw: 0 });
	clampAltitudeAboveGround(dragon, (_x, z) => (z >= 4 && z <= 5 ? 6 : 1), 8);
	assert.equal(dragon.position.y, 14);
	assert.equal(dragon.userData.dragonTerrainLastSafeAltitudeY, 14);
	assert.equal(dragon.userData.dragonTerrainUsingSafeAltitudeFallback, false);
	assert.equal(dragon.userData.dragonTerrainInvalidSampleCount, 0);
	assert.equal(dragon.userData.dragonTerrainSampleExceptionCount, 0);
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