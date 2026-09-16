/**
 * Velocity-aware spatial audio motion policy.
 *
 * Converts explicit source velocity and listener velocity into bounded Doppler guidance and motion gain.
 * The audio system does not calculate physics; it consumes the same authoritative velocities already used
 * by movement/animation code. This keeps audio synchronized with gameplay while preventing extreme values
 * from producing unstable pitch shifts.
 */

const DEFAULTS = Object.freeze({ minPitch: 0.82, maxPitch: 1.2, maxRelativeSpeed: 85, speedOfSound: 343, motionGainFloor: 0.35 });
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const finiteOr = (value, fallback) => Number.isFinite(value) ? value : fallback;
const freeze = (value) => { if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value; Object.freeze(value); for (const child of Object.values(value)) freeze(child); return value; };
function vector(v) { return { x: finiteOr(v?.x, 0), y: finiteOr(v?.y, 0), z: finiteOr(v?.z, 0) }; }
function magnitude(v) { return Math.hypot(v.x, v.y, v.z); }
function dot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
function sub(a, b) { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }

export function computeRelativeVelocity(sourceVelocity, listenerVelocity) {
	const relative = sub(vector(sourceVelocity), vector(listenerVelocity));
	return freeze({ vector: relative, magnitude: Number(magnitude(relative).toFixed(5)) });
}

export function computeDopplerPitch({ sourceVelocity, listenerVelocity, sourceToListener = { x: 0, y: 0, z: 1 }, speedOfSound = DEFAULTS.speedOfSound, maxRelativeSpeed = DEFAULTS.maxRelativeSpeed, minPitch = DEFAULTS.minPitch, maxPitch = DEFAULTS.maxPitch } = {}) {
	const source = vector(sourceVelocity);
	const listener = vector(listenerVelocity);
	const direction = vector(sourceToListener);
	const directionLength = magnitude(direction) || 1;
	const unit = { x: direction.x / directionLength, y: direction.y / directionLength, z: direction.z / directionLength };
	const relative = sub(source, listener);
	const radial = clamp(dot(relative, unit), -Math.abs(maxRelativeSpeed), Math.abs(maxRelativeSpeed));
	const safeSound = Math.max(80, finiteOr(speedOfSound, DEFAULTS.speedOfSound));
	const denominator = Math.max(0.2, safeSound - radial);
	const rawPitch = safeSound / denominator;
	const pitch = clamp(rawPitch, finiteOr(minPitch, DEFAULTS.minPitch), finiteOr(maxPitch, DEFAULTS.maxPitch));
	return freeze({ version: 1, radialSpeed: Number(radial.toFixed(5)), relativeSpeed: Number(magnitude(relative).toFixed(5)), pitch: Number(pitch.toFixed(6)), clamped: pitch !== rawPitch });
}

export function computeMotionGain({ sourceVelocity, listenerVelocity, maxSpeed = 85, floor = DEFAULTS.motionGainFloor } = {}) {
	const relative = computeRelativeVelocity(sourceVelocity, listenerVelocity);
	const normalized = clamp(relative.magnitude / Math.max(1, finiteOr(maxSpeed, DEFAULTS.maxRelativeSpeed)), 0, 1);
	const gain = 1 - normalized * (1 - clamp(finiteOr(floor, DEFAULTS.motionGainFloor), 0, 1));
	return freeze({ version: 1, gain: Number(gain.toFixed(6)), normalizedSpeed: Number(normalized.toFixed(5)), relativeSpeed: relative.magnitude });
}

export function motionPolicyDefaults() { return freeze(DEFAULTS); }
