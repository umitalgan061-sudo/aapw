/**
 * Device capability profiling for the shipped 3D runtime.
 *
 * The profiler is intentionally side-effect free. It receives optional platform probes so tests can
 * provide deterministic fixtures without constructing a browser, WebGL context, or media query
 * implementation. The resulting profile is immutable and conservative: missing browser APIs never
 * escalate a device into a higher capability tier.
 *
 * The profile is a policy input, not an owner. Renderers, asset loaders, animation systems and world
 * streaming remain responsible for their own state. This module only answers "what can this session
 * reasonably afford?" and exposes stable feature flags for those existing owners.
 */

const CAPABILITY_TIERS = Object.freeze({
	MINIMAL: 'minimal',
	BALANCED: 'balanced',
	HIGH: 'high',
	ULTRA: 'ultra',
});

const POINTER_CLASSES = Object.freeze({
	COARSE: 'coarse',
	FINE: 'fine',
	UNKNOWN: 'unknown',
});

const NETWORK_CLASSES = Object.freeze({
	OFFLINE: 'offline',
	CONSTRAINED: 'constrained',
	NORMAL: 'normal',
	FAST: 'fast',
	UNKNOWN: 'unknown',
});

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const finiteOr = (value, fallback) => Number.isFinite(value) ? value : fallback;

function normalizeHardwareConcurrency(value) {
	return clamp(Math.round(finiteOr(value, 2)), 1, 64);
}

function normalizeDeviceMemory(value) {
	if (!Number.isFinite(value) || value <= 0) return null;
	return clamp(value, 0.25, 128);
}

function normalizeDpr(value) {
	return clamp(finiteOr(value, 1), 0.5, 8);
}

function normalizeViewport(value) {
	return clamp(Math.round(finiteOr(value, 0)), 0, 16384);
}

function normalizeWebglVersion(value) {
	return value === 2 ? 2 : value === 1 ? 1 : 0;
}

function classifyPointer(coarsePointer, finePointer) {
	if (coarsePointer === true) return POINTER_CLASSES.COARSE;
	if (finePointer === true) return POINTER_CLASSES.FINE;
	return POINTER_CLASSES.UNKNOWN;
}

function classifyNetwork({ online, saveData, effectiveType }) {
	if (online === false) return NETWORK_CLASSES.OFFLINE;
	const normalized = typeof effectiveType === 'string' ? effectiveType.toLowerCase() : '';
	if (saveData || /2g|slow-2g/.test(normalized)) return NETWORK_CLASSES.CONSTRAINED;
	if (/4g/.test(normalized)) return NETWORK_CLASSES.FAST;
	if (/3g/.test(normalized)) return NETWORK_CLASSES.NORMAL;
	return NETWORK_CLASSES.UNKNOWN;
}

function scoreHardware({ cpu, memory, webglVersion, maxTextureSize, dpr, mobileLike }) {
	let score = 0;
	score += clamp((cpu - 1) / 15, 0, 1) * 3;
	score += clamp(((memory ?? 4) - 2) / 14, 0, 1) * 2;
	score += webglVersion === 2 ? 2 : webglVersion === 1 ? 0.8 : 0;
	score += clamp(((maxTextureSize ?? 2048) - 2048) / 8192, 0, 1) * 2;
	score += clamp((dpr - 1) / 2, 0, 1) * 0.5;
	if (mobileLike) score -= 1.2;
	return clamp(score, 0, 9.5);
}

function classifyTier(score, { mobileLike, reducedMotion, saveData }) {
	if (reducedMotion || saveData) return CAPABILITY_TIERS.BALANCED;
	if (mobileLike) return score >= 5 ? CAPABILITY_TIERS.BALANCED : CAPABILITY_TIERS.MINIMAL;
	if (score >= 8) return CAPABILITY_TIERS.ULTRA;
	if (score >= 5.5) return CAPABILITY_TIERS.HIGH;
	if (score >= 2.5) return CAPABILITY_TIERS.BALANCED;
	return CAPABILITY_TIERS.MINIMAL;
}

function readWebglCaps(gl) {
	if (!gl) {
		return Object.freeze({ version: 0, maxTextureSize: null, maxTextureUnits: null, renderer: null, vendor: null });
	}
	const debugExt = gl.getExtension?.('WEBGL_debug_renderer_info');
	const renderer = debugExt ? gl.getParameter?.(debugExt.UNMASKED_RENDERER_WEBGL) : null;
	const vendor = debugExt ? gl.getParameter?.(debugExt.UNMASKED_VENDOR_WEBGL) : null;
	return Object.freeze({
		version: typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext ? 2 : 1,
		maxTextureSize: finiteOr(gl.getParameter?.(gl.MAX_TEXTURE_SIZE), null),
		maxTextureUnits: finiteOr(gl.getParameter?.(gl.MAX_TEXTURE_IMAGE_UNITS), null),
		renderer: typeof renderer === 'string' ? renderer.slice(0, 160) : null,
		vendor: typeof vendor === 'string' ? vendor.slice(0, 160) : null,
	});
}

export function createDeviceCapabilities(input = {}) {
	const nav = input.navigator ?? (typeof navigator !== 'undefined' ? navigator : null);
	const win = input.window ?? (typeof window !== 'undefined' ? window : null);
	const connection = input.connection ?? nav?.connection ?? nav?.mozConnection ?? nav?.webkitConnection ?? null;
	const media = input.media ?? ((query) => win?.matchMedia?.(query)?.matches ?? false);
	const dpr = normalizeDpr(input.devicePixelRatio ?? win?.devicePixelRatio);
	const width = normalizeViewport(input.viewportWidth ?? win?.innerWidth);
	const height = normalizeViewport(input.viewportHeight ?? win?.innerHeight);
	const coarsePointer = Boolean(input.coarsePointer ?? media('(pointer: coarse)'));
	const finePointer = Boolean(input.finePointer ?? media('(pointer: fine)'));
	const reducedMotion = Boolean(input.reducedMotion ?? media('(prefers-reduced-motion: reduce)'));
	const prefersContrast = Boolean(input.prefersContrast ?? media('(prefers-contrast: more)'));
	const mobileLike = coarsePointer || Boolean(input.mobileLike) || /Android|iPhone|iPad|Mobile/i.test(nav?.userAgent ?? '');
	const webgl = input.webgl ?? readWebglCaps(input.gl ?? null);
	const cpu = normalizeHardwareConcurrency(input.hardwareConcurrency ?? nav?.hardwareConcurrency);
	const memory = normalizeDeviceMemory(input.deviceMemory ?? nav?.deviceMemory);
	const maxTextureSize = finiteOr(webgl.maxTextureSize, null);
	const score = scoreHardware({ cpu, memory, webglVersion: normalizeWebglVersion(webgl.version), maxTextureSize, dpr, mobileLike });
	const saveData = Boolean(input.saveData ?? connection?.saveData);
	const networkClass = classifyNetwork({ online: input.online ?? (typeof navigator !== 'undefined' ? navigator.onLine : true), saveData, effectiveType: input.effectiveType ?? connection?.effectiveType });
	const tier = classifyTier(score, { mobileLike, reducedMotion, saveData });

	const capabilities = {
		version: 1,
		tier,
		score: Number(score.toFixed(3)),
		cpu: { logicalCores: cpu, sharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined' && Boolean(globalThis.crossOriginIsolated) },
		memory: { deviceGb: memory },
		display: { dpr, width, height, pixels: width * height, highDensity: dpr >= 1.75 },
		pointer: { class: classifyPointer(coarsePointer, finePointer), coarse: coarsePointer, fine: finePointer },
		accessibility: { reducedMotion, prefersContrast },
		network: { class: networkClass, saveData },
		webgl: Object.freeze({
			version: normalizeWebglVersion(webgl.version),
			available: normalizeWebglVersion(webgl.version) > 0,
			maxTextureSize,
			maxTextureUnits: finiteOr(webgl.maxTextureUnits, null),
			renderer: webgl.renderer ?? null,
			vendor: webgl.vendor ?? null,
		}),
		features: Object.freeze({
			enableShadows: !mobileLike && !reducedMotion && networkClass !== NETWORK_CLASSES.CONSTRAINED,
			enableHighFrequencyAnimation: !mobileLike && !reducedMotion,
			enableHeavyAssetPrefetch: networkClass === NETWORK_CLASSES.FAST && !saveData,
			enableTextureUpgrade: score >= 5.5 && maxTextureSize !== null && maxTextureSize >= 4096,
			enableLongRangeStreaming: !mobileLike && score >= 5.5,
		}),
	};
	return deepFreeze(capabilities);
}

function deepFreeze(value) {
	if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
	Object.freeze(value);
	for (const child of Object.values(value)) deepFreeze(child);
	return value;
}

export function summarizeDeviceCapabilities(capabilities) {
	if (!capabilities || typeof capabilities !== 'object') return 'unknown-device';
	return [
		`v${capabilities.version ?? 0}`,
		capabilities.tier ?? CAPABILITY_TIERS.MINIMAL,
		`cpu${capabilities.cpu?.logicalCores ?? 0}`,
		`mem${capabilities.memory?.deviceGb ?? 'na'}`,
		`dpr${capabilities.display?.dpr ?? 1}`,
		`webgl${capabilities.webgl?.version ?? 0}`,
		capabilities.network?.class ?? NETWORK_CLASSES.UNKNOWN,
		capabilities.pointer?.class ?? POINTER_CLASSES.UNKNOWN,
	].join('|');
}

export function getCapabilityTierConstants() {
	return { tiers: CAPABILITY_TIERS, pointers: POINTER_CLASSES, networks: NETWORK_CLASSES };
}
