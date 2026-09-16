/**
 * Procedural Web Audio sound bank.
 *
 * The repository currently ships one small UI WAV and no broader environmental library. Instead of
 * introducing a large binary payload, this bank synthesizes low-memory ambience and short cues with the
 * browser's Web Audio primitives. It is deliberately defensive: unsupported contexts simply produce
 * inert handles, and all created nodes are tracked for deterministic disposal.
 *
 * The bank creates reusable sources for wind, water, rain, fire, low ambient drones, dragon roars,
 * footsteps and combat pulses. Noise buffers are generated deterministically from a fixed recurrence;
 * no Math.random(), crypto randomness or external fetch is used.
 */

const CLASSES = Object.freeze({ WIND: 'wind', WATER: 'water', RAIN: 'rain', FIRE: 'fire', AMBIENCE: 'ambience', DRAGON: 'dragon', FOOTSTEP: 'footstep', COMBAT: 'combat', UI: 'ui' });
const MAX_GENERATED_BUFFERS = 12;
const DEFAULT_SAMPLE_RATE = 22050;
const DEFAULT_DURATION = 2;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const finiteOr = (value, fallback) => Number.isFinite(value) ? value : fallback;
const freeze = (value) => { if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value; Object.freeze(value); for (const child of Object.values(value)) freeze(child); return value; };

function safeCall(fn, fallback = null) { try { return typeof fn === 'function' ? fn() : fallback; } catch { return fallback; } }
function safeParam(param, value) { try { if (param && Number.isFinite(value)) param.value = value; } catch {} }

function createNoiseBuffer(context, seconds = DEFAULT_DURATION, seed = 1337) {
	if (!context?.createBuffer) return null;
	const sampleRate = context.sampleRate || DEFAULT_SAMPLE_RATE;
	const length = Math.max(1, Math.floor(sampleRate * clamp(seconds, 0.25, 6)));
	const buffer = safeCall(() => context.createBuffer(1, length, sampleRate));
	if (!buffer?.getChannelData) return null;
	const channel = buffer.getChannelData(0);
	let state = (Math.abs(Math.floor(seed)) || 1) >>> 0;
	for (let i = 0; i < channel.length; i += 1) {
		state ^= state << 13;
		state ^= state >>> 17;
		state ^= state << 5;
		state >>>= 0;
		channel[i] = (state / 4294967295) * 2 - 1;
	}
	return buffer;
}

function connect(node, destination) { try { node?.connect?.(destination); return true; } catch { return false; } }
function disconnect(node) { try { node?.disconnect?.(); } catch {} }
function stop(node) { try { node?.stop?.(); } catch {} }

function createGain(context, value = 1) {
	const node = safeCall(() => context?.createGain?.());
	if (!node) return null;
	safeParam(node.gain, value);
	return node;
}

function createFilter(context, type, frequency, q = 0.8) {
	const node = safeCall(() => context?.createBiquadFilter?.());
	if (!node) return null;
	try { node.type = type; } catch {}
	safeParam(node.frequency, clamp(finiteOr(frequency, 1000), 40, 20000));
	safeParam(node.Q, clamp(finiteOr(q, 0.8), 0.01, 20));
	return node;
}

function createOscillator(context, type, frequency) {
	const osc = safeCall(() => context?.createOscillator?.());
	if (!osc) return null;
	try { osc.type = type; } catch {}
	safeParam(osc.frequency, clamp(finiteOr(frequency, 440), 20, 12000));
	return osc;
}

function buildSource(context, kind, buffer, output) {
	if (!context || !output) return null;
	if (kind === 'noise') {
		const source = safeCall(() => context.createBufferSource());
		if (!source || !buffer) return null;
		source.buffer = buffer;
		try { source.loop = true; } catch {}
		connect(source, output);
		return source;
	}
	return null;
}

function createWind(context, buffer) {
	const output = createGain(context, 0);
	const low = createFilter(context, 'lowpass', 1100, 0.7);
	const high = createFilter(context, 'highpass', 90, 0.6);
	const source = buildSource(context, 'noise', buffer, low);
	if (!output || !low || !high || !source) return null;
	connect(low, high); connect(high, output); connect(output, context.destination);
	return { output, source, filters: [low, high] };
}

function createWater(context, buffer) {
	const output = createGain(context, 0);
	const band = createFilter(context, 'bandpass', 900, 0.9);
	const source = buildSource(context, 'noise', buffer, band);
	if (!output || !band || !source) return null;
	connect(band, output); connect(output, context.destination);
	return { output, source, filters: [band] };
}

function createRain(context, buffer) {
	const output = createGain(context, 0);
	const high = createFilter(context, 'highpass', 1800, 0.4);
	const source = buildSource(context, 'noise', buffer, high);
	if (!output || !high || !source) return null;
	connect(high, output); connect(output, context.destination);
	return { output, source, filters: [high] };
}

function createFire(context, buffer) {
	const output = createGain(context, 0);
	const low = createFilter(context, 'lowpass', 700, 0.9);
	const source = buildSource(context, 'noise', buffer, low);
	if (!output || !low || !source) return null;
	connect(low, output); connect(output, context.destination);
	return { output, source, filters: [low] };
}

function createAmbience(context, buffer) {
	const output = createGain(context, 0);
	const low = createFilter(context, 'lowpass', 420, 0.7);
	const source = buildSource(context, 'noise', buffer, low);
	if (!output || !low || !source) return null;
	connect(low, output); connect(output, context.destination);
	return { output, source, filters: [low] };
}

function createDrone(context, frequency, output) {
	const osc = createOscillator(context, 'sine', frequency);
	const gain = createGain(context, 0.02);
	if (!osc || !gain) return null;
	connect(osc, gain); connect(gain, output);
	try { osc.start(); } catch {}
	return { oscillator: osc, gain };
}

function createDragon(context) {
	const output = createGain(context, 0);
	const low = createFilter(context, 'lowpass', 820, 1.2);
	const osc = createOscillator(context, 'sawtooth', 72);
	const sub = createOscillator(context, 'sine', 44);
	if (!output || !low || !osc || !sub) return null;
	connect(osc, low); connect(sub, low); connect(low, output); connect(output, context.destination);
	try { osc.start(); sub.start(); } catch {}
	return { output, oscillator: osc, sub, filters: [low] };
}

function createFootstep(context) {
	const output = createGain(context, 0);
	const filter = createFilter(context, 'bandpass', 220, 1.8);
	if (!output || !filter) return null;
	connect(filter, output); connect(output, context.destination);
	return { output, filter };
}

function createCombat(context) {
	const output = createGain(context, 0);
	const filter = createFilter(context, 'bandpass', 520, 1.5);
	if (!output || !filter) return null;
	connect(filter, output); connect(output, context.destination);
	return { output, filter };
}

export class ProceduralSoundBank {
	constructor({ context = null, masterGain = 1, seed = 1337 } = {}) {
		this.context = context;
		this.masterGain = clamp(finiteOr(masterGain, 1), 0, 1);
		this.seed = Math.floor(finiteOr(seed, 1337));
		this.buffers = new Map();
		this.layers = new Map();
		this.liveNodes = new Set();
		this.sequence = 0;
		this.disposed = false;
	}

	get supported() { return Boolean(this.context?.createGain && this.context?.destination); }

	buffer(key, seconds = 2) {
		if (this.disposed || !this.supported) return null;
		if (this.buffers.has(key)) return this.buffers.get(key);
		if (this.buffers.size >= MAX_GENERATED_BUFFERS) return null;
		const value = createNoiseBuffer(this.context, seconds, this.seed + this.buffers.size * 7919);
		if (value) this.buffers.set(key, value);
		return value;
	}

	ensureLayer(kind) {
		if (this.disposed || !this.supported) return null;
		if (this.layers.has(kind)) return this.layers.get(kind);
		let layer = null;
		const noise = this.buffer(`${kind}-noise`, kind === CLASSES.RAIN ? 1.5 : 2);
		if (kind === CLASSES.WIND) layer = createWind(this.context, noise);
		else if (kind === CLASSES.WATER) layer = createWater(this.context, noise);
		else if (kind === CLASSES.RAIN) layer = createRain(this.context, noise);
		else if (kind === CLASSES.FIRE) layer = createFire(this.context, noise);
		else if (kind === CLASSES.AMBIENCE) layer = createAmbience(this.context, noise);
		else if (kind === CLASSES.DRAGON) layer = createDragon(this.context);
		else if (kind === CLASSES.FOOTSTEP) layer = createFootstep(this.context);
		else if (kind === CLASSES.COMBAT) layer = createCombat(this.context);
		if (!layer) return null;
		this.layers.set(kind, layer);
		for (const node of Object.values(layer)) {
			if (node && typeof node === 'object' && (node.connect || node.start || node.stop)) this.liveNodes.add(node);
			if (Array.isArray(node)) node.forEach((child) => this.liveNodes.add(child));
		}
		return layer;
	}

	setLayerGain(kind, gain) {
		const layer = this.ensureLayer(kind);
		if (!layer?.output) return false;
		safeParam(layer.output.gain, clamp(finiteOr(gain, 0), 0, this.masterGain));
		this.sequence += 1;
		return true;
	}

	triggerPulse(kind, { gain = 0.25, frequency = null, duration = 0.08 } = {}) {
		if (this.disposed || !this.supported) return false;
		const outputLayer = this.ensureLayer(kind);
		if (!outputLayer) return false;
		const seconds = clamp(finiteOr(duration, 0.08), 0.02, 0.5);
		const output = outputLayer.output;
		const osc = createOscillator(this.context, kind === CLASSES.COMBAT ? 'square' : 'sine', frequency ?? (kind === CLASSES.DRAGON ? 62 : 180));
		const gain = createGain(this.context, 0);
		if (!osc || !gain) return false;
		connect(osc, gain); connect(gain, output);
		const now = finiteOr(this.context.currentTime, 0);
		safeParam(gain.gain, 0);
		try { gain.gain.setValueAtTime?.(0, now); gain.gain.linearRampToValueAtTime?.(clamp(gain, 0, this.masterGain), now + 0.01); gain.gain.exponentialRampToValueAtTime?.(0.0001, now + seconds); } catch { safeParam(gain.gain, clamp(finiteOr(gain, 0.25), 0, this.masterGain)); }
		try { osc.start(now); osc.stop(now + seconds + 0.02); } catch { try { osc.start(); } catch {} }
		this.liveNodes.add(osc); this.liveNodes.add(gain);
		this.sequence += 1;
		return true;
	}

	playFootstep(gain = 0.18) { return this.triggerPulse(CLASSES.FOOTSTEP, { gain, frequency: 120, duration: 0.08 }); }
	playCombatPulse(gain = 0.28) { return this.triggerPulse(CLASSES.COMBAT, { gain, frequency: 210, duration: 0.1 }); }
	playDragonPulse(gain = 0.4) { return this.triggerPulse(CLASSES.DRAGON, { gain, frequency: 58, duration: 0.32 }); }

	setMasterGain(gain) {
		this.masterGain = clamp(finiteOr(gain, 1), 0, 1);
		this.sequence += 1;
		return this.masterGain;
	}

	snapshot() { return freeze({ version: 1, disposed: this.disposed, supported: this.supported, masterGain: this.masterGain, bufferCount: this.buffers.size, layerCount: this.layers.size, liveNodeCount: this.liveNodes.size, sequence: this.sequence }); }

	dispose() {
		if (this.disposed) return;
		this.disposed = true;
		for (const node of this.liveNodes) { stop(node); disconnect(node); }
		this.liveNodes.clear(); this.layers.clear(); this.buffers.clear();
	}
}

export function createProceduralSoundBank(options) { return new ProceduralSoundBank(options); }
export function proceduralSoundClasses() { return CLASSES; }
