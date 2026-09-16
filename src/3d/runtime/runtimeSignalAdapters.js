/**
 * Small adapters for common browser/runtime signals.
 *
 * They normalize external facts into the runtime contract without binding gameplay to browser APIs.
 */

import { clamp, finiteOr, integerOr } from './modernRuntimeContract.js';

export function normalizeNetworkSignal(connection = {}) {
  return Object.freeze({
    online: connection.online !== false,
    saveData: Boolean(connection.saveData),
    effectiveType: String(connection.effectiveType || 'unknown'),
    rttMs: connection.rttMs == null ? null : clamp(finiteOr(connection.rttMs, 0), 0, 10000),
    downlinkMbps: connection.downlinkMbps == null ? null : clamp(finiteOr(connection.downlinkMbps, 0), 0, 10000),
  });
}

export function normalizeVisibilitySignal(state) {
  const value = String(state || 'unknown');
  if (value === 'visible') return Object.freeze({ state: value, active: true, throttled: false });
  if (value === 'hidden' || value === 'prerender') return Object.freeze({ state: value, active: false, throttled: true });
  return Object.freeze({ state: 'unknown', active: false, throttled: true });
}

export function normalizeBatterySignal(battery = {}) {
  return Object.freeze({
    supported: Boolean(battery && ('level' in battery || 'charging' in battery)),
    level: battery?.level == null ? null : clamp(finiteOr(battery.level, 1), 0, 1),
    charging: battery?.charging == null ? null : Boolean(battery.charging),
    chargingTimeMs: battery?.chargingTime == null ? null : Math.max(0, finiteOr(battery.chargingTime, 0) * 1000),
    dischargingTimeMs: battery?.dischargingTime == null ? null : Math.max(0, finiteOr(battery.dischargingTime, 0) * 1000),
  });
}

export function shouldEnterLowPowerMode({ saveData = false, batteryLevel = null, charging = null, hidden = false } = {}) {
  if (hidden) return true;
  if (saveData) return true;
  if (batteryLevel != null && charging === false && finiteOr(batteryLevel, 1) <= 0.15) return true;
  return false;
}

export function normalizeViewportSignal(viewport = {}) {
  return Object.freeze({
    width: clamp(integerOr(viewport.width, 0), 0, 10000),
    height: clamp(integerOr(viewport.height, 0), 0, 10000),
    dpr: clamp(finiteOr(viewport.dpr, 1), 0.5, 4),
    orientation: ['portrait', 'landscape', 'unknown'].includes(viewport.orientation) ? viewport.orientation : 'unknown',
  });
}

export function computePresentationDensity({ qualityScale = 1, viewportWidth = 1920, entityCount = 0, lowPower = false } = {}) {
  const scale = clamp(finiteOr(qualityScale, 1), 0.25, 2);
  const widthFactor = clamp(finiteOr(viewportWidth, 1920) / 1920, 0.5, 1.5);
  const entityFactor = entityCount > 5000 ? 0.75 : entityCount > 2500 ? 0.9 : 1;
  const powerFactor = lowPower ? 0.65 : 1;
  return clamp(scale * widthFactor * entityFactor * powerFactor, 0.2, 1.5);
}

export function buildStreamingSignal({ distance = 0, playerSpeed = 0, density = 1, qualityTier = 'medium' } = {}) {
  const tierIndex = ['minimal', 'low', 'medium', 'high', 'ultra'].indexOf(qualityTier);
  const base = clamp(1 - finiteOr(distance, 0) / 1000, 0, 1);
  const speedBoost = clamp(finiteOr(playerSpeed, 0) / 15, 0, 1) * 0.25;
  const tierBoost = Math.max(0, tierIndex) * 0.05;
  return Object.freeze({
    priority: clamp(base + speedBoost + tierBoost, 0, 1),
    density: clamp(finiteOr(density, 1), 0.1, 1.5),
    prefetch: base > 0.25,
  });
}

export function normalizePointerSignal(input = {}) {
  return Object.freeze({
    locked: Boolean(input.locked),
    dx: clamp(finiteOr(input.dx, 0), -500, 500),
    dy: clamp(finiteOr(input.dy, 0), -500, 500),
    buttons: clamp(integerOr(input.buttons, 0), 0, 32),
  });
}

export function normalizeGamepadSignal(gamepad = {}) {
  const axes = Array.isArray(gamepad.axes) ? gamepad.axes.slice(0, 8).map((value) => clamp(finiteOr(value, 0), -1, 1)) : [];
  const buttons = Array.isArray(gamepad.buttons) ? gamepad.buttons.slice(0, 32).map((button) => clamp(finiteOr(button?.value, 0), 0, 1)) : [];
  return Object.freeze({ connected: gamepad.connected !== false, index: Math.max(0, integerOr(gamepad.index, 0)), axes: Object.freeze(axes), buttons: Object.freeze(buttons) });
}
