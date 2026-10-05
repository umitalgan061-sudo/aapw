/** Production TypeScript owner for src/3d/input.js. Legacy .js remains compatibility-only. */
// @ts-nocheck
/**
 * Keyboard/mouse/gamepad input state tracking for the playable third-person controller.
 * Direction/run/jump/guard keep their existing contracts. Melee attacks are edge-triggered combat
 * intents shared with touch so Player remains the single gameplay state machine.
 * @module input
 */


export const PLAYER_INPUT_CONTRACT_VERSION = '2026-10-05-v1' as const;
export type PlayerInputAction = 'jump' | 'dodge' | 'light' | 'heavy' | 'parry' | 'lock-on';
export type PlayerInputDevice = 'keyboard' | 'mouse' | 'gamepad' | 'touch' | 'unknown';

export interface PlayerInputAxis {
	readonly x: number;
	readonly y: number;
	readonly magnitude: number;
}

export interface PlayerInputActionRecord {
	readonly sequence: number;
	readonly action: PlayerInputAction;
	readonly device: PlayerInputDevice;
	readonly timestampSeconds: number;
	readonly expiresAtSeconds: number;
	readonly source: string;
}

export interface PlayerInputFrame {
	readonly version: typeof PLAYER_INPUT_CONTRACT_VERSION;
	readonly sequence: number;
	readonly timestampSeconds: number;
	readonly device: PlayerInputDevice;
	readonly forward: number;
	readonly strafe: number;
	readonly magnitude: number;
	readonly lookX: number;
	readonly lookY: number;
	readonly lookMagnitude: number;
	readonly cameraZoom: number;
	readonly running: boolean;
	readonly guarding: boolean;
	readonly jumpRequested: boolean;
	readonly lockOnRequested: boolean;
	readonly dodgeRequested: boolean;
	readonly parryRequested: boolean;
	readonly lightRequested: boolean;
	readonly heavyRequested: boolean;
	readonly actionCount: number;
}

export interface PlayerCombatFeedbackDetail {
	readonly serial?: unknown;
	readonly outcome?: unknown;
	readonly appliedAmount?: unknown;
	readonly blockedAmount?: unknown;
	readonly source?: unknown;
}

export interface GamepadButtonState {
	readonly jump: boolean;
	readonly dodge: boolean;
	readonly light: boolean;
	readonly heavy: boolean;
	readonly parry: boolean;
	readonly lockOn: boolean;
}

export interface GamepadSample {
	readonly forward: number;
	readonly strafe: number;
	readonly magnitude: number;
	readonly lookX: number;
	readonly lookY: number;
	readonly lookMagnitude: number;
	readonly cameraZoom: number;
	readonly running: boolean;
	readonly guarding: boolean;
	readonly jumpPressed: boolean;
	readonly dodgePressed: boolean;
	readonly lightPressed: boolean;
	readonly heavyPressed: boolean;
	readonly parryPressed: boolean;
	readonly lockOnPressed: boolean;
	readonly buttons: GamepadButtonState;
	readonly lookDeltaSeconds?: number;
}

interface PlayerInputTarget extends EventTarget {
	readonly hidden?: boolean;
}

interface GamepadHapticProfile {
	readonly duration: number;
	readonly weakMagnitude: number;
	readonly strongMagnitude: number;
}

interface GamepadHapticActuatorLike {
	playEffect: (type: string, params: Record<string, number>) => Promise<unknown>;
}

function finiteInput(value: unknown, fallback = 0): number {
	const numeric = Number(value);
	return Number.isFinite(numeric) ? numeric : fallback;
}

export function normalizePlayerInputAxis(x: unknown, y: unknown, deadzone = GAMEPAD_DEADZONE): PlayerInputAxis {
	const nx = Math.max(-1, Math.min(1, finiteInput(x)));
	const ny = Math.max(-1, Math.min(1, finiteInput(y)));
	const magnitude = Math.min(1, Math.hypot(nx, ny));
	if (magnitude <= Math.max(0, Math.min(0.95, finiteInput(deadzone, GAMEPAD_DEADZONE))) || magnitude === 0) {
		return Object.freeze({ x: 0, y: 0, magnitude: 0 });
	}
	const normalizedDeadzone = Math.max(0, Math.min(0.95, finiteInput(deadzone, GAMEPAD_DEADZONE)));
	const remappedMagnitude = Math.min(1, (magnitude - normalizedDeadzone) / (1 - normalizedDeadzone));
	const scale = remappedMagnitude / magnitude;
	return Object.freeze({
		x: Number((nx * scale).toFixed(6)),
		y: Number((ny * scale).toFixed(6)),
		magnitude: Number(remappedMagnitude.toFixed(6)),
	});
}

export function normalizePlayerInputFrame(input: Partial<PlayerInputFrame> = {}): PlayerInputFrame {
	const forward = Math.max(-1, Math.min(1, finiteInput(input.forward)));
	const strafe = Math.max(-1, Math.min(1, finiteInput(input.strafe)));
	const magnitude = Math.min(1, Math.hypot(forward, strafe));
	const lookX = Math.max(-1, Math.min(1, finiteInput(input.lookX)));
	const lookY = Math.max(-1, Math.min(1, finiteInput(input.lookY)));
	return Object.freeze({
		version: PLAYER_INPUT_CONTRACT_VERSION,
		sequence: Number.isSafeInteger(input.sequence) && (input.sequence as number) > 0 ? input.sequence as number : 0,
		timestampSeconds: Math.max(0, finiteInput(input.timestampSeconds)),
		device: input.device ?? 'unknown',
		forward: Number(forward.toFixed(6)),
		strafe: Number(strafe.toFixed(6)),
		magnitude: Number(Math.min(1, magnitude).toFixed(6)),
		lookX: Number(lookX.toFixed(6)),
		lookY: Number(lookY.toFixed(6)),
		lookMagnitude: Number(Math.min(1, finiteInput(input.lookMagnitude)).toFixed(6)),
		cameraZoom: Number(Math.max(-1, Math.min(1, finiteInput(input.cameraZoom))).toFixed(6)),
		running: Boolean(input.running),
		guarding: Boolean(input.guarding),
		jumpRequested: Boolean(input.jumpRequested),
		lockOnRequested: Boolean(input.lockOnRequested),
		dodgeRequested: Boolean(input.dodgeRequested),
		parryRequested: Boolean(input.parryRequested),
		lightRequested: Boolean(input.lightRequested),
		heavyRequested: Boolean(input.heavyRequested),
		actionCount: Number.isSafeInteger(input.actionCount) && (input.actionCount as number) >= 0 ? input.actionCount as number : 0,
	});
}

export interface PlayerInputActionBufferOptions {
	readonly maxEntries?: number;
	readonly ttlSeconds?: number;
}

export class PlayerInputActionBuffer {
	private readonly _maxEntries: number;
	private readonly _ttlSeconds: number;
	private _sequence = 0;
	private _queue: PlayerInputActionRecord[] = [];
	private _droppedCount = 0;

	constructor({ maxEntries = 32, ttlSeconds = 0.32 }: PlayerInputActionBufferOptions = {}) {
		this._maxEntries = Math.max(1, Math.min(128, Math.floor(finiteInput(maxEntries, 32))));
		this._ttlSeconds = Math.max(0.05, Math.min(2, finiteInput(ttlSeconds, 0.32)));
	}

	enqueue(action: PlayerInputAction, device: PlayerInputDevice = 'unknown', source = device, timestampSeconds = 0): PlayerInputActionRecord {
		const now = Math.max(0, finiteInput(timestampSeconds, 0));
		const record: PlayerInputActionRecord = Object.freeze({
			sequence: ++this._sequence,
			action,
			device,
			source,
			timestampSeconds: now,
			expiresAtSeconds: Number((now + this._ttlSeconds).toFixed(6)),
		});
		this._queue.push(record);
		if (this._queue.length > this._maxEntries) {
			this._droppedCount += this._queue.length - this._maxEntries;
			this._queue = this._queue.slice(-this._maxEntries);
		}
		return record;
	}

	drain(nowSeconds = 0, limit = this._maxEntries): readonly PlayerInputActionRecord[] {
		const now = Math.max(0, finiteInput(nowSeconds, 0));
		const max = Math.max(0, Math.floor(finiteInput(limit, this._maxEntries)));
		this._queue = this._queue.filter((record) => record.expiresAtSeconds >= now);
		const records = this._queue.slice(0, max);
		this._queue = this._queue.slice(records.length);
		return Object.freeze(records);
	}

	peek(nowSeconds = 0): readonly PlayerInputActionRecord[] {
		const now = Math.max(0, finiteInput(nowSeconds, 0));
		this._queue = this._queue.filter((record) => record.expiresAtSeconds >= now);
		return Object.freeze([...this._queue]);
	}

	clear(): void {
		this._queue = [];
	}

	snapshot(nowSeconds = 0): Readonly<{ version: typeof PLAYER_INPUT_CONTRACT_VERSION; nextSequence: number; pending: readonly PlayerInputActionRecord[]; droppedCount: number }> {
		return Object.freeze({
			version: PLAYER_INPUT_CONTRACT_VERSION,
			nextSequence: this._sequence + 1,
			pending: this.peek(nowSeconds),
			droppedCount: this._droppedCount,
		});
	}
}

export function createPlayerInputFrame(
	input: Omit<Partial<PlayerInputFrame>, 'version'> & { readonly device?: PlayerInputDevice } = {},
): PlayerInputFrame {
	return normalizePlayerInputFrame(input);
}

const FORWARD_KEYS = new Set(['KeyW', 'ArrowUp']);
const BACK_KEYS = new Set(['KeyS', 'ArrowDown']);
const RIGHT_KEYS = new Set(['KeyD', 'ArrowRight']);
const LEFT_KEYS = new Set(['KeyA', 'ArrowLeft']);
const RUN_KEYS = new Set(['ShiftLeft', 'ShiftRight']);
const JUMP_KEYS = new Set(['Space']);
const GUARD_KEYS = new Set(['KeyQ']);
const LIGHT_ATTACK_KEYS = new Set(['KeyE']);
const HEAVY_ATTACK_KEYS = new Set(['KeyR']);
const LOCK_ON_KEYS = new Set(['Tab']);
const GUARD_POINTER_BUTTON = 2;
const LIGHT_ATTACK_POINTER_BUTTON = 0;





export const PLAYER_INPUT_FIXED_TICK_SECONDS = 1 / 60;

export interface PlayerInputReplayEnvelope {
	readonly version: typeof PLAYER_INPUT_CONTRACT_VERSION;
	readonly tickSeconds: number;
	readonly frameCount: number;
	readonly checksum: string;
	readonly frames: readonly PlayerInputFrame[];
}

export function stablePlayerInputChecksum(frames: readonly PlayerInputFrame[]): string {
	let hash = 0x811c9dc5;
	for (const frame of frames) {
		const canonical = [
			frame.sequence, frame.timestampSeconds.toFixed(6), frame.device,
			frame.forward.toFixed(6), frame.strafe.toFixed(6), frame.magnitude.toFixed(6),
			frame.lookX.toFixed(6), frame.lookY.toFixed(6), frame.lookMagnitude.toFixed(6),
			frame.cameraZoom.toFixed(6),
			frame.running ? '1' : '0', frame.guarding ? '1' : '0',
			frame.jumpRequested ? '1' : '0', frame.lockOnRequested ? '1' : '0',
			frame.dodgeRequested ? '1' : '0', frame.parryRequested ? '1' : '0',
			frame.lightRequested ? '1' : '0', frame.heavyRequested ? '1' : '0',
			frame.actionCount,
		].join('|');
		for (let index = 0; index < canonical.length; index += 1) {
			hash ^= canonical.charCodeAt(index);
			hash = Math.imul(hash, 0x01000193);
		}
	}
	return (hash >>> 0).toString(16).padStart(8, '0');
}

export function encodePlayerInputReplay(
	frames: readonly PlayerInputFrame[],
	tickSeconds = PLAYER_INPUT_FIXED_TICK_SECONDS,
): string {
	const normalizedFrames = Object.freeze(frames.map(normalizePlayerInputFrame));
	const tick = Math.max(1 / 240, Math.min(1 / 15, finiteInput(tickSeconds, PLAYER_INPUT_FIXED_TICK_SECONDS)));
	const envelope: PlayerInputReplayEnvelope = Object.freeze({
		version: PLAYER_INPUT_CONTRACT_VERSION,
		tickSeconds: Number(tick.toFixed(6)),
		frameCount: normalizedFrames.length,
		checksum: stablePlayerInputChecksum(normalizedFrames),
		frames: normalizedFrames,
	});
	return JSON.stringify(envelope);
}

export function decodePlayerInputReplay(
	payload: unknown,
	maxFrames = 3600,
): Readonly<{ ok: boolean; envelope: PlayerInputReplayEnvelope | null; error: string | null }> {
	if (typeof payload !== 'string') return Object.freeze({ ok: false, envelope: null, error: 'payload-not-string' });
	try {
		const parsed = JSON.parse(payload) as Partial<PlayerInputReplayEnvelope> | null;
		if (!parsed || parsed.version !== PLAYER_INPUT_CONTRACT_VERSION || !Array.isArray(parsed.frames)) {
			return Object.freeze({ ok: false, envelope: null, error: 'invalid-version-or-frames' });
		}
		const frames = parsed.frames.slice(0, Math.max(1, Math.min(10000, Math.floor(maxFrames))))
			.map((frame) => normalizePlayerInputFrame(frame && typeof frame === 'object' ? frame as Partial<PlayerInputFrame> : {}));
		const expectedCount = Number.isSafeInteger(parsed.frameCount) ? parsed.frameCount : -1;
		if (expectedCount !== frames.length) return Object.freeze({ ok: false, envelope: null, error: 'frame-count-mismatch' });
		const checksum = stablePlayerInputChecksum(frames);
		if (typeof parsed.checksum !== 'string' || parsed.checksum !== checksum) {
			return Object.freeze({ ok: false, envelope: null, error: 'checksum-mismatch' });
		}
		const tickSeconds = finiteInput(parsed.tickSeconds, PLAYER_INPUT_FIXED_TICK_SECONDS);
		const envelope: PlayerInputReplayEnvelope = Object.freeze({
			version: PLAYER_INPUT_CONTRACT_VERSION,
			tickSeconds: Math.max(1 / 240, Math.min(1 / 15, tickSeconds)),
			frameCount: frames.length,
			checksum,
			frames: Object.freeze(frames),
		});
		return Object.freeze({ ok: true, envelope, error: null });
	} catch {
		return Object.freeze({ ok: false, envelope: null, error: 'invalid-json' });
	}
}

export function quantizePlayerInputTimestamp(seconds: unknown, tickSeconds = PLAYER_INPUT_FIXED_TICK_SECONDS): number {
	const tick = Math.max(1 / 240, Math.min(1 / 15, finiteInput(tickSeconds, PLAYER_INPUT_FIXED_TICK_SECONDS)));
	const value = Math.max(0, finiteInput(seconds, 0));
	return Number((Math.round(value / tick) * tick).toFixed(6));
}

export function quantizePlayerInputFrame(frame: PlayerInputFrame, tickSeconds = PLAYER_INPUT_FIXED_TICK_SECONDS): PlayerInputFrame {
	return normalizePlayerInputFrame({
		...frame,
		timestampSeconds: quantizePlayerInputTimestamp(frame.timestampSeconds, tickSeconds),
	});
}

export interface PlayerInputSampleClock {
	readonly tickSeconds: number;
	readonly tickIndex: number;
	readonly timestampSeconds: number;
	advance: (deltaSeconds: unknown) => number;
	reset: (timestampSeconds?: unknown) => void;
}

export function createPlayerInputSampleClock(tickSeconds = PLAYER_INPUT_FIXED_TICK_SECONDS): PlayerInputSampleClock {
	const tick = Math.max(1 / 240, Math.min(1 / 15, finiteInput(tickSeconds, PLAYER_INPUT_FIXED_TICK_SECONDS)));
	let accumulator = 0;
	let tickIndex = 0;
	let timestampSeconds = 0;
	return {
		tickSeconds: tick,
		get tickIndex() { return tickIndex; },
		get timestampSeconds() { return timestampSeconds; },
		advance(deltaSeconds: unknown): number {
			accumulator += Math.max(0, Math.min(0.5, finiteInput(deltaSeconds, 0)));
			let produced = 0;
			while (accumulator >= tick) {
				accumulator -= tick;
				tickIndex += 1;
				timestampSeconds = Number((tickIndex * tick).toFixed(6));
				produced += 1;
			}
			return produced;
		},
		reset(nextTimestampSeconds = 0): void {
			accumulator = 0;
			tickIndex = Math.max(0, Math.round(Math.max(0, finiteInput(nextTimestampSeconds, 0)) / tick));
			timestampSeconds = Number((tickIndex * tick).toFixed(6));
		},
	};
}

export interface PlayerInputDevicePriority {
	readonly device: PlayerInputDevice;
	readonly score: number;
	readonly available: boolean;
}

export function resolvePlayerInputDevicePriority(
	lastActiveDevice: PlayerInputDevice = 'keyboard',
	availability: Partial<Record<PlayerInputDevice, boolean>> = {},
): readonly PlayerInputDevicePriority[] {
	const base: readonly PlayerInputDevice[] = ['gamepad', 'touch', 'keyboard', 'mouse'];
	const normalizedLast = base.includes(lastActiveDevice) ? lastActiveDevice : 'keyboard';
	return Object.freeze(base.map((device, index) => Object.freeze({
		device,
		score: (device === normalizedLast ? 1000 : 0) + (base.length - index),
		available: availability[device] !== false,
	})).sort((a, b) => b.score - a.score));
}

export interface PlayerInputLatencySample {
	readonly sequence: number;
	readonly action: PlayerInputAction;
	readonly device: PlayerInputDevice;
	readonly latencySeconds: number;
}

export interface PlayerInputLatencySnapshot {
	readonly version: typeof PLAYER_INPUT_CONTRACT_VERSION;
	readonly sampleCount: number;
	readonly meanSeconds: number;
	readonly p50Seconds: number;
	readonly p95Seconds: number;
	readonly maxSeconds: number;
	readonly lastSeconds: number;
	readonly healthy: boolean;
}

export class PlayerInputLatencyMonitor {
	private readonly _maxSamples: number;
	private readonly _pending = new Map<number, PlayerInputActionRecord>();
	private _samples: PlayerInputLatencySample[] = [];

	constructor(maxSamples = 180) {
		this._maxSamples = Math.max(16, Math.min(1000, Math.floor(finiteInput(maxSamples, 180))));
	}

	mark(record: PlayerInputActionRecord): void {
		this._pending.set(record.sequence, record);
		if (this._pending.size > this._maxSamples * 2) {
			const oldest = [...this._pending.keys()].slice(0, Math.floor(this._pending.size / 2));
			for (const sequence of oldest) this._pending.delete(sequence);
		}
	}

	observe(frame: PlayerInputFrame): void {
		if (!frame.sequence) return;
		const record = this._pending.get(frame.sequence);
		if (!record) return;
		this._pending.delete(frame.sequence);
		const latencySeconds = Math.max(0, Number((frame.timestampSeconds - record.timestampSeconds).toFixed(6)));
		this._samples.push(Object.freeze({
			sequence: frame.sequence,
			action: record.action,
			device: record.device,
			latencySeconds,
		}));
		if (this._samples.length > this._maxSamples) this._samples = this._samples.slice(-this._maxSamples);
	}

	snapshot(): PlayerInputLatencySnapshot {
		const values = this._samples.map((sample) => sample.latencySeconds).sort((a, b) => a - b);
		if (values.length === 0) {
			return Object.freeze({
				version: PLAYER_INPUT_CONTRACT_VERSION,
				sampleCount: 0,
				meanSeconds: 0,
				p50Seconds: 0,
				p95Seconds: 0,
				maxSeconds: 0,
				lastSeconds: 0,
				healthy: true,
			});
		}
		const percentile = (ratio: number): number => values[Math.min(values.length - 1, Math.floor((values.length - 1) * ratio))];
		const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
		const last = this._samples.at(-1)?.latencySeconds ?? 0;
		return Object.freeze({
			version: PLAYER_INPUT_CONTRACT_VERSION,
			sampleCount: values.length,
			meanSeconds: Number(mean.toFixed(6)),
			p50Seconds: Number(percentile(0.5).toFixed(6)),
			p95Seconds: Number(percentile(0.95).toFixed(6)),
			maxSeconds: Number(Math.max(...values).toFixed(6)),
			lastSeconds: Number(last.toFixed(6)),
			healthy: mean <= 0.08 && percentile(0.95) <= 0.16,
		});
	}

	clear(): void {
		this._pending.clear();
		this._samples = [];
	}
}

export interface PlayerInputRuntimeDiagnostics {
	readonly version: typeof PLAYER_INPUT_CONTRACT_VERSION;
	readonly actionBuffer: ReturnType<PlayerInputActionBuffer['snapshot']>;
	readonly latency: PlayerInputLatencySnapshot;
	readonly device: PlayerInputDeviceSnapshot;
	readonly bindings: PlayerInputBindingValidation;
	readonly calibration: PlayerInputCalibration;
	readonly healthy: boolean;
}

export interface PlayerInputBindingProfile {
	readonly forward: readonly string[];
	readonly back: readonly string[];
	readonly right: readonly string[];
	readonly left: readonly string[];
	readonly run: readonly string[];
	readonly jump: readonly string[];
	readonly guard: readonly string[];
	readonly lightAttack: readonly string[];
	readonly heavyAttack: readonly string[];
	readonly lockOn: readonly string[];
}

export const DEFAULT_PLAYER_INPUT_BINDINGS: PlayerInputBindingProfile = Object.freeze({
	forward: Object.freeze([...FORWARD_KEYS]),
	back: Object.freeze([...BACK_KEYS]),
	right: Object.freeze([...RIGHT_KEYS]),
	left: Object.freeze([...LEFT_KEYS]),
	run: Object.freeze([...RUN_KEYS]),
	jump: Object.freeze([...JUMP_KEYS]),
	guard: Object.freeze([...GUARD_KEYS]),
	lightAttack: Object.freeze([...LIGHT_ATTACK_KEYS]),
	heavyAttack: Object.freeze([...HEAVY_ATTACK_KEYS]),
	lockOn: Object.freeze([...LOCK_ON_KEYS]),
});

const sanitizeBindings = (bindings: Partial<Record<keyof PlayerInputBindingProfile, unknown>>): PlayerInputBindingProfile => {
	const read = (key: keyof PlayerInputBindingProfile, fallback: readonly string[]): readonly string[] => {
		const raw = bindings[key];
		if (!Array.isArray(raw)) return fallback;
		const values = raw.filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
		return Object.freeze([...new Set(values)].slice(0, 8));
	};
	return Object.freeze({
		forward: read('forward', DEFAULT_PLAYER_INPUT_BINDINGS.forward),
		back: read('back', DEFAULT_PLAYER_INPUT_BINDINGS.back),
		right: read('right', DEFAULT_PLAYER_INPUT_BINDINGS.right),
		left: read('left', DEFAULT_PLAYER_INPUT_BINDINGS.left),
		run: read('run', DEFAULT_PLAYER_INPUT_BINDINGS.run),
		jump: read('jump', DEFAULT_PLAYER_INPUT_BINDINGS.jump),
		guard: read('guard', DEFAULT_PLAYER_INPUT_BINDINGS.guard),
		lightAttack: read('lightAttack', DEFAULT_PLAYER_INPUT_BINDINGS.lightAttack),
		heavyAttack: read('heavyAttack', DEFAULT_PLAYER_INPUT_BINDINGS.heavyAttack),
		lockOn: read('lockOn', DEFAULT_PLAYER_INPUT_BINDINGS.lockOn),
	});
};



export interface PlayerInputBindingValidation {
	readonly ok: boolean;
	readonly collisions: readonly Readonly<{ code: string; actions: readonly string[] }>[];
	readonly emptyActions: readonly string[];
	readonly normalized: PlayerInputBindingProfile;
}

export function mergePlayerInputBindings(
	base: PlayerInputBindingProfile = DEFAULT_PLAYER_INPUT_BINDINGS,
	overrides: Partial<Record<keyof PlayerInputBindingProfile, unknown>> = {},
): PlayerInputBindingProfile {
	const source = base as unknown as Record<string, unknown>;
	return normalizePlayerInputBindings({
		forward: overrides.forward ?? source.forward,
		back: overrides.back ?? source.back,
		right: overrides.right ?? source.right,
		left: overrides.left ?? source.left,
		run: overrides.run ?? source.run,
		jump: overrides.jump ?? source.jump,
		guard: overrides.guard ?? source.guard,
		lightAttack: overrides.lightAttack ?? source.lightAttack,
		heavyAttack: overrides.heavyAttack ?? source.heavyAttack,
		lockOn: overrides.lockOn ?? source.lockOn,
	});
}

export function validatePlayerInputBindings(
	bindings: Partial<Record<keyof PlayerInputBindingProfile, unknown>> = {},
): PlayerInputBindingValidation {
	const normalized = normalizePlayerInputBindings(bindings);
	const entries: readonly (readonly [string, readonly string[]])[] = [
		['forward', normalized.forward], ['back', normalized.back], ['right', normalized.right], ['left', normalized.left],
		['run', normalized.run], ['jump', normalized.jump], ['guard', normalized.guard],
		['lightAttack', normalized.lightAttack], ['heavyAttack', normalized.heavyAttack], ['lockOn', normalized.lockOn],
	];
	const byCode = new Map<string, string[]>();
	for (const [action, codes] of entries) {
		for (const code of codes) {
			const actions = byCode.get(code) ?? [];
			actions.push(action);
			byCode.set(code, actions);
		}
	}
	const collisions = [...byCode.entries()]
		.filter(([, actions]) => actions.length > 1)
		.map(([code, actions]) => Object.freeze({ code, actions: Object.freeze([...actions]) }));
	const emptyActions = entries.filter(([, codes]) => codes.length === 0).map(([action]) => action);
	return Object.freeze({
		ok: collisions.length === 0 && emptyActions.length === 0,
		collisions: Object.freeze(collisions),
		emptyActions: Object.freeze(emptyActions),
		normalized,
	});
}

export function resolvePlayerInputKeyAction(
	code: unknown,
	bindings: PlayerInputBindingProfile = DEFAULT_PLAYER_INPUT_BINDINGS,
): PlayerInputAction | null {
	if (typeof code !== 'string' || code.length === 0) return null;
	const profile = bindings;
	if (profile.heavyAttack.includes(code)) return 'heavy';
	if (profile.lightAttack.includes(code)) return 'light';
	if (profile.jump.includes(code)) return 'jump';
	if (profile.lockOn.includes(code)) return 'lock-on';
	if (profile.guard.includes(code)) return 'parry';
	return null;
}

export function normalizePlayerInputBindings(bindings: Partial<Record<keyof PlayerInputBindingProfile, unknown>> = {}): PlayerInputBindingProfile {
	return sanitizeBindings(bindings);
}

export function serializePlayerInputBindings(bindings: PlayerInputBindingProfile): string {
	return JSON.stringify(bindings);
}

export function deserializePlayerInputBindings(serialized: unknown): PlayerInputBindingProfile {
	if (typeof serialized !== 'string') return DEFAULT_PLAYER_INPUT_BINDINGS;
	try {
		const parsed = JSON.parse(serialized) as unknown;
		return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
			? sanitizeBindings(parsed as Partial<Record<keyof PlayerInputBindingProfile, unknown>>)
			: DEFAULT_PLAYER_INPUT_BINDINGS;
	} catch {
		return DEFAULT_PLAYER_INPUT_BINDINGS;
	}
}


export interface PlayerInputStorage {
	getItem: (key: string) => string | null;
	setItem: (key: string, value: string) => void;
	removeItem: (key: string) => void;
}

export const PLAYER_INPUT_BINDINGS_STORAGE_KEY = 'aapw.player.input.bindings.v1';

export function createPlayerInputSettingsStore(
	storage: PlayerInputStorage | null = typeof globalThis.localStorage !== 'undefined' ? globalThis.localStorage : null,
	key = PLAYER_INPUT_BINDINGS_STORAGE_KEY,
) {
	return Object.freeze({
		load(): PlayerInputBindingProfile {
			if (!storage) return DEFAULT_PLAYER_INPUT_BINDINGS;
			return deserializePlayerInputBindings(storage.getItem(key));
		},
		save(bindings: PlayerInputBindingProfile): PlayerInputBindingProfile {
			const normalized = normalizePlayerInputBindings(bindings);
			try { storage?.setItem(key, serializePlayerInputBindings(normalized)); } catch { /* storage is optional */ }
			return normalized;
		},
		clear(): void {
			try { storage?.removeItem(key); } catch { /* storage is optional */ }
		},
	});
}

export interface PlayerInputCalibration {
	readonly deadzone: number;
	readonly curve: number;
	readonly maxMagnitude: number;
	readonly lookSensitivity: number;
	readonly zoomSensitivity: number;
}

export const DEFAULT_PLAYER_INPUT_CALIBRATION: PlayerInputCalibration = Object.freeze({
	deadzone: GAMEPAD_DEADZONE,
	curve: 1,
	maxMagnitude: 1,
	lookSensitivity: 1,
	zoomSensitivity: 1,
});

export function normalizePlayerInputCalibration(
	calibration: Partial<Record<keyof PlayerInputCalibration, unknown>> = {},
): PlayerInputCalibration {
	const positive = (value: unknown, fallback: number, min: number, max: number): number => Math.max(min, Math.min(max, Number.isFinite(Number(value)) ? Number(value) : fallback));
	return Object.freeze({
		deadzone: positive(calibration.deadzone, DEFAULT_PLAYER_INPUT_CALIBRATION.deadzone, 0, 0.5),
		curve: positive(calibration.curve, DEFAULT_PLAYER_INPUT_CALIBRATION.curve, 0.5, 2.5),
		maxMagnitude: positive(calibration.maxMagnitude, 1, 0.5, 1),
		lookSensitivity: positive(calibration.lookSensitivity, 1, 0.1, 3),
		zoomSensitivity: positive(calibration.zoomSensitivity, 1, 0.1, 3),
	});
}

export function applyPlayerInputCurve(value: unknown, curve = 1): number {
	const normalized = Math.max(-1, Math.min(1, finiteInput(value)));
	const exponent = Math.max(0.5, Math.min(2.5, finiteInput(curve, 1)));
	return normalized === 0 ? 0 : Math.sign(normalized) * (Math.abs(normalized) ** exponent);
}

export function calibratePlayerInputAxis(
	x: unknown,
	y: unknown,
	calibration: Partial<PlayerInputCalibration> = {},
): PlayerInputAxis {
	const settings = normalizePlayerInputCalibration(calibration);
	const axis = normalizePlayerInputAxis(x, y, settings.deadzone);
	const curved = normalizePlayerInputAxis(
		applyPlayerInputCurve(axis.x, settings.curve),
		applyPlayerInputCurve(axis.y, settings.curve),
		0,
	);
	const magnitude = Math.min(settings.maxMagnitude, curved.magnitude);
	if (magnitude === 0) return Object.freeze({ x: 0, y: 0, magnitude: 0 });
	const rawMagnitude = Math.hypot(curved.x, curved.y) || 1;
	const scale = magnitude / rawMagnitude;
	return Object.freeze({
		x: Number((curved.x * scale).toFixed(6)),
		y: Number((curved.y * scale).toFixed(6)),
		magnitude: Number(magnitude.toFixed(6)),
	});
}

export function diffPlayerInputFrames(
	first: PlayerInputFrame | null,
	second: PlayerInputFrame | null,
	epsilon = 0.00001,
): Readonly<{ equal: boolean; reasons: readonly string[] }> {
	if (!first || !second) return Object.freeze({ equal: false, reasons: Object.freeze(['missing-frame']) });
	const reasons: string[] = [];
	const numeric = (key: keyof Pick<PlayerInputFrame, 'forward' | 'strafe' | 'magnitude' | 'lookX' | 'lookY' | 'lookMagnitude' | 'cameraZoom'>): void => {
		if (Math.abs(first[key] - second[key]) > Math.max(0, finiteInput(epsilon, 0.00001))) reasons.push(key);
	};
	(['forward', 'strafe', 'magnitude', 'lookX', 'lookY', 'lookMagnitude', 'cameraZoom'] as const).forEach(numeric);
	if (first.running !== second.running) reasons.push('running');
	if (first.guarding !== second.guarding) reasons.push('guarding');
	if (first.jumpRequested !== second.jumpRequested) reasons.push('jumpRequested');
	if (first.lockOnRequested !== second.lockOnRequested) reasons.push('lockOnRequested');
	if (first.dodgeRequested !== second.dodgeRequested) reasons.push('dodgeRequested');
	if (first.parryRequested !== second.parryRequested) reasons.push('parryRequested');
	if (first.lightRequested !== second.lightRequested) reasons.push('lightRequested');
	if (first.heavyRequested !== second.heavyRequested) reasons.push('heavyRequested');
	return Object.freeze({ equal: reasons.length === 0, reasons: Object.freeze(reasons) });
}

export function replayPlayerInputFrames(frames: readonly PlayerInputFrame[], onFrame: (frame: PlayerInputFrame, index: number) => void): void {
	for (let index = 0; index < frames.length; index += 1) onFrame(frames[index], index);
}

export interface PlayerInputDeviceSnapshot {
	readonly version: typeof PLAYER_INPUT_CONTRACT_VERSION;
	readonly keyboard: boolean;
	readonly pointer: boolean;
	readonly touch: boolean;
	readonly gamepad: boolean;
	readonly gamepadIndex: number | null;
	readonly standardGamepad: boolean;
	readonly haptics: boolean;
	readonly timestampSeconds: number;
}

export function readPlayerInputDeviceSnapshot(): PlayerInputDeviceSnapshot {
	const pads = globalThis.navigator?.getGamepads?.() ?? [];
	const gamepad = selectPlayerGamepad(pads, null);
	const touch = Boolean(globalThis.navigator && ('maxTouchPoints' in globalThis.navigator) && Number(globalThis.navigator.maxTouchPoints) > 0);
	const pointer = typeof globalThis.PointerEvent !== 'undefined';
	const keyboard = typeof globalThis.KeyboardEvent !== 'undefined';
	const haptics = Boolean(gamepad && (gamepad.vibrationActuator || (gamepad as Gamepad & { hapticActuators?: unknown[] }).hapticActuators?.length));
	return Object.freeze({
		version: PLAYER_INPUT_CONTRACT_VERSION,
		keyboard,
		pointer,
		touch,
		gamepad: Boolean(gamepad),
		gamepadIndex: gamepad?.index ?? null,
		standardGamepad: Boolean(gamepad?.mapping === 'standard'),
		haptics,
		timestampSeconds: Number(((globalThis.performance?.now?.() ?? Date.now()) / 1000).toFixed(6)),
	});
}

export interface PlayerInputRecorderOptions {
	readonly maxFrames?: number;
}

export interface PlayerInputReplaySnapshot {
	readonly version: typeof PLAYER_INPUT_CONTRACT_VERSION;
	readonly frameCount: number;
	readonly frames: readonly PlayerInputFrame[];
}

export class PlayerInputRecorder {
	private readonly _maxFrames: number;
	private _frames: PlayerInputFrame[] = [];
	private _recording = false;

	constructor({ maxFrames = 600 }: PlayerInputRecorderOptions = {}) {
		this._maxFrames = Math.max(1, Math.min(3600, Math.floor(finiteInput(maxFrames, 600))));
	}

	start(): void { this._recording = true; }
	stop(): void { this._recording = false; }
	isRecording(): boolean { return this._recording; }

	record(frame: PlayerInputFrame): void {
		if (!this._recording) return;
		this._frames.push(Object.freeze({ ...normalizePlayerInputFrame(frame) }));
		if (this._frames.length > this._maxFrames) this._frames = this._frames.slice(-this._maxFrames);
	}

	clear(): void { this._frames = []; }

	snapshot(): PlayerInputReplaySnapshot {
		return Object.freeze({
			version: PLAYER_INPUT_CONTRACT_VERSION,
			frameCount: this._frames.length,
			frames: Object.freeze([...this._frames]),
		});
	}

	serialize(): string { return encodePlayerInputReplay(this._frames); }

	load(snapshot: unknown): number {
		if (typeof snapshot === 'string') { const decoded = decodePlayerInputReplay(snapshot, this._maxFrames); if (!decoded.ok || !decoded.envelope) return 0; this._frames = [...decoded.envelope.frames].slice(-this._maxFrames); return this._frames.length; }
		const source = snapshot && typeof snapshot === 'object' ? snapshot as { frames?: unknown } : {};
		const frames = Array.isArray(source.frames) ? source.frames : [];
		this._frames = frames
			.map((frame) => normalizePlayerInputFrame(frame && typeof frame === 'object' ? frame as Partial<PlayerInputFrame> : {}))
			.slice(-this._maxFrames);
		return this._frames.length;
	}

	next(): PlayerInputFrame | null { return this._frames.shift() ?? null; }
}

const COMBAT_INPUT_EVENT = 'aapw:player-combat-input';
const COMBAT_FEEDBACK_EVENT = 'aapw:player-combat-feedback';
const INPUT_DEVICE_EVENT = 'aapw:player-input-device';
const GAMEPAD_DEADZONE = 0.18;
const GAMEPAD_TRIGGER_DEADZONE = 0.08;
const GAMEPAD_SPRINT_MIN_MAGNITUDE = 0.72;
const GAMEPAD_SPRINT_RELEASE_MAGNITUDE = 0.55;
const GAMEPAD_DODGE_MIN_MAGNITUDE = 0.45;
const GAMEPAD_CAMERA_MAX_FRAME_SECONDS = 0.3;
const GAMEPAD_BUTTON = Object.freeze({
	JUMP: 0, DODGE: 1, LIGHT: 2, HEAVY: 3, GUARD: 4, PARRY: 5, ZOOM_OUT: 6, ZOOM_IN: 7, SPRINT: 10, LOCK_ON: 11,
	DPAD_UP: 12, DPAD_DOWN: 13, DPAD_LEFT: 14, DPAD_RIGHT: 15,
});
const GAMEPAD_ACTION_HAPTICS = Object.freeze({
	dodge: Object.freeze({ duration: 45, weakMagnitude: 0.3, strongMagnitude: 0.55 }),
	parry: Object.freeze({ duration: 38, weakMagnitude: 0.18, strongMagnitude: 0.68 }),
	light: Object.freeze({ duration: 55, weakMagnitude: 0.22, strongMagnitude: 0.48 }),
	heavy: Object.freeze({ duration: 90, weakMagnitude: 0.38, strongMagnitude: 0.82 }),
});
const GAMEPAD_COMBAT_FEEDBACK_HAPTICS = Object.freeze({
	dodge: Object.freeze({ duration: 34, weakMagnitude: 0.1, strongMagnitude: 0.24 }),
	parry: Object.freeze({ duration: 72, weakMagnitude: 0.18, strongMagnitude: 0.86 }),
	guard: Object.freeze({ duration: 54, weakMagnitude: 0.34, strongMagnitude: 0.56 }),
	'guard-break': Object.freeze({ duration: 135, weakMagnitude: 0.58, strongMagnitude: 0.96 }),
	hit: Object.freeze({ duration: 78, weakMagnitude: 0.44, strongMagnitude: 0.74 }),
	'hit-stagger': Object.freeze({ duration: 128, weakMagnitude: 0.62, strongMagnitude: 0.92 }),
});

function isInteractiveTarget(target: EventTarget | null): boolean {
	return typeof Element !== 'undefined' && target instanceof Element
		? Boolean(target.closest('button, a, input, textarea, select, [contenteditable="true"]'))
		: false;
}
function buttonPressed(gamepad: Gamepad | null, index: number): boolean { return Boolean(gamepad?.buttons?.[index]?.pressed); }
function buttonValue(gamepad: Gamepad | null, index: number): number {
	const value = gamepad?.buttons?.[index]?.value;
	return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : (buttonPressed(gamepad, index) ? 1 : 0);
}
export function applyGamepadTriggerDeadzone(value: unknown, deadzone: number = GAMEPAD_TRIGGER_DEADZONE): number {
	const numeric = finiteInput(value, 0); const normalized = Math.max(0, Math.min(1, numeric));
	if (normalized <= deadzone) return 0;
	return Math.min(1, (normalized - deadzone) / (1 - deadzone));
}
function readActionButtons(gamepad: Gamepad | null): GamepadButtonState {
	return {
		jump: buttonPressed(gamepad, GAMEPAD_BUTTON.JUMP),
		dodge: buttonPressed(gamepad, GAMEPAD_BUTTON.DODGE),
		light: buttonPressed(gamepad, GAMEPAD_BUTTON.LIGHT),
		heavy: buttonPressed(gamepad, GAMEPAD_BUTTON.HEAVY),
		parry: buttonPressed(gamepad, GAMEPAD_BUTTON.PARRY),
		lockOn: buttonPressed(gamepad, GAMEPAD_BUTTON.LOCK_ON),
	};
}

export function applyGamepadRadialDeadzone(x: unknown, y: unknown, deadzone: number = GAMEPAD_DEADZONE): PlayerInputAxis {
	const nx = finiteInput(x, 0), ny = finiteInput(y, 0);
	const magnitude = Math.min(1, Math.hypot(nx, ny));
	if (magnitude <= deadzone || magnitude === 0) return { x: 0, y: 0, magnitude: 0 };
	const remappedMagnitude = Math.min(1, (magnitude - deadzone) / (1 - deadzone));
	const scale = remappedMagnitude / Math.hypot(nx, ny);
	return { x: (nx * scale) || 0, y: (ny * scale) || 0, magnitude: remappedMagnitude };
}

function readGamepadDpad(gamepad: Gamepad | null): PlayerInputAxis {
	const x = Number(buttonPressed(gamepad, GAMEPAD_BUTTON.DPAD_RIGHT)) - Number(buttonPressed(gamepad, GAMEPAD_BUTTON.DPAD_LEFT));
	const y = Number(buttonPressed(gamepad, GAMEPAD_BUTTON.DPAD_DOWN)) - Number(buttonPressed(gamepad, GAMEPAD_BUTTON.DPAD_UP));
	const length = Math.hypot(x, y);
	if (length === 0) return { x: 0, y: 0, magnitude: 0 };
	return { x: x / length, y: y / length, magnitude: 1 };
}

export function resolveGamepadSprintIntent(magnitude: unknown, sprintPressed: boolean, wasRunning = false): boolean {
	if (!sprintPressed) return false;
	const threshold = wasRunning ? GAMEPAD_SPRINT_RELEASE_MAGNITUDE : GAMEPAD_SPRINT_MIN_MAGNITUDE;
	return Number.isFinite(magnitude) && magnitude >= threshold;
}

export function selectPlayerGamepad(gamepads: readonly (Gamepad | null)[] | null | undefined, preferredIndex: number | null = null): Gamepad | null {
	const standard = Array.from(gamepads ?? []).filter((pad): pad is Gamepad => Boolean(pad?.connected && pad.mapping === 'standard'));
	if (preferredIndex !== null) { const sticky = standard.find((pad) => pad.index === preferredIndex); if (sticky) return sticky; }
	return standard.sort((a, b) => (a.index ?? 999) - (b.index ?? 999))[0] ?? null;
}

export function samplePlayerGamepad(gamepad: Gamepad | null, previousButtons = {}, previousRunning = false): GamepadSample {
	const previous = previousButtons as Partial<GamepadButtonState>;
	if (!gamepad?.connected || gamepad.mapping !== 'standard') return { forward: 0, strafe: 0, magnitude: 0, lookX: 0, lookY: 0, lookMagnitude: 0, cameraZoom: 0, running: false, guarding: false, jumpPressed: false, dodgePressed: false, lightPressed: false, heavyPressed: false, parryPressed: false, lockOnPressed: false, buttons: { jump: false, dodge: false, light: false, heavy: false, parry: false, lockOn: false } };
	const stick = applyGamepadRadialDeadzone(gamepad.axes?.[0] ?? 0, gamepad.axes?.[1] ?? 0);
	const dpad = readGamepadDpad(gamepad), locomotion = stick.magnitude > 0 ? stick : dpad;
	const look = applyGamepadRadialDeadzone(gamepad.axes?.[2] ?? 0, gamepad.axes?.[3] ?? 0);
	const buttons = readActionButtons(gamepad);
	const zoomIn = applyGamepadTriggerDeadzone(buttonValue(gamepad, GAMEPAD_BUTTON.ZOOM_IN));
	const zoomOut = applyGamepadTriggerDeadzone(buttonValue(gamepad, GAMEPAD_BUTTON.ZOOM_OUT));
	return {
		forward: (-locomotion.y) || 0, strafe: locomotion.x, magnitude: locomotion.magnitude,
		lookX: look.x, lookY: look.y, lookMagnitude: look.magnitude,
		cameraZoom: zoomIn - zoomOut,
		running: resolveGamepadSprintIntent(locomotion.magnitude, buttonPressed(gamepad, GAMEPAD_BUTTON.SPRINT), previousRunning),
		guarding: buttonPressed(gamepad, GAMEPAD_BUTTON.GUARD),
		jumpPressed: buttons.jump && !previous.jump,
		dodgePressed: buttons.dodge && !previous.dodge,
		lightPressed: buttons.light && !previous.light,
		heavyPressed: buttons.heavy && !previous.heavy,
		parryPressed: buttons.parry && !previous.parry,
		lockOnPressed: buttons.lockOn && !previous.lockOn,
		buttons,
	};
}

function readGamepadHapticActuator(gamepad: Gamepad | null): GamepadHapticActuatorLike | null {
	const vibrationActuator = gamepad?.vibrationActuator;
	if (vibrationActuator && typeof vibrationActuator.playEffect === 'function') return vibrationActuator as unknown as GamepadHapticActuatorLike;
	const fallbackActuator = (gamepad as (Gamepad & { hapticActuators?: readonly GamepadHapticActuatorLike[] }) | null)?.hapticActuators?.[0];
	return fallbackActuator && typeof fallbackActuator.playEffect === 'function' ? fallbackActuator : null;
}
function requestGamepadHaptic(gamepad: Gamepad | null, profile: GamepadHapticProfile | null): Promise<boolean> | null {
	const actuator = readGamepadHapticActuator(gamepad);
	if (!profile || gamepad?.mapping !== 'standard' || !gamepad?.connected || !actuator) return null;
	try { return Promise.resolve(actuator.playEffect('dual-rumble', { startDelay: 0, ...profile })).then(() => true, () => false); } catch { return null; }
}
function playGamepadHaptic(gamepad: Gamepad | null, profile: GamepadHapticProfile | null): boolean { return Boolean(requestGamepadHaptic(gamepad, profile)); }
function readGamepadHapticProfile(profiles: Readonly<Record<string, GamepadHapticProfile>>, kind: unknown): GamepadHapticProfile | null { return typeof kind === 'string' && Object.hasOwn(profiles, kind) ? profiles[kind] : null; }
function readCombatFeedbackAmount(value: unknown): number { const numeric = Number(value); return Number.isFinite(numeric) && numeric > 0 ? numeric : 0; }
export function resolvePlayerCombatFeedbackHaptic(feedback: PlayerCombatFeedbackDetail = {}): GamepadHapticProfile | null {
	const outcome = feedback?.outcome, profile = readGamepadHapticProfile(GAMEPAD_COMBAT_FEEDBACK_HAPTICS, outcome);
	if (!profile) return null;
	const appliedAmount = readCombatFeedbackAmount(feedback?.appliedAmount), blockedAmount = readCombatFeedbackAmount(feedback?.blockedAmount);
	if ((outcome === 'dodge' || outcome === 'parry' || outcome === 'guard') && blockedAmount <= 0) return null;
	if ((outcome === 'hit' || outcome === 'hit-stagger') && appliedAmount <= 0) return null;
	if (outcome === 'guard-break' && appliedAmount <= 0 && blockedAmount <= 0) return null;
	return profile;
}
export function pulsePlayerGamepadAction(gamepad: Gamepad | null, kind: unknown): boolean { return playGamepadHaptic(gamepad, readGamepadHapticProfile(GAMEPAD_ACTION_HAPTICS, kind)); }
export function pulsePlayerGamepadMelee(gamepad: Gamepad | null, kind: unknown): boolean { return pulsePlayerGamepadAction(gamepad, kind); }
export function pulsePlayerGamepadCombatFeedback(gamepad: Gamepad | null, feedback: PlayerCombatFeedbackDetail): boolean { return playGamepadHaptic(gamepad, resolvePlayerCombatFeedbackHaptic(feedback)); }

export function emitPlayerInputAction(action: PlayerInputAction, source: string = 'unknown', device: PlayerInputDevice = 'unknown'): boolean {
	if (typeof globalThis.dispatchEvent !== 'function' || typeof globalThis.CustomEvent !== 'function') return false;
	const timestampSeconds = Number(((globalThis.performance?.now?.() ?? Date.now()) / 1000).toFixed(6));
	const detail = Object.freeze({ action, source, device, timestampSeconds });
	globalThis.dispatchEvent(new globalThis.CustomEvent('aapw:player-input-action', { detail }));
	return true;
}

export function emitPlayerCombatIntent(kind: 'light' | 'heavy', source = 'unknown'): boolean {
	return (kind === 'light' || kind === 'heavy') && emitPlayerInputAction(kind, source, source === 'touch' ? 'touch' : source === 'gamepad' ? 'gamepad' : source === 'mouse' ? 'mouse' : 'keyboard')
		? (typeof globalThis.dispatchEvent === 'function' && typeof globalThis.CustomEvent === 'function'
			? (globalThis.dispatchEvent(new globalThis.CustomEvent(COMBAT_INPUT_EVENT, { detail: Object.freeze({ kind, source }) })), true)
			: false)
		: false;
}
function emitInputDeviceChange(index: number | null, reason: string): void {
	if (typeof globalThis.dispatchEvent !== 'function' || typeof globalThis.CustomEvent !== 'function') return;
	globalThis.dispatchEvent(new globalThis.CustomEvent(INPUT_DEVICE_EVENT, { detail: Object.freeze({ device: index === null ? 'keyboard-pointer' : 'gamepad', gamepadIndex: index, reason }) }));
}

export interface KeyboardInputOptions {
	readonly bindings?: Partial<Record<keyof PlayerInputBindingProfile, unknown>>;
	readonly calibration?: Partial<PlayerInputCalibration>;
	readonly actionBuffer?: PlayerInputActionBufferOptions;
	readonly recorder?: PlayerInputRecorder;
}

export class KeyboardInput {
	private readonly _target: PlayerInputTarget;
	private readonly _keys = new Set<string>();
	private _actionBuffer: PlayerInputActionBuffer;
	private _bindings: PlayerInputBindingProfile;
	private _bindingValidation: PlayerInputBindingValidation;
	private _calibration: PlayerInputCalibration;
	private _bindingSets!: Readonly<{
		forward: ReadonlySet<string>; back: ReadonlySet<string>; right: ReadonlySet<string>; left: ReadonlySet<string>;
		run: ReadonlySet<string>; jump: ReadonlySet<string>; guard: ReadonlySet<string>; lightAttack: ReadonlySet<string>; heavyAttack: ReadonlySet<string>; lockOn: ReadonlySet<string>;
	}>;
	private readonly _recorder: PlayerInputRecorder | null;
	private readonly _latencyMonitor = new PlayerInputLatencyMonitor(180);
	private _jumpRequested = false;
	private _lockOnRequested = false;
	private _guardPointerHeld = false;
	private _gamepadButtons: GamepadButtonState = { jump: false, dodge: false, light: false, heavy: false, parry: false, lockOn: false };
	private _gamepadSprintActive = false;
	private _activeGamepadIndex: number | null = null;
	private _lastPollSeconds: number | null = null;
	private _lastCombatFeedbackSerial = 0;
	private _pendingCombatFeedbackSerial = 0;
	private readonly _onKeyDown: (event: Event) => void;
	private readonly _onKeyUp: (event: Event) => void;
	private readonly _onPointerDown: (event: Event) => void;
	private readonly _onPointerUp: (event: Event) => void;
	private readonly _onContextMenu: (event: Event) => void;
	private readonly _onCombatFeedback: (event: Event) => void;
	private readonly _onFocusLoss: (event: Event) => void;
	private readonly _onVisibilityChange: () => void;
	private readonly _onGamepadConnected: (event: Event) => void;
	private readonly _onGamepadDisconnected: (event: Event) => void;

	constructor(target: PlayerInputTarget = window, { bindings = {}, calibration = {}, actionBuffer = { maxEntries: 48, ttlSeconds: 0.36 }, recorder = null }: KeyboardInputOptions = {}) {
		
		this._bindingValidation = validatePlayerInputBindings(bindings);
		this._bindings = this._bindingValidation.ok ? this._bindingValidation.normalized : DEFAULT_PLAYER_INPUT_BINDINGS;
		this._calibration = normalizePlayerInputCalibration(calibration);
		this._refreshBindingSets();
		this._actionBuffer = new PlayerInputActionBuffer(actionBuffer);
		this._recorder = recorder;
		this._keys.clear(); this._actionBuffer.clear(); this._jumpRequested = false; this._lockOnRequested = false; this._guardPointerHeld = false;
		this._gamepadButtons = { jump: false, dodge: false, light: false, heavy: false, parry: false, lockOn: false }; this._gamepadSprintActive = false; this._activeGamepadIndex = null; this._lastPollSeconds = null; this._lastCombatFeedbackSerial = 0; this._pendingCombatFeedbackSerial = 0; this._target = target;
		this._onKeyDown = (event: Event) => { const keyboardEvent = event as KeyboardEvent;
			const firstPress = !this._keys.has(keyboardEvent.code);
			if (this._bindingSets.jump.has(keyboardEvent.code) && firstPress) { this._jumpRequested = true; this._actionBuffer.this._recordAction('jump', 'keyboard'); }
			if (firstPress && this._bindingSets.lockOn.has(keyboardEvent.code) && !isInteractiveTarget(keyboardEvent.target)) { this._lockOnRequested = true; this._recordAction('lock-on', 'keyboard'); keyboardEvent.preventDefault?.(); }
			if (firstPress && this._bindingSets.lightAttack.has(keyboardEvent.code)) { this._recordAction('light', 'keyboard'); emitPlayerCombatIntent('light', 'keyboard'); }
			if (firstPress && this._bindingSets.heavyAttack.has(keyboardEvent.code)) { this._recordAction('heavy', 'keyboard'); emitPlayerCombatIntent('heavy', 'keyboard'); }
			this._keys.add(keyboardEvent.code);
		};
		this._onKeyUp = (event: Event) => { this._keys.delete((event as KeyboardEvent).code); };
		this._onPointerDown = (event: Event) => { const pointerEvent = event as PointerEvent; if (pointerEvent.button === GUARD_POINTER_BUTTON) { this._guardPointerHeld = true; pointerEvent.preventDefault?.(); return; } if (pointerEvent.button === LIGHT_ATTACK_POINTER_BUTTON && !isInteractiveTarget(pointerEvent.target)) { this._actionBuffer.enqueue('light', 'mouse', 'mouse', this._nowSeconds()); emitPlayerCombatIntent('light', 'mouse'); } };
		this._onPointerUp = (event: Event) => { if ((event as PointerEvent).button === GUARD_POINTER_BUTTON) this._guardPointerHeld = false; };
		this._onContextMenu = (event: Event) => { if (this._guardPointerHeld) event.preventDefault?.(); };
		this._onCombatFeedback = (event: Event) => {
			const detail = typeof CustomEvent !== 'undefined' && event instanceof CustomEvent ? event.detail as PlayerCombatFeedbackDetail : {}; const serial = detail.serial;
			if (!Number.isSafeInteger(serial) || serial <= 0 || serial <= Math.max(this._lastCombatFeedbackSerial, this._pendingCombatFeedbackSerial)) return;
			const pads = globalThis.navigator?.getGamepads?.() ?? [], gamepad = selectPlayerGamepad(pads, this._activeGamepadIndex);
			if (!gamepad || gamepad.index !== this._activeGamepadIndex) return;
			const request = requestGamepadHaptic(gamepad, resolvePlayerCombatFeedbackHaptic(detail));
			if (!request) return;
			this._pendingCombatFeedbackSerial = serial;
			void request.then((played) => {
				if (this._pendingCombatFeedbackSerial === serial) this._pendingCombatFeedbackSerial = 0;
				if (played && serial > this._lastCombatFeedbackSerial) this._lastCombatFeedbackSerial = serial;
			});
		};
		this._onFocusLoss = (event: Event) => {
			const hadActiveInput = this._keys.size > 0 || this._jumpRequested || this._lockOnRequested || this._guardPointerHeld || this._activeGamepadIndex !== null;
			this._keys.clear(); this._jumpRequested = false; this._lockOnRequested = false; this._guardPointerHeld = false; this._gamepadButtons = { jump: false, dodge: false, light: false, heavy: false, parry: false, lockOn: false }; this._gamepadSprintActive = false; this._activeGamepadIndex = null; this._lastPollSeconds = null;
			if (hadActiveInput) emitInputDeviceChange(null, event?.type === 'pagehide' ? 'page-hidden' : event?.type === 'visibilitychange' ? 'visibility-hidden' : 'focus-lost');
		};
		this._onGamepadConnected = (event: Event): void => {
			const gamepad = (event as GamepadEvent).gamepad;
			if (!gamepad || gamepad.mapping !== 'standard') return;
			if (this._activeGamepadIndex === null) this._activeGamepadIndex = gamepad.index;
			emitInputDeviceChange(gamepad.index, 'connected');
		};
		this._onGamepadDisconnected = (event: Event): void => {
			const gamepad = (event as GamepadEvent).gamepad;
			if (!gamepad) return;
			if (gamepad.index === this._activeGamepadIndex) {
				this.resetInputState();
				this._activeGamepadIndex = null;
				emitInputDeviceChange(null, 'disconnected');
			}
		};
		this._onVisibilityChange = (): void => { if (this._target?.hidden === true || globalThis.document?.hidden === true) this._onFocusLoss(new Event('visibilitychange')); };
		for (const [type, handler] of [['keydown', this._onKeyDown], ['keyup', this._onKeyUp], ['pointerdown', this._onPointerDown], ['pointerup', this._onPointerUp], ['pointercancel', this._onPointerUp], ['contextmenu', this._onContextMenu], [COMBAT_FEEDBACK_EVENT, this._onCombatFeedback], ['blur', this._onFocusLoss], ['pagehide', this._onFocusLoss], ['visibilitychange', this._onVisibilityChange], ['gamepadconnected', this._onGamepadConnected], ['gamepaddisconnected', this._onGamepadDisconnected]]) target.addEventListener(type, handler);
	}

	private _recordAction(action: PlayerInputAction, device: PlayerInputDevice): PlayerInputActionRecord {
		return this._recordActionAt(action, device, this._nowSeconds());
	}
	private _recordActionAt(action: PlayerInputAction, device: PlayerInputDevice, timestampSeconds: number): PlayerInputActionRecord {
		const record = this._actionBuffer.enqueue(action, device, device, timestampSeconds);
		this._latencyMonitor.mark(record);
		if (this._recorder?.isRecording()) this._recorder.record(createPlayerInputFrame({ device, sequence: record.sequence, timestampSeconds }));
		emitPlayerInputAction(action, device, device);
		return record;
	}
	getRuntimeDiagnostics(): PlayerInputRuntimeDiagnostics {
		return Object.freeze({
			version: PLAYER_INPUT_CONTRACT_VERSION,
			actionBuffer: this._actionBuffer.snapshot(this._nowSeconds()),
			latency: this._latencyMonitor.snapshot(),
			device: this.getDeviceSnapshot(),
			bindings: this._bindingValidation,
			calibration: this._calibration,
			healthy: this._bindingValidation.ok && this._latencyMonitor.snapshot().healthy,
		});
	}

	private _refreshBindingSets(): void {
		this._bindingSets = Object.freeze({
			forward: new Set(this._bindings.forward),
			back: new Set(this._bindings.back),
			right: new Set(this._bindings.right),
			left: new Set(this._bindings.left),
			run: new Set(this._bindings.run),
			jump: new Set(this._bindings.jump),
			guard: new Set(this._bindings.guard),
			lightAttack: new Set(this._bindings.lightAttack),
			heavyAttack: new Set(this._bindings.heavyAttack),
			lockOn: new Set(this._bindings.lockOn),
		});
	}

	setBindingProfile(bindings: Partial<Record<keyof PlayerInputBindingProfile, unknown>>): PlayerInputBindingProfile {
		const validation = validatePlayerInputBindings(bindings);
		if (!validation.ok) {
			this._bindingValidation = validation;
			return this._bindings;
		}
		this._bindingValidation = validation;
		this._bindings = validation.normalized;
		this._refreshBindingSets();
		this._keys.clear();
		return this._bindings;
	}
	getBindingValidation(): PlayerInputBindingValidation { return this._bindingValidation; }

	setCalibration(calibration: Partial<PlayerInputCalibration>): PlayerInputCalibration {
		this._calibration = normalizePlayerInputCalibration(calibration);
		return this._calibration;
	}

	resetInputState(): void {
		this._keys.clear();
		this._actionBuffer.clear();
		this._jumpRequested = false;
		this._lockOnRequested = false;
		this._guardPointerHeld = false;
		this._gamepadButtons = { jump: false, dodge: false, light: false, heavy: false, parry: false, lockOn: false };
		this._gamepadSprintActive = false;
		this._lastPollSeconds = null;
	}

	private _nowSeconds(): number { return Number(((globalThis.performance?.now?.() ?? Date.now()) / 1000).toFixed(6)); }

	_pollGamepad(): GamepadSample {
		const pads = globalThis.navigator?.getGamepads?.() ?? [], gamepad = selectPlayerGamepad(pads, this._activeGamepadIndex), nextIndex = gamepad?.index ?? null, switched = nextIndex !== this._activeGamepadIndex;
		const nowSeconds = this._nowSeconds(), lookDeltaSeconds = this._lastPollSeconds === null ? 0 : Math.max(0, Math.min(GAMEPAD_CAMERA_MAX_FRAME_SECONDS, nowSeconds - this._lastPollSeconds)); this._lastPollSeconds = nowSeconds;
		if (switched) { this._gamepadButtons = gamepad ? readActionButtons(gamepad) : { jump: false, dodge: false, light: false, heavy: false, parry: false, lockOn: false }; this._gamepadSprintActive = false; this._activeGamepadIndex = nextIndex; emitInputDeviceChange(nextIndex, gamepad ? 'selected' : 'disconnected'); }
		const sample = samplePlayerGamepad(gamepad, this._gamepadButtons, this._gamepadSprintActive);
		if (!switched) {
			if (sample.jumpPressed) { this._jumpRequested = true; this._recordActionAt('jump', 'gamepad', nowSeconds); }
			if (sample.lockOnPressed) { this._lockOnRequested = true; this._recordActionAt('lock-on', 'gamepad', nowSeconds); }
			if (sample.dodgePressed && sample.magnitude >= GAMEPAD_DODGE_MIN_MAGNITUDE) { this._recordActionAt('dodge', 'gamepad', nowSeconds); pulsePlayerGamepadAction(gamepad, 'dodge'); }
			if (sample.parryPressed) { this._recordActionAt('parry', 'gamepad', nowSeconds); pulsePlayerGamepadAction(gamepad, 'parry'); }
			if (sample.lightPressed) { this._recordActionAt('light', 'gamepad', nowSeconds); emitPlayerCombatIntent('light', 'gamepad'); pulsePlayerGamepadAction(gamepad, 'light'); }
			if (sample.heavyPressed) { this._recordActionAt('heavy', 'gamepad', nowSeconds); emitPlayerCombatIntent('heavy', 'gamepad'); pulsePlayerGamepadAction(gamepad, 'heavy'); }
		}
		this._gamepadButtons = sample.buttons; this._gamepadSprintActive = sample.running; return { ...sample, lookDeltaSeconds };
	}
	getInputFrame(): PlayerInputFrame {
		const axes = this.getAxes();
		const actions = this._actionBuffer.peek(this._nowSeconds());
		const frame = createPlayerInputFrame({ ...axes, device: this._activeGamepadIndex === null ? 'keyboard' : 'gamepad', sequence: actions.at(-1)?.sequence ?? 0, timestampSeconds: this._nowSeconds(), actionCount: actions.length, jumpRequested: axes.jumpRequested || actions.some((a) => a.action === 'jump'), lockOnRequested: axes.lockOnRequested || actions.some((a) => a.action === 'lock-on'), dodgeRequested: actions.some((a) => a.action === 'dodge'), parryRequested: actions.some((a) => a.action === 'parry'), lightRequested: actions.some((a) => a.action === 'light'), heavyRequested: actions.some((a) => a.action === 'heavy') });
		this._latencyMonitor.observe(frame);
		return frame;
	}
	consumeActionBuffer(nowSeconds = this._nowSeconds(), limit = 8): readonly PlayerInputActionRecord[] { return this._actionBuffer.drain(nowSeconds, limit); }

	getAxes(): Readonly<{ forward:number; strafe:number; running:boolean; jumpRequested:boolean; lockOnRequested:boolean; guarding:boolean; lookX:number; lookY:number; cameraZoom:number; lookDeltaSeconds?:number }> {
		const gamepad = this._pollGamepad(); let forward = gamepad.forward, strafe = gamepad.strafe, running = gamepad.running, guarding = this._guardPointerHeld || gamepad.guarding;
		for (const code of this._keys) { if (this._bindingSets.forward.has(code)) forward += 1; else if (this._bindingSets.back.has(code)) forward -= 1; else if (this._bindingSets.right.has(code)) strafe += 1; else if (this._bindingSets.left.has(code)) strafe -= 1; else if (this._bindingSets.run.has(code)) running = true; else if (this._bindingSets.guard.has(code)) guarding = true; }
		const dodgeRequested = gamepad.dodgePressed && gamepad.magnitude >= GAMEPAD_DODGE_MIN_MAGNITUDE;
		if (dodgeRequested) running = true;
		if (gamepad.parryPressed) guarding = true;
		const jumpRequested = this._jumpRequested;
		this._jumpRequested = false;
		const result = { forward: Math.max(-1, Math.min(1, forward)), strafe: Math.max(-1, Math.min(1, strafe)), running, jumpRequested: jumpRequested || dodgeRequested, lockOnRequested: this._lockOnRequested, guarding, lookX: Number((gamepad.lookX * this._calibration.lookSensitivity).toFixed(6)), lookY: Number((gamepad.lookY * this._calibration.lookSensitivity).toFixed(6)), cameraZoom: Number((gamepad.cameraZoom * this._calibration.zoomSensitivity).toFixed(6)), lookDeltaSeconds: gamepad.lookDeltaSeconds };
		if (this._recorder?.isRecording()) this._recorder.record(createPlayerInputFrame({ ...result, device: this._activeGamepadIndex === null ? 'keyboard' : 'gamepad', timestampSeconds: this._nowSeconds(), actionCount: this._actionBuffer.peek(this._nowSeconds()).length }));
		return Object.freeze(result);
	}
	startRecording(): void { this._recorder?.start(); }
	stopRecording(): void { this._recorder?.stop(); }
	getRecordedInput(): PlayerInputReplaySnapshot { return this._recorder?.snapshot() ?? Object.freeze({ version: PLAYER_INPUT_CONTRACT_VERSION, frameCount: 0, frames: Object.freeze([]) }); }
	getDeviceSnapshot(): PlayerInputDeviceSnapshot { const snapshot = readPlayerInputDeviceSnapshot(); return Object.freeze({ ...snapshot, gamepadIndex: this._activeGamepadIndex }); }
	getBindingProfile(): PlayerInputBindingProfile { return this._bindings; }
	getCalibration(): PlayerInputCalibration { return this._calibration; }

	consumeLockOnRequested(): boolean { const requested = this._lockOnRequested; this._lockOnRequested = false; return requested; }
	dispose(): void {
		for (const [type, handler] of [['keydown', this._onKeyDown], ['keyup', this._onKeyUp], ['pointerdown', this._onPointerDown], ['pointerup', this._onPointerUp], ['pointercancel', this._onPointerUp], ['contextmenu', this._onContextMenu], [COMBAT_FEEDBACK_EVENT, this._onCombatFeedback], ['blur', this._onFocusLoss], ['pagehide', this._onFocusLoss], ['visibilitychange', this._onVisibilityChange], ['gamepadconnected', this._onGamepadConnected], ['gamepaddisconnected', this._onGamepadDisconnected]]) this._target.removeEventListener(type, handler);
		this.resetInputState(); this._activeGamepadIndex = null; this._lastCombatFeedbackSerial = 0; this._pendingCombatFeedbackSerial = 0;
	}
}


export interface PlayerInputParityAudit {
	readonly version: typeof PLAYER_INPUT_CONTRACT_VERSION;
	readonly finiteAxis: boolean;
	readonly boundedAxis: boolean;
	readonly deterministicSequence: boolean;
	readonly expiryBounded: boolean;
	readonly immutableFrame: boolean;
	readonly deviceCoverage: readonly PlayerInputDevice[];
	readonly ok: boolean;
}

export function auditPlayerInputParity(): PlayerInputParityAudit {
	const deadzone = normalizePlayerInputAxis(0.4, -0.4);
	const frame = createPlayerInputFrame({
		sequence: 7,
		timestampSeconds: 12.5,
		device: 'gamepad',
		forward: 2,
		strafe: -2,
		lookX: Number.NaN,
		lookY: Number.POSITIVE_INFINITY,
	});
	const buffer = new PlayerInputActionBuffer({ maxEntries: 4, ttlSeconds: 0.25 });
	const first = buffer.enqueue('light', 'keyboard', 'keyboard', 1);
	const second = buffer.enqueue('heavy', 'gamepad', 'gamepad', 1.01);
	const expired = buffer.peek(1.3);
	const devices: readonly PlayerInputDevice[] = ['keyboard', 'mouse', 'gamepad', 'touch'];
	const deterministicSequence = second.sequence === first.sequence + 1;
	const finiteAxis = [deadzone.x, deadzone.y, deadzone.magnitude, frame.forward, frame.strafe, frame.lookX, frame.lookY].every(Number.isFinite);
	const boundedAxis = [frame.forward, frame.strafe, frame.lookX, frame.lookY, frame.cameraZoom].every((value) => value >= -1 && value <= 1);
	const expiryBounded = expired.length === 0;
	const immutableFrame = Object.isFrozen(frame) && Object.isFrozen(first) && Object.isFrozen(second);
	return Object.freeze({
		version: PLAYER_INPUT_CONTRACT_VERSION,
		finiteAxis,
		boundedAxis,
		deterministicSequence,
		expiryBounded,
		immutableFrame,
		deviceCoverage: devices,
		ok: finiteAxis && boundedAxis && deterministicSequence && expiryBounded && immutableFrame,
	});
}
