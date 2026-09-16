import { freeze, type Result, err, ok } from '../domain/contracts.ts';

export type CapabilityName =
  | 'webgl2'
  | 'webgpu'
  | 'offscreenCanvas'
  | 'sharedArrayBuffer'
  | 'webAudio'
  | 'gamepad'
  | 'touch'
  | 'serviceWorker'
  | 'persistentStorage'
  | 'indexedDb'
  | 'broadcastChannel'
  | 'viewTransitions'
  | 'scheduler'
  | 'intersectionObserver'
  | 'resizeObserver';

export interface CapabilityStatus {
  readonly name: CapabilityName;
  readonly supported: boolean;
  readonly secureContext: boolean;
  readonly detail: string;
  readonly detectedAt: number;
}

export interface CapabilitySnapshot {
  readonly secureContext: boolean;
  readonly statuses: Readonly<Record<CapabilityName, CapabilityStatus>>;
  readonly supported: readonly CapabilityName[];
  readonly unsupported: readonly CapabilityName[];
}

const names: readonly CapabilityName[] = [
  'webgl2','webgpu','offscreenCanvas','sharedArrayBuffer','webAudio','gamepad','touch',
  'serviceWorker','persistentStorage','indexedDb','broadcastChannel','viewTransitions',
  'scheduler','intersectionObserver','resizeObserver',
];

const hasWindow = (): boolean => typeof window !== 'undefined';
const secure = (): boolean => typeof window !== 'undefined' && window.isSecureContext === true;
const detect = (name: CapabilityName): boolean => {
  if (!hasWindow()) return false;
  switch (name) {
    case 'webgl2': {
      const canvas = document.createElement('canvas');
      return Boolean(canvas.getContext('webgl2'));
    }
    case 'webgpu': return 'gpu' in navigator;
    case 'offscreenCanvas': return 'OffscreenCanvas' in window;
    case 'sharedArrayBuffer': return 'SharedArrayBuffer' in window && secure();
    case 'webAudio': return 'AudioContext' in window || 'webkitAudioContext' in window;
    case 'gamepad': return 'getGamepads' in navigator;
    case 'touch': return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    case 'serviceWorker': return 'serviceWorker' in navigator;
    case 'persistentStorage': return 'storage' in navigator && 'persist' in navigator.storage;
    case 'indexedDb': return 'indexedDB' in window;
    case 'broadcastChannel': return 'BroadcastChannel' in window;
    case 'viewTransitions': return 'startViewTransition' in document;
    case 'scheduler': return 'scheduler' in window;
    case 'intersectionObserver': return 'IntersectionObserver' in window;
    case 'resizeObserver': return 'ResizeObserver' in window;
  }
};

export const detectCapabilities = (now = () => Date.now()): CapabilitySnapshot => {
  const secureContext = secure();
  const statuses = {} as Record<CapabilityName, CapabilityStatus>;
  for (const name of names) {
    const supported = detect(name);
    statuses[name] = freeze({
      name,
      supported,
      secureContext,
      detectedAt: now(),
      detail: supported ? 'available' : 'unavailable',
    });
  }
  return freeze({
    secureContext,
    statuses,
    supported: names.filter((name) => statuses[name]?.supported),
    unsupported: names.filter((name) => !statuses[name]?.supported),
  });
};

export interface CapabilityRequirement {
  readonly name: CapabilityName;
  readonly required?: boolean;
  readonly reason?: string;
}

export interface CapabilityGateResult {
  readonly allowed: boolean;
  readonly missing: readonly CapabilityName[];
  readonly optionalMissing: readonly CapabilityName[];
  readonly reasons: readonly string[];
}

export const evaluateCapabilities = (
  snapshot: CapabilitySnapshot,
  requirements: readonly CapabilityRequirement[],
): CapabilityGateResult => {
  const missing: CapabilityName[] = [];
  const optionalMissing: CapabilityName[] = [];
  const reasons: string[] = [];
  for (const requirement of requirements) {
    const status = snapshot.statuses[requirement.name];
    if (status?.supported) continue;
    (requirement.required === false ? optionalMissing : missing).push(requirement.name);
    if (requirement.reason) reasons.push(requirement.reason);
  }
  return freeze({ allowed: missing.length === 0, missing, optionalMissing, reasons });
};

export const requireCapability = (snapshot: CapabilitySnapshot, name: CapabilityName): Result<CapabilityStatus> => {
  const status = snapshot.statuses[name];
  if (!status?.supported) return err({ code: 'CAPABILITY_MISSING', message: `Capability ${name} is unavailable.` });
  return ok(status);
};

export const preferredRenderBackend = (snapshot: CapabilitySnapshot): 'webgpu' | 'webgl2' | 'canvas' => {
  if (snapshot.statuses.webgpu?.supported) return 'webgpu';
  if (snapshot.statuses.webgl2?.supported) return 'webgl2';
  return 'canvas';
};

export const preferredInputMode = (snapshot: CapabilitySnapshot): 'touch' | 'gamepad' | 'keyboard' => {
  if (snapshot.statuses.touch?.supported) return 'touch';
  if (snapshot.statuses.gamepad?.supported) return 'gamepad';
  return 'keyboard';
};
