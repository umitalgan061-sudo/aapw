/**
 * Kızıl Ufuk — deterministic camera-intent record/replay contract.
 *
 * The replay layer records already-normalized player camera inputs and the resulting intent digest.
 * It is deliberately a data contract: it does not own a renderer, clock, camera, controls, scene,
 * terrain, NPCs, equipment mutation or asset loading. It is useful for regression, PWA parity and
 * browser evidence because a replay can be reproduced without depending on wall-clock timing.
 *
 * @module gameplay/playerCombatCameraReplayContract
 */

const VERSION = 1;
const DEFAULT_MAX_FRAMES = 240;
const clamp = (value, min, max) => Math.max(min, Math.min(max, Number.isFinite(Number(value)) ? Number(value) : min));
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const round = (value, precision = 4) => {
	const factor = 10 ** precision;
	return Math.round(finite(value) * factor) / factor;
};

function stableStringify(value) {
	if (value === null || value === undefined) return 'null';
	if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '0';
	if (typeof value === 'boolean') return value ? 'true' : 'false';
	if (typeof value === 'string') return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
	return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

function digest(value) {
	let hash = 2166136261;
	const source = stableStringify(value);
	for (let index = 0; index < source.length; index += 1) {
		hash ^= source.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}
	return (hash >>> 0).toString(16).padStart(8, '0');
}

function cloneFrame(frame, index) {
	return Object.freeze({
		index,
		deltaSeconds: clamp(frame?.deltaSeconds, 0, 0.25),
		motion: frame?.motion ?? null,
		attackWindow: frame?.attackWindow ?? null,
		combatFeedback: frame?.combatFeedback ?? null,
		target: frame?.target ?? null,
		collisionProbe: frame?.collisionProbe ?? null,
		lookInput: Object.freeze({ x: clamp(frame?.lookInput?.x, -1, 1), y: clamp(frame?.lookInput?.y, -1, 1) }),
		shoulderSwap: frame?.shoulderSwap,
		lockOnEnabled: frame?.lockOnEnabled,
	});
}

export function createCameraIntentRecorder(options = {}) {
	const maxFrames = clamp(Math.floor(finite(options.maxFrames, DEFAULT_MAX_FRAMES)), 1, 2000);
	const frames = [];
	let disposed = false;

	function assertActive() {
		if (disposed) throw new Error('PlayerCombatCameraIntentRecorder disposed');
	}

	function record(frame) {
		assertActive();
		if (frames.length >= maxFrames) frames.shift();
		frames.push(cloneFrame(frame, frames.length));
		return frames.length;
	}

	function clear() {
		assertActive();
		frames.length = 0;
	}

	function snapshot() {
		assertActive();
		const payload = Object.freeze({ version: VERSION, frameCount: frames.length, frames: Object.freeze(frames.slice()) });
		return Object.freeze({ ...payload, digest: digest(payload) });
	}

	function dispose() {
		disposed = true;
		frames.length = 0;
	}

	return Object.freeze({ version: VERSION, maxFrames, record, clear, snapshot, dispose });
}

export function createCameraIntentReplay(frames = []) {
	const normalized = Array.isArray(frames) ? frames.slice(0, DEFAULT_MAX_FRAMES).map(cloneFrame) : [];
	const payload = Object.freeze({ version: VERSION, frameCount: normalized.length, frames: Object.freeze(normalized) });
	return Object.freeze({ ...payload, digest: digest(payload) });
}

export function replayWithDirector(replay, director) {
	if (!replay || replay.version !== VERSION) throw new RangeError('unsupported camera replay version');
	if (!director || typeof director.update !== 'function') throw new TypeError('camera director required');
	const snapshots = [];
	for (const frame of replay.frames) {
		snapshots.push(director.update(frame.deltaSeconds, {
			motion: frame.motion ?? undefined,
			attackWindow: frame.attackWindow ?? undefined,
			combatFeedback: frame.combatFeedback ?? undefined,
			target: frame.target ?? undefined,
			collisionProbe: frame.collisionProbe ?? undefined,
			lookInput: frame.lookInput,
		}));
		if (frame.shoulderSwap !== undefined) director.setShoulderSwap(frame.shoulderSwap);
		if (frame.lockOnEnabled !== undefined) director.setLockOnEnabled(frame.lockOnEnabled);
	}
	return Object.freeze({
		version: VERSION,
		frameCount: snapshots.length,
		firstDigest: snapshots[0]?.digest ?? null,
		lastDigest: snapshots.at(-1)?.digest ?? null,
		digest: digest(snapshots.map((snapshot) => snapshot.digest)),
		snapshots: Object.freeze(snapshots),
	});
}

export function compareCameraReplayResults(left, right) {
	const leftRows = Array.isArray(left?.snapshots) ? left.snapshots : [];
	const rightRows = Array.isArray(right?.snapshots) ? right.snapshots : [];
	const length = Math.max(leftRows.length, rightRows.length);
	let firstMismatch = -1;
	for (let index = 0; index < length; index += 1) {
		if (leftRows[index]?.digest !== rightRows[index]?.digest) { firstMismatch = index; break; }
	}
	return Object.freeze({
		equal: firstMismatch < 0 && leftRows.length === rightRows.length,
		firstMismatch,
		leftFrames: leftRows.length,
		rightFrames: rightRows.length,
		leftDigest: left?.digest ?? null,
		rightDigest: right?.digest ?? null,
	});
}

export function summarizeReplay(replay) {
	if (!replay || replay.version !== VERSION) return Object.freeze({ version: VERSION, valid: false, frameCount: 0, digest: digest(null) });
	const states = [...new Set(replay.frames.map((frame) => frame.motion?.state).filter(Boolean))].sort();
	const attacks = replay.frames.filter((frame) => frame.attackWindow?.kind && frame.attackWindow.kind !== 'none').length;
	const feedbacks = replay.frames.filter((frame) => frame.combatFeedback?.outcome).length;
	const targeted = replay.frames.filter((frame) => frame.target).length;
	const collided = replay.frames.filter((frame) => frame.collisionProbe?.occluded).length;
	return Object.freeze({
		version: VERSION,
		valid: true,
		frameCount: replay.frames.length,
		states: Object.freeze(states),
		attackFrames: attacks,
		feedbackFrames: feedbacks,
		targetFrames: targeted,
		collisionFrames: collided,
		digest: replay.digest,
	});
}

export const PLAYER_COMBAT_CAMERA_REPLAY_VERSION = VERSION;
export const __testing = Object.freeze({ stableStringify, digest, cloneFrame });
