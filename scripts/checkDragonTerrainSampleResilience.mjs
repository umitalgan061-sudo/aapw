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
	assert.equal(dragon.userData.dragonTerrainSampleCount, 13, 'default current + 12m lookahead work budget must remain unchanged');
	assert.ok(visited.some(([, z]) => Math.abs(z - 3) < 1e-9), 'the valid ridge probe must be reached');
}

function runAllInvalidFailSafeProof() {
	const dragon = createDragon({ y: 23, yaw: Math.PI / 2 });
	clampAltitudeAboveGround(dragon, () => Number.NaN, 10);

	assert.equal(dragon.position.y, 23, 'all-invalid terrain data must preserve the rendered altitude instead of manufacturing ground');
	assert.equal(dragon.userData.dragonTerrainSampleCount, 13, 'all-invalid sampling must stay within the normal bounded budget');
	assert.equal(dragon.userData.dragonTerrainInvalidSampleCount, 13, 'every invalid terrain probe must be observable');
}

function runFiniteCompatibilityProof() {
	const dragon = createDragon({ y: 2, yaw: 0 });
	clampAltitudeAboveGround(dragon, (_x, z) => (z >= 4 && z <= 5 ? 6 : 1), 8);

	assert.equal(dragon.position.y, 14, 'finite terrain behavior must preserve the highest-ground + clearance contract');
	assert.equal(dragon.userData.dragonTerrainInvalidSampleCount, 0, 'finite terrain must report zero invalid probes');
}

runIsolatedInvalidCurrentSampleProof();
runAllInvalidFailSafeProof();
runFiniteCompatibilityProof();

console.log('DRAGON_TERRAIN_SAMPLE_RESILIENCE_PASS');
