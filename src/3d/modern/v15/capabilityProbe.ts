import type { DeviceCapabilitiesV15, RendererBackendV15 } from "./types.ts";

interface BatteryManagerLike {
  readonly charging: boolean;
  readonly level: number;
}

interface WebGpuLike { readonly requestAdapter?: () => Promise<unknown> }
interface NavigatorLike {
  readonly gpu?: WebGpuLike;
  readonly hardwareConcurrency?: number;
  readonly deviceMemory?: number;
  readonly userAgent?: string;
  readonly maxTouchPoints?: number;
  readonly getBattery?: () => Promise<BatteryManagerLike>;
}
interface WindowLike {
  readonly matchMedia?: (query: string) => { readonly matches: boolean };
  readonly devicePixelRatio?: number;
}
interface CanvasLike { getContext(contextId: string): unknown }

export interface CapabilityProbeEnvironment {
  readonly navigator?: NavigatorLike;
  readonly window?: WindowLike;
  readonly canvas?: CanvasLike;
  readonly now?: () => number;
}

function getNavigator(env: CapabilityProbeEnvironment): NavigatorLike | undefined {
  return env.navigator ?? (typeof globalThis.navigator !== "undefined" ? globalThis.navigator as unknown as NavigatorLike : undefined);
}

function getWindow(env: CapabilityProbeEnvironment): WindowLike | undefined {
  return env.window ?? (typeof globalThis.window !== "undefined" ? globalThis.window as unknown as WindowLike : undefined);
}

function media(env: WindowLike | undefined, query: string): boolean {
  try { return Boolean(env?.matchMedia?.(query).matches); } catch { return false; }
}

function hasWebGl2(canvas: CanvasLike | undefined): boolean {
  try { return Boolean(canvas?.getContext("webgl2")); } catch { return false; }
}

async function hasWebGpu(navigatorLike: NavigatorLike | undefined): Promise<boolean> {
  try {
    if (!navigatorLike?.gpu?.requestAdapter) return false;
    return (await navigatorLike.gpu.requestAdapter()) != null;
  } catch {
    return false;
  }
}

async function detectBatterySaver(navigatorLike: NavigatorLike | undefined): Promise<boolean> {
  try {
    const battery = navigatorLike?.getBattery ? await navigatorLike.getBattery() : undefined;
    if (!battery) return false;
    return !battery.charging && battery.level <= 0.2;
  } catch {
    return false;
  }
}

function safeNumber(value: unknown, fallback: number): number {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function detectTouch(win: WindowLike | undefined, navigatorLike: NavigatorLike | undefined): boolean {
  return media(win, "(pointer: coarse)") || safeNumber(navigatorLike?.maxTouchPoints, 0) > 0;
}

function detectMobile(win: WindowLike | undefined, navigatorLike: NavigatorLike | undefined): boolean {
  const touch = detectTouch(win, navigatorLike);
  const narrow = media(win, "(max-width: 900px)");
  const ua = String(navigatorLike?.userAgent ?? "").toLowerCase();
  return touch || narrow || /android|iphone|ipad|ipod|mobile/.test(ua);
}

export async function probeCapabilitiesV15(environment: CapabilityProbeEnvironment = {}): Promise<DeviceCapabilitiesV15> {
  const navigatorLike = getNavigator(environment);
  const win = getWindow(environment);
  const canvas = environment.canvas;
  const webgpuAvailable = await hasWebGpu(navigatorLike);
  const webgl2Available = hasWebGl2(canvas);
  const touch = detectTouch(win, navigatorLike);
  const mobile = detectMobile(win, navigatorLike);
  const reducedMotion = media(win, "(prefers-reduced-motion: reduce)");
  const batterySaver = await detectBatterySaver(navigatorLike);
  const devicePixelRatio = Math.min(3, Math.max(1, safeNumber(win?.devicePixelRatio, 1)));
  const hardwareConcurrency = Math.max(1, Math.round(safeNumber(navigatorLike?.hardwareConcurrency, 4)));
  const memory = safeNumber(navigatorLike?.deviceMemory, NaN);
  const deviceMemoryGb = Number.isFinite(memory) && memory > 0 ? Math.min(64, memory) : null;
  const backend: RendererBackendV15 = webgpuAvailable ? "webgpu" : "webgl2";
  const timestamp = environment.now?.() ?? (typeof performance !== "undefined" ? performance.now() : Date.now());
  return Object.freeze({
    backend,
    webgpuAvailable,
    webgl2Available,
    mobile,
    touch,
    reducedMotion,
    batterySaver,
    hardwareConcurrency,
    deviceMemoryGb,
    devicePixelRatio,
    maxTextureDimension: null,
    timestamp,
  });
}

export function normalizeCapabilitiesV15(input: DeviceCapabilitiesV15): DeviceCapabilitiesV15 {
  return Object.freeze({
    ...input,
    hardwareConcurrency: Math.max(1, Math.round(input.hardwareConcurrency)),
    devicePixelRatio: Math.min(3, Math.max(1, input.devicePixelRatio)),
    deviceMemoryGb: input.deviceMemoryGb === null ? null : Math.min(64, Math.max(0.25, input.deviceMemoryGb)),
  });
}

export function capabilityKeyV15(capabilities: DeviceCapabilitiesV15): string {
  return [
    capabilities.backend,
    capabilities.mobile ? "m" : "d",
    capabilities.touch ? "t" : "p",
    capabilities.reducedMotion ? "r" : "n",
    capabilities.batterySaver ? "b" : "p",
    capabilities.hardwareConcurrency,
    capabilities.deviceMemoryGb ?? "unknown",
    capabilities.devicePixelRatio,
  ].join("|");
}
