/**
 * Strict runtime signal adapters.
 *
 * External browser signals are normalized here into immutable, bounded contracts. The module remains
 * renderer/gameplay agnostic and therefore safe to consume from the modern runtime composition layer.
 */
import { clamp, finiteOr, integerOr } from './modernRuntimeContract.ts';

export type VisibilityState = 'visible' | 'hidden' | 'prerender' | 'unknown';
export type ViewportOrientation = 'portrait' | 'landscape' | 'unknown';

export interface NetworkSignalInput {
  readonly online?: boolean;
  readonly saveData?: boolean;
  readonly effectiveType?: string;
  readonly rttMs?: number | null;
  readonly downlinkMbps?: number | null;
}
export interface NormalizedNetworkSignal {
  readonly online: boolean;
  readonly saveData: boolean;
  readonly effectiveType: string;
  readonly rttMs: number | null;
  readonly downlinkMbps: number | null;
}
export interface BatterySignalInput {
  readonly level?: number | null;
  readonly charging?: boolean | null;
  readonly chargingTime?: number | null;
  readonly dischargingTime?: number | null;
}
export interface NormalizedBatterySignal {
  readonly supported: boolean;
  readonly level: number | null;
  readonly charging: boolean | null;
  readonly chargingTimeMs: number | null;
  readonly dischargingTimeMs: number | null;
}
export interface LowPowerModeInput {
  readonly saveData?: boolean;
  readonly batteryLevel?: number | null;
  readonly charging?: boolean | null;
  readonly hidden?: boolean;
}
export interface ViewportSignalInput {
  readonly width?: number;
  readonly height?: number;
  readonly dpr?: number;
  readonly orientation?: string;
}
export interface NormalizedViewportSignal {
  readonly width: number;
  readonly height: number;
  readonly dpr: number;
  readonly orientation: ViewportOrientation;
}
export interface PresentationDensityInput {
  readonly qualityScale?: number;
  readonly viewportWidth?: number;
  readonly entityCount?: number;
  readonly lowPower?: boolean;
}
export interface StreamingSignalInput {
  readonly distance?: number;
  readonly playerSpeed?: number;
  readonly density?: number;
  readonly qualityTier?: string;
}
export interface PointerSignalInput {
  readonly locked?: boolean;
  readonly dx?: number;
  readonly dy?: number;
  readonly buttons?: number;
}
export interface NormalizedPointerSignal {
  readonly locked: boolean;
  readonly dx: number;
  readonly dy: number;
  readonly buttons: number;
}
export interface GamepadSignalInput {
  readonly connected?: boolean;
  readonly index?: number;
  readonly axes?: readonly unknown[];
  readonly buttons?: readonly unknown[];
}
export interface NormalizedGamepadSignal {
  readonly connected: boolean;
  readonly index: number;
  readonly axes: readonly number[];
  readonly buttons: readonly number[];
}

const QUALITY_ORDER = ['minimal', 'low', 'medium', 'high', 'ultra'] as const;

export function normalizeNetworkSignal(connection: NetworkSignalInput = {}): NormalizedNetworkSignal {
  return Object.freeze({
    online: connection.online !== false,
    saveData: Boolean(connection.saveData),
    effectiveType: String(connection.effectiveType || 'unknown'),
    rttMs: connection.rttMs == null ? null : clamp(finiteOr(connection.rttMs, 0), 0, 10000),
    downlinkMbps: connection.downlinkMbps == null ? null : clamp(finiteOr(connection.downlinkMbps, 0), 0, 10000),
  });
}

export function normalizeVisibilitySignal(state: unknown): Readonly<{ state: VisibilityState; active: boolean; throttled: boolean }> {
  const value = String(state || 'unknown') as VisibilityState;
  if (value === 'visible') return Object.freeze({ state: value, active: true, throttled: false });
  if (value === 'hidden' || value === 'prerender') return Object.freeze({ state: value, active: false, throttled: true });
  return Object.freeze({ state: 'unknown' as const, active: false, throttled: true });
}

export function normalizeBatterySignal(battery: BatterySignalInput | null = null): NormalizedBatterySignal {
  const present = Boolean(battery);
  return Object.freeze({
    supported: present && ('level' in (battery ?? {}) || 'charging' in (battery ?? {})),
    level: battery?.level == null ? null : clamp(finiteOr(battery.level, 1), 0, 1),
    charging: battery?.charging == null ? null : Boolean(battery.charging),
    chargingTimeMs: battery?.chargingTime == null ? null : Math.max(0, finiteOr(battery.chargingTime, 0) * 1000),
    dischargingTimeMs: battery?.dischargingTime == null ? null : Math.max(0, finiteOr(battery.dischargingTime, 0) * 1000),
  });
}

export function shouldEnterLowPowerMode({
  saveData = false,
  batteryLevel = null,
  charging = null,
  hidden = false,
}: LowPowerModeInput = {}): boolean {
  if (hidden || saveData) return true;
  return batteryLevel != null && charging === false && finiteOr(batteryLevel, 1) <= 0.15;
}

export function normalizeViewportSignal(viewport: ViewportSignalInput = {}): NormalizedViewportSignal {
  const orientation: ViewportOrientation =
    viewport.orientation === 'portrait' || viewport.orientation === 'landscape'
      ? viewport.orientation
      : 'unknown';
  return Object.freeze({
    width: clamp(integerOr(viewport.width, 0), 0, 10000),
    height: clamp(integerOr(viewport.height, 0), 0, 10000),
    dpr: clamp(finiteOr(viewport.dpr, 1), 0.5, 4),
    orientation,
  });
}

export function computePresentationDensity({
  qualityScale = 1,
  viewportWidth = 1920,
  entityCount = 0,
  lowPower = false,
}: PresentationDensityInput = {}): number {
  const scale = clamp(finiteOr(qualityScale, 1), 0.25, 2);
  const widthFactor = clamp(finiteOr(viewportWidth, 1920) / 1920, 0.5, 1.5);
  const count = Math.max(0, integerOr(entityCount, 0));
  const entityFactor = count > 5000 ? 0.75 : count > 2500 ? 0.9 : 1;
  const powerFactor = lowPower ? 0.65 : 1;
  return clamp(scale * widthFactor * entityFactor * powerFactor, 0.2, 1.5);
}

export function buildStreamingSignal({
  distance = 0,
  playerSpeed = 0,
  density = 1,
  qualityTier = 'medium',
}: StreamingSignalInput = {}): Readonly<{ priority: number; density: number; prefetch: boolean }> {
  const tierIndex = Math.max(0, QUALITY_ORDER.indexOf(qualityTier as (typeof QUALITY_ORDER)[number]));
  const base = clamp(1 - finiteOr(distance, 0) / 1000, 0, 1);
  const speedBoost = clamp(finiteOr(playerSpeed, 0) / 15, 0, 1) * 0.25;
  const tierBoost = tierIndex * 0.05;
  return Object.freeze({
    priority: clamp(base + speedBoost + tierBoost, 0, 1),
    density: clamp(finiteOr(density, 1), 0.1, 1.5),
    prefetch: base > 0.25,
  });
}

export function normalizePointerSignal(input: PointerSignalInput = {}): NormalizedPointerSignal {
  return Object.freeze({
    locked: Boolean(input.locked),
    dx: clamp(finiteOr(input.dx, 0), -500, 500),
    dy: clamp(finiteOr(input.dy, 0), -500, 500),
    buttons: clamp(integerOr(input.buttons, 0), 0, 32),
  });
}

export function normalizeGamepadSignal(gamepad: GamepadSignalInput = {}): NormalizedGamepadSignal {
  const axes = Array.isArray(gamepad.axes)
    ? gamepad.axes.slice(0, 8).map((value) => clamp(finiteOr(value, 0), -1, 1))
    : [];
  const buttons = Array.isArray(gamepad.buttons)
    ? gamepad.buttons.slice(0, 32).map((button) => {
        const value = typeof button === 'object' && button !== null && 'value' in button
          ? (button as { readonly value?: unknown }).value
          : button;
        return clamp(finiteOr(value, 0), 0, 1);
      })
    : [];
  return Object.freeze({
    connected: gamepad.connected !== false,
    index: Math.max(0, integerOr(gamepad.index, 0)),
    axes: Object.freeze(axes),
    buttons: Object.freeze(buttons),
  });
}
