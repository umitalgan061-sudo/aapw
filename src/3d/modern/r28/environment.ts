export interface BrowserCapabilities {
  readonly secureContext: boolean;
  readonly webgl: boolean;
  readonly webgpu: boolean;
  readonly worker: boolean;
  readonly sharedArrayBuffer: boolean;
  readonly hardwareConcurrency: number;
  readonly deviceMemoryGb: number | null;
  readonly touch: boolean;
  readonly saveStorage: boolean;
}

export interface RuntimeEnvironmentProfile {
  readonly capabilities: BrowserCapabilities;
  readonly qualityHint: 0 | 1 | 2 | 3 | 4;
  readonly reason: readonly string[];
}

function detectWebGl(): boolean {
  if (typeof document === 'undefined') return false;
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

function detectWebGpu(): boolean {
  return typeof navigator !== 'undefined' && 'gpu' in navigator;
}

export function readBrowserCapabilities(): BrowserCapabilities {
  const storage = typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
  const memory = typeof navigator !== 'undefined' && 'deviceMemory' in navigator
    ? Number((navigator as Navigator & { deviceMemory?: number }).deviceMemory)
    : Number.NaN;
  return Object.freeze({
    secureContext: typeof window !== 'undefined' ? window.isSecureContext : false,
    webgl: detectWebGl(),
    webgpu: detectWebGpu(),
    worker: typeof Worker !== 'undefined',
    sharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined',
    hardwareConcurrency: Math.max(1, Number(typeof navigator !== 'undefined' ? navigator.hardwareConcurrency ?? 1 : 1)),
    deviceMemoryGb: Number.isFinite(memory) ? memory : null,
    touch: typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0,
    saveStorage: storage,
  });
}

export function profileRuntimeEnvironment(capabilities = readBrowserCapabilities()): RuntimeEnvironmentProfile {
  const reason: string[] = [];
  let quality: 0 | 1 | 2 | 3 | 4 = 2;
  if (!capabilities.webgl) {
    quality = 0;
    reason.push('webgl-unavailable');
  } else if (capabilities.webgpu && capabilities.hardwareConcurrency >= 8 && (capabilities.deviceMemoryGb ?? 8) >= 8) {
    quality = 4;
    reason.push('high-capability');
  } else if (capabilities.hardwareConcurrency >= 4 && (capabilities.deviceMemoryGb ?? 4) >= 4) {
    quality = 3;
    reason.push('mid-high-capability');
  } else if (capabilities.touch || capabilities.hardwareConcurrency <= 2) {
    quality = 1;
    reason.push('mobile-or-constrained');
  } else {
    reason.push('balanced-default');
  }
  if (!capabilities.secureContext) reason.push('insecure-context');
  if (!capabilities.worker) reason.push('worker-unavailable');
  return Object.freeze({ capabilities, qualityHint: quality, reason });
}

export function clampDevicePixelRatio(devicePixelRatio: number, qualityLevel: number): number {
  const dpr = Number.isFinite(devicePixelRatio) ? Math.max(1, devicePixelRatio) : 1;
  const cap = qualityLevel >= 4 ? 2.5 : qualityLevel >= 3 ? 2 : qualityLevel >= 2 ? 1.75 : qualityLevel >= 1 ? 1.5 : 1;
  return Math.min(dpr, cap);
}
