/**
 * Audio graph safety monitor.
 *
 * Tracks abstract node/source counts supplied by the graph owner and identifies conditions that would
 * risk CPU spikes or runaway allocations. It does not inspect the AudioContext graph internals and does
 * not destroy nodes. Instead it emits bounded recommendations that the owner can apply deterministically.
 */

const STATES = Object.freeze({ HEALTHY: 'healthy', PRESSURED: 'pressured', CRITICAL: 'critical' });
const ACTIONS = Object.freeze({ NONE: 'none', VIRTUALIZE: 'virtualize', STOP_AMBIENCE: 'stop-ambience', STOP_OPTIONAL: 'stop-optional' });
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const finiteOr = (value, fallback) => Number.isFinite(value) ? value : fallback;
const freeze = (value) => { if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value; Object.freeze(value); for (const child of Object.values(value)) freeze(child); return value; };

export function evaluateAudioGraphHealth({ sourceCount = 0, sourceLimit = 16, positionalCount = 0, positionalLimit = 8, generatedBufferCount = 0, bufferLimit = 6, transientRate = 0, transientLimit = 12, contextState = 'running' } = {}) {
	const sources = Math.max(0, Math.round(finiteOr(sourceCount, 0)));
	const sourceCap = Math.max(1, Math.round(finiteOr(sourceLimit, 16)));
	const positional = Math.max(0, Math.round(finiteOr(positionalCount, 0)));
	const positionalCap = Math.max(1, Math.round(finiteOr(positionalLimit, 8)));
	const buffers = Math.max(0, Math.round(finiteOr(generatedBufferCount, 0)));
	const bufferCap = Math.max(1, Math.round(finiteOr(bufferLimit, 6)));
	const transients = Math.max(0, finiteOr(transientRate, 0));
	const transientCap = Math.max(1, finiteOr(transientLimit, 12));
	const ratio = Math.max(sources / sourceCap, positional / positionalCap, buffers / bufferCap, transients / transientCap);
	const state = ratio >= 1.15 || contextState === 'suspended-error' ? STATES.CRITICAL : ratio >= 0.82 ? STATES.PRESSURED : STATES.HEALTHY;
	const action = state === STATES.CRITICAL ? ACTIONS.STOP_OPTIONAL : state === STATES.PRESSURED ? ACTIONS.VIRTUALIZE : ACTIONS.NONE;
	return freeze({ version: 1, state, ratio: Number(ratio.toFixed(4)), action, contextState: typeof contextState === 'string' ? contextState.slice(0, 40) : 'unknown', counts: { sources, positional, buffers, transients }, limits: { sourceCap, positionalCap, bufferCap, transientCap } });
}

export function smoothGraphPressure(previous = 0, current = 0, deltaSeconds = 0.016, attack = 6, release = 2.5) {
	const prev = clamp(finiteOr(previous, 0), 0, 2);
	const next = clamp(finiteOr(current, 0), 0, 2);
	const rate = next > prev ? attack : release;
	const t = clamp(Math.max(0, finiteOr(deltaSeconds, 0)) * rate, 0, 1);
	return prev + (next - prev) * t;
}

export function audioGraphSafetyConstants() { return freeze({ states: STATES, actions: ACTIONS }); }
