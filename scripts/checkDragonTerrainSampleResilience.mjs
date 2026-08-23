import assert from 'node:assert/strict';
import { clampAltitudeAboveGround } from '../src/3d/gameplay/dragonFlightMath.js';

function createDragon({ x = 0, y = 5, z = 0, yaw = 0 } = {}) {
	return {
		position: { x, y, z },
		rotation: { y: yaw },
		userData: {},
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

function runAllThrowingFailSafeProof() {
	const dragon = createDragon({ y: 23, yaw: Math.PI / 2 });
	assert.doesNotThrow(() => clampAltitudeAboveGround(dragon, () => { throw new Error('terrain unavailable'); }, 10));

	assert.equal(dragon.position.y, 23, 'all-throwing terrain data must preserve the rendered altitude');
	assert.equal(dragon.userData.dragonTerrainSampleCount, 13, 'all-throwing sampling must remain bounded');
	assert.equal(dragon.userData.dragonTerrainInvalidSampleCount, 13, 'every thrown probe must count as invalid');
	assert.equal(dragon.userData.dragonTerrainSampleExceptionCount, 13, 'every thrown probe must be observable as a sampler exception');
}

function runAllInvalidFailSafeProof() {
	const dragon = createDragon({ y: 23, yaw: Math.PI / 2 });
	clampAltitudeAboveGround(dragon, () => Number.NaN, 10);

	assert.equal(dragon.position.y, 23, 'all-invalid terrain data must preserve the rendered altitude instead of manufacturing ground');
	assert.equal(dragon.userData.dragonTerrainSampleCount, 13, 'all-invalid sampling must stay within the normal bounded budget');
	assert.equal(dragon.userData.dragonTerrainInvalidSampleCount, 13, 'every invalid terrain probe must be observable');
	assert.equal(dragon.userData.dragonTerrainSampleExceptionCount, 0, 'non-finite terrain data must remain distinct from thrown sampler faults');
}

function runFiniteCompatibilityProof() {
	const dragon = createDragon({ y: 2, yaw: 0 });
	clampAltitudeAboveGround(dragon, (_x, z) => (z >= 4 && z <= 5 ? 6 : 1), 8);

	assert.equal(dragon.position.y, 14, 'finite terrain behavior must preserve the highest-ground + clearance contract');
	assert.equal(dragon.userData.dragonTerrainInvalidSampleCount, 0, 'finite terrain must report zero invalid probes');
	assert.equal(dragon.userData.dragonTerrainSampleExceptionCount, 0, 'finite terrain must report zero sampler exceptions');
}

runIsolatedInvalidCurrentSampleProof();
runThrowingCurrentSampleProof();
runAllThrowingFailSafeProof();
runAllInvalidFailSafeProof();
runFiniteCompatibilityProof();

console.log('DRAGON_TERRAIN_SAMPLE_RESILIENCE_PASS');
