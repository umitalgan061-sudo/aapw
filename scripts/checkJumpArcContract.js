import assert from 'node:assert/strict';
import fs from 'node:fs';

const physicsSource = fs.readFileSync(new URL('../src/3d/physics.js', import.meta.url), 'utf8');
const marker = 'export function integrateJumpArc';
const functionStart = physicsSource.indexOf(marker);
assert.notEqual(functionStart, -1, 'physics.js must export integrateJumpArc');

const bodyStart = physicsSource.indexOf('{', functionStart);
assert.notEqual(bodyStart, -1, 'integrateJumpArc must have a function body');
let braceDepth = 0;
let functionEnd = -1;
for (let index = bodyStart; index < physicsSource.length; index += 1) {
	if (physicsSource[index] === '{') braceDepth += 1;
	if (physicsSource[index] === '}') braceDepth -= 1;
	if (braceDepth === 0) {
		functionEnd = index;
		break;
	}
}
assert.notEqual(functionEnd, -1, 'integrateJumpArc function body must be balanced');

const functionSource = physicsSource.slice(functionStart, functionEnd + 1).replace(/^export\s+/, '');
const integrateJumpArc = new Function(`${functionSource}\nreturn integrateJumpArc;`)();

const EPSILON = 1e-9;
const approxEqual = (actual, expected, message) => {
	assert.ok(Math.abs(actual - expected) <= EPSILON, `${message}: expected ${expected}, got ${actual}`);
};

const gravityMps2 = -20;

const standing = integrateJumpArc(0, 0, 1 / 60, gravityMps2);
assert.deepEqual(
	standing,
	{ heightAboveGroundMeters: 0, velocityYMps: 0, isGrounded: true },
	'standing state must stay clamped to the ground',
);

const launchStep = integrateJumpArc(0, 8, 0.1, gravityMps2);
approxEqual(launchStep.velocityYMps, 6, 'gravity must be applied before height integration');
approxEqual(launchStep.heightAboveGroundMeters, 0.6, 'launch height must follow semi-implicit Euler integration');
assert.equal(launchStep.isGrounded, false, 'a positive jump step must remain airborne');

const descentStep = integrateJumpArc(1, -2, 0.1, gravityMps2);
approxEqual(descentStep.velocityYMps, -4, 'descending velocity must continue accelerating downward');
approxEqual(descentStep.heightAboveGroundMeters, 0.6, 'descending height must remain above ground before landing');
assert.equal(descentStep.isGrounded, false, 'positive remaining height must stay airborne');

const exactLanding = integrateJumpArc(0.2, -1, 0.1, -10);
assert.deepEqual(
	exactLanding,
	{ heightAboveGroundMeters: 0, velocityYMps: 0, isGrounded: true },
	'exact ground contact must clamp height/velocity and report grounded',
);

const overstepLanding = integrateJumpArc(0.05, -1, 0.1, gravityMps2);
assert.deepEqual(
	overstepLanding,
	{ heightAboveGroundMeters: 0, velocityYMps: 0, isGrounded: true },
	'landing integration must never leave a negative penetration height or downward velocity',
);

function simulateArc() {
	let heightAboveGroundMeters = 0;
	let velocityYMps = 8;
	let isGrounded = false;
	let maxHeight = 0;
	let airborneFrames = 0;
	const snapshots = [];

	for (let frame = 0; frame < 300; frame += 1) {
		const next = integrateJumpArc(heightAboveGroundMeters, velocityYMps, 1 / 60, gravityMps2);
		heightAboveGroundMeters = next.heightAboveGroundMeters;
		velocityYMps = next.velocityYMps;
		isGrounded = next.isGrounded;
		maxHeight = Math.max(maxHeight, heightAboveGroundMeters);
		snapshots.push([heightAboveGroundMeters, velocityYMps, isGrounded]);
		if (!isGrounded) airborneFrames += 1;
		if (isGrounded) break;
	}

	return { heightAboveGroundMeters, velocityYMps, isGrounded, maxHeight, airborneFrames, snapshots };
}

const firstArc = simulateArc();
assert.equal(firstArc.isGrounded, true, 'a finite jump must eventually land');
assert.equal(firstArc.heightAboveGroundMeters, 0, 'landed arc must end at zero height');
assert.equal(firstArc.velocityYMps, 0, 'landed arc must end with zero vertical velocity');
assert.ok(firstArc.maxHeight > 0, 'jump simulation must actually leave the ground');
assert.ok(firstArc.airborneFrames > 1, 'jump must remain airborne across multiple frames');

const secondArc = simulateArc();
assert.deepEqual(secondArc.snapshots, firstArc.snapshots, 'same inputs must produce a deterministic jump trajectory');

console.log(
	`[checkJumpArcContract] PASS: source-isolated semi-implicit launch/descent, landing clamp, eventual landing and deterministic trajectory (${firstArc.airborneFrames} airborne frames).`,
);
