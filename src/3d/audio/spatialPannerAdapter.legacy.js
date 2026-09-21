/**
 * Defensive Web Audio spatial panner adapter.
 *
 * Turns an admitted abstract source into GainNode + PannerNode + optional low-pass filter when the
 * supplied AudioContext supports them. The adapter never allocates more than the caller's source
 * budget and exposes an inert handle when Web Audio is unavailable. It also uses the modern AudioParam
 * `setValueAtTime` path when present, with a direct-value fallback for older implementations.
 */

const DEFAULTS = Object.freeze({ maxSources: 48, maxDistance: 120, refDistance: 8, rolloffFactor: 1.5, coneInner: 360, coneOuter: 0, coneOuterGain: 0 });
const freeze = (value) => { if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value; Object.freeze(value); for (const child of Object.values(value)) freeze(child); return value; };
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const finiteOr = (value, fallback) => Number.isFinite(value) ? value : fallback;

function setParam(param, value, time = 0) { if (!param || !Number.isFinite(value)) return false; try { if (typeof param.setValueAtTime === 'function') param.setValueAtTime(value, time); else param.value = value; return true; } catch { return false; } }
function connect(node, target) { try { node?.connect?.(target); return true; } catch { return false; } }
function disconnect(node) { try { node?.disconnect?.(); } catch {} }
function stop(node, time = 0) { try { node?.stop?.(time); } catch { try { node?.stop?.(); } catch {} } }

function positionPanner(panner, position, time) {
	const point = position ?? { x: 0, y: 0, z: 0 };
	const set = (key, value) => setParam(panner?.[key], finiteOr(value, 0), time);
	if (panner?.positionX) { set('positionX', point.x); set('positionY', point.y); set('positionZ', point.z); }
	else panner?.setPosition?.(finiteOr(point.x, 0), finiteOr(point.y, 0), finiteOr(point.z, 0));
}

function configurePanner(panner, source, policy) {
	if (!panner) return;
	try { panner.panningModel = policy?.panningModel ?? 'HRTF'; } catch {}
	try { panner.distanceModel = policy?.distanceModel ?? 'inverse'; } catch {}
	try { panner.refDistance = clamp(finiteOr(policy?.referenceDistance, DEFAULTS.refDistance), 1, 100); } catch {}
	try { panner.maxDistance = clamp(finiteOr(policy?.maxDistance, DEFAULTS.maxDistance), 10, 1000); } catch {}
	try { panner.rolloffFactor = clamp(finiteOr(policy?.rolloffFactor, DEFAULTS.rolloffFactor), 0.1, 5); } catch {}
	try { panner.coneInnerAngle = clamp(finiteOr(source?.coneInnerAngle, DEFAULTS.coneInner), 0, 360); panner.coneOuterAngle = clamp(finiteOr(source?.coneOuterAngle, DEFAULTS.coneOuter), 0, 360); panner.coneOuterGain = clamp(finiteOr(source?.coneOuterGain, DEFAULTS.coneOuterGain), 0, 1); } catch {}
	positionPanner(panner, source?.position, policy?.currentTime ?? 0);
}

export class SpatialPannerHandle {
	constructor({ context = null, destination = null, source = {}, policy = {} } = {}) {
		this.context = context;
		this.destination = destination;
		this.source = source;
		this.policy = policy;
		this.gainNode = null;
		this.panner = null;
		this.filter = null;
		this.sourceNode = null;
		this.disposed = false;
		this.sequence = 0;
		this.supported = false;
		this._build();
	}

	_build() {
		if (!this.context?.createGain || !this.context?.createPanner || !this.destination) return;
		try {
			this.gainNode = this.context.createGain();
			this.panner = this.context.createPanner();
			configurePanner(this.panner, this.source, { ...this.policy, currentTime: finiteOr(this.context.currentTime, 0) });
			this.filter = this.context.createBiquadFilter?.() ?? null;
			if (this.filter) { try { this.filter.type = 'lowpass'; } catch {} setParam(this.filter.frequency, 18000, this.context.currentTime ?? 0); }
			const graphOk = this.filter ? connect(this.panner, this.filter) && connect(this.filter, this.gainNode) : connect(this.panner, this.gainNode);
			const destinationOk = graphOk && connect(this.gainNode, this.destination);
			this.supported = Boolean(destinationOk);
			if (!this.supported) this.dispose();
		} catch { this.dispose(); }
	}

	setPosition(position) { if (this.disposed || !this.panner) return false; positionPanner(this.panner, position, finiteOr(this.context?.currentTime, 0)); this.sequence += 1; return true; }
	setGain(gain) { if (this.disposed || !this.gainNode) return false; this.sequence += setParam(this.gainNode.gain, clamp(finiteOr(gain, 0), 0, 1), finiteOr(this.context?.currentTime, 0)) ? 1 : 0; return true; }
	setOcclusion(occlusion = {}) { if (this.disposed) return false; const gain = clamp(finiteOr(occlusion.gain, 1), 0, 1); const cutoff = clamp(finiteOr(occlusion.cutoffHz, 18000), 180, 18000); this.setGain(gain); if (this.filter) setParam(this.filter.frequency, cutoff, finiteOr(this.context?.currentTime, 0)); this.sequence += 1; return true; }
	setVelocity(velocity) { if (this.disposed || !this.panner) return false; try { const vx = finiteOr(velocity?.x, 0); const vy = finiteOr(velocity?.y, 0); const vz = finiteOr(velocity?.z, 0); if ('orientationX' in this.panner && this.panner.orientationX) { setParam(this.panner.orientationX, vx || 0, this.context?.currentTime ?? 0); setParam(this.panner.orientationY, vy || 0, this.context?.currentTime ?? 0); setParam(this.panner.orientationZ, vz || -1, this.context?.currentTime ?? 0); } } catch {} this.sequence += 1; return true; }
	attachSourceNode(sourceNode) { if (this.disposed || !sourceNode) return false; disconnect(this.sourceNode); this.sourceNode = sourceNode; return connect(sourceNode, this.panner); }
	detachSourceNode() { disconnect(this.sourceNode); this.sourceNode = null; }
	snapshot() { return freeze({ version: 1, disposed: this.disposed, supported: this.supported, sequence: this.sequence, id: typeof this.source.id === 'string' ? this.source.id : null, hasSourceNode: Boolean(this.sourceNode), position: { ...(this.source.position ?? { x: 0, y: 0, z: 0 }) } }); }
	dispose() { if (this.disposed) return; this.disposed = true; stop(this.sourceNode); disconnect(this.sourceNode); disconnect(this.panner); disconnect(this.filter); disconnect(this.gainNode); this.sourceNode = null; this.panner = null; this.filter = null; this.gainNode = null; this.supported = false; }
}

export class SpatialPannerAdapter {
	constructor({ context = null, destination = null, maxSources = DEFAULTS.maxSources, policy = {} } = {}) { this.context = context; this.destination = destination; this.maxSources = clamp(Math.round(finiteOr(maxSources, DEFAULTS.maxSources)), 1, 128); this.policy = policy; this.handles = new Map(); this.sequence = 0; this.disposed = false; }
	create(source) { if (this.disposed || this.handles.size >= this.maxSources) return null; const id = String(source?.id ?? `source-${this.handles.size + 1}`).slice(0, 96); const handle = new SpatialPannerHandle({ context: this.context, destination: this.destination, source: { ...source, id }, policy: this.policy }); if (!handle.supported) return null; this.handles.set(id, handle); this.sequence += 1; return handle; }
	get(id) { return this.handles.get(String(id)) ?? null; }
	remove(id) { const key = String(id); const handle = this.handles.get(key); if (!handle) return false; handle.dispose(); this.handles.delete(key); this.sequence += 1; return true; }
	clear() { for (const handle of this.handles.values()) handle.dispose(); this.handles.clear(); this.sequence += 1; }
	snapshot() { return freeze({ version: 1, disposed: this.disposed, sequence: this.sequence, maxSources: this.maxSources, active: this.handles.size, handles: [...this.handles.values()].map((handle) => handle.snapshot()) }); }
	dispose() { if (this.disposed) return; this.disposed = true; this.clear(); }
}

export function createSpatialPannerAdapter(options) { return new SpatialPannerAdapter(options); }
export function spatialPannerDefaults() { return freeze(DEFAULTS); }
