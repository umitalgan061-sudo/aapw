/**
 * Deterministic, privacy-safe audio state snapshots.
 *
 * Captures policy state without Web Audio node graphs. This gives the runtime a durable diagnostic and
 * save/debug seam while keeping browser-native AudioNodes out of serialization and avoiding user data.
 */

const MAX_SOURCE_RECORDS = 24;
const MAX_TEXT = 96;
const freeze = (value) => { if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value; Object.freeze(value); for (const child of Object.values(value)) freeze(child); return value; };
const num = (value, fallback = 0) => Number.isFinite(value) ? Number(value.toFixed(5)) : fallback;
const text = (value, fallback = 'unknown') => typeof value === 'string' && value.length ? value.slice(0, MAX_TEXT) : fallback;
const bool = (value) => value === true;

function sourceRecord(source) {
	return { id: text(source?.id, 'source'), class: text(source?.class, 'ambience'), priority: Math.max(0, Math.min(100, Math.round(Number(source?.priority ?? 0)))), gain: num(source?.gain, 0), state: text(source?.state, 'registered'), positional: bool(source?.positional), position: { x: num(source?.position?.x), y: num(source?.position?.y), z: num(source?.position?.z) } };
}

export function createAudioSnapshot({ director = null } = {}) {
	const source = director?.snapshot?.() ?? director ?? {};
	const registry = source.registry ?? {};
	const policy = source.policy ?? {};
	const snapshot = {
		version: 1,
		quality: text(source.quality, 'balanced'),
		enabled: bool(source.enabled),
		sequence: Math.max(0, Math.round(Number(source.sequence ?? 0))),
		listener: { position: { ...(source.listener?.position ?? { x: 0, y: 0, z: 0 }) }, forward: { ...(source.listener?.forward ?? { x: 0, y: 0, z: -1 }) } },
		environment: text(source.soundscape?.environment, 'unknown'),
		policy: {
			maxDistance: num(policy.listener?.maxDistance, 120),
			masterVolume: num(policy.listener?.masterVolume, 1),
			maxSources: Math.max(0, Math.round(Number(policy.limits?.maxSources ?? 0))),
			maxPositionalSources: Math.max(0, Math.round(Number(policy.limits?.maxPositionalSources ?? 0))),
		},
		duckGains: { ...(source.duck?.gains ?? {}) },
		soundscape: { ...(source.soundscape?.layers ?? {}) },
		accessibility: {
			profile: text(source.accessibility?.profile, 'full'),
			reducedDynamicRange: bool(source.accessibility?.dynamicRange?.compressorRatio > 3),
			monoCenter: bool(source.accessibility?.spatial?.monoCenter),
		},
		sources: (registry.sources ?? []).slice(0, MAX_SOURCE_RECORDS).map(sourceRecord),
	};
	return freeze(snapshot);
}

export function serializeAudioSnapshot(input) { return JSON.stringify(createAudioSnapshot(input)); }

export function audioSnapshotDigest(snapshot) {
	const textValue = typeof snapshot === 'string' ? snapshot : serializeAudioSnapshot(snapshot);
	let hash = 2166136261;
	for (let index = 0; index < textValue.length; index += 1) { hash ^= textValue.charCodeAt(index); hash = Math.imul(hash, 16777619) >>> 0; }
	return hash.toString(16).padStart(8, '0');
}

export function restoreAudioSnapshot(snapshot, director) {
	const source = snapshot && typeof snapshot === 'object' ? snapshot : {};
	if (!director || director.disposed) return { restored: false, reason: 'director-unavailable' };
	if (source.listener?.position) director.setListenerPose(source.listener.position, source.listener.forward ?? { x: 0, y: 0, z: -1 });
	if (typeof source.environment === 'string') director.setEnvironment(source.environment, {});
	if (Number.isFinite(source.policy?.masterVolume)) director.setMasterVolume(source.policy.masterVolume);
	return freeze({ restored: true, quality: text(source.quality), environment: text(source.environment), digest: audioSnapshotDigest(source) });
}
