/**
 * Device/audio diagnostics contract.
 *
 * Converts browser capability signals into a small immutable report for telemetry and QA.
 * It deliberately does not create AudioContext instances, access media devices, or mutate output state.
 */

const clamp01 = (value) => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
const positiveInt = (value, fallback = 0) => Math.max(0, Math.floor(Number.isFinite(value) ? value : fallback));

export const AUDIO_DEVICE_CLASSES = Object.freeze({
	WEB_AUDIO: 'web-audio',
	WEB_AUDIO_LIMITED: 'web-audio-limited',
	UNAVAILABLE: 'unavailable',
});

export function resolveAudioDeviceDiagnostics({
	webAudio = true,
	audioWorklet = false,
	mediaSession = false,
	outputChannels = 2,
	baseLatency = 0,
	outputLatency = 0,
	maxChannelCount = 2,
	contextState = 'suspended',
	userGestureRequired = true,
} = {}) {
	const channels = positiveInt(outputChannels, 2);
	const maxChannels = Math.max(channels, positiveInt(maxChannelCount, 2));
	const latency = Math.max(0, Number.isFinite(baseLatency) ? baseLatency : 0);
	const output = Math.max(0, Number.isFinite(outputLatency) ? outputLatency : 0);
	const usable = !!webAudio;
	const advanced = usable && !!audioWorklet;
	const deviceClass = !usable
		? AUDIO_DEVICE_CLASSES.UNAVAILABLE
		: advanced && maxChannels >= 2
			? AUDIO_DEVICE_CLASSES.WEB_AUDIO
			: AUDIO_DEVICE_CLASSES.WEB_AUDIO_LIMITED;
	const readiness = usable
		? contextState === 'running'
			? 1
			: userGestureRequired
			? 0.72
			: 0.55
		: 0;
	return Object.freeze({
		version: 1,
		deviceClass,
		webAudioSupported: usable,
		audioWorkletSupported: !!audioWorklet,
		mediaSessionSupported: !!mediaSession,
		outputChannels: channels,
		maxChannelCount: maxChannels,
		baseLatency: Number(latency.toFixed(6)),
		outputLatency: Number(output.toFixed(6)),
		contextState: String(contextState ?? 'unknown'),
		userGestureRequired: !!userGestureRequired,
		readiness: clamp01(readiness),
		canRunSpatial: usable && maxChannels >= 2,
		canRunAdvancedGraph: advanced,
	});
}

export function validateAudioDeviceDiagnostics(report) {
	return Boolean(
		report?.version === 1 &&
		Object.values(AUDIO_DEVICE_CLASSES).includes(report.deviceClass) &&
		report.outputChannels >= 0 &&
		report.maxChannelCount >= report.outputChannels &&
		report.baseLatency >= 0 &&
		report.outputLatency >= 0 &&
		report.readiness >= 0 && report.readiness <= 1 &&
		typeof report.canRunSpatial === 'boolean' &&
		typeof report.canRunAdvancedGraph === 'boolean',
	);
}

export function summarizeAudioDeviceDiagnostics(reports = []) {
	const valid = reports.filter(validateAudioDeviceDiagnostics);
	const spatialReady = valid.filter((report) => report.canRunSpatial).length;
	const advancedReady = valid.filter((report) => report.canRunAdvancedGraph).length;
	const averageReadiness = valid.length
		? valid.reduce((sum, report) => sum + report.readiness, 0) / valid.length
		: 0;
	return Object.freeze({
		version: 1,
		total: reports.length,
		valid: valid.length,
		spatialReady,
		advancedReady,
		averageReadiness: Number(averageReadiness.toFixed(6)),
	});
}
