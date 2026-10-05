/**
 * Typed HUD/UI state model for R42.
 * Production TypeScript owner. Presentation can be DOM, canvas, or native shell.
 */

import type { HealthReport, QualityTier, RuntimeSnapshot } from './types.ts';
import { clamp, deepFreeze, finite } from './types.ts';

export type NoticeLevel = 'info' | 'success' | 'warning' | 'critical';

export interface HudState {
  readonly title: string;
  readonly subtitle: string;
  readonly health: number;
  readonly stamina: number;
  readonly quality: QualityTier;
  readonly fps: number;
  readonly pingMs: number;
  readonly entityCount: number;
  readonly runtimeMode: RuntimeSnapshot['mode'];
  readonly notifications: readonly HudNotice[];
}

export interface HudNotice {
  readonly id: string;
  readonly level: NoticeLevel;
  readonly message: string;
  readonly createdTick: number;
  readonly expiresTick: number | null;
  readonly dismissible: boolean;
}

export interface AccessibilitySettings {
  readonly reducedMotion: boolean;
  readonly highContrast: boolean;
  readonly largeText: boolean;
  readonly screenReaderHints: boolean;
}

export class HudModelR42 {
  readonly maxNotifications: number;
  #state: HudState = Object.freeze({
    title: 'AAPW',
    subtitle: 'R42 Runtime',
    health: 100,
    stamina: 100,
    quality: 'balanced',
    fps: 60,
    pingMs: 0,
    entityCount: 0,
    runtimeMode: 'booting',
    notifications: Object.freeze([]),
  });
  #accessibility: AccessibilitySettings = Object.freeze({
    reducedMotion: false,
    highContrast: false,
    largeText: false,
    screenReaderHints: false,
  });

  constructor(maxNotifications = 8) {
    this.maxNotifications = Math.max(1, Math.trunc(maxNotifications));
  }

  update(snapshot: RuntimeSnapshot, health: HealthReport): HudState {
    const fps = snapshot.metrics.frameMs > 0 ? 1000 / snapshot.metrics.frameMs : 0;
    this.#state = deepFreeze({
      ...this.#state,
      quality: snapshot.render.quality,
      fps: clamp(finite(fps, 0), 0, 240),
      entityCount: snapshot.entityCount,
      runtimeMode: snapshot.mode,
      health: clamp(finite(health.score), 0, 100),
      stamina: clamp(finite(snapshot.metrics.entityCount ? 100 : 0), 0, 100),
      pingMs: 0,
    });
    return this.#state;
  }

  notify(level: NoticeLevel, message: string, tick: number, ttlTicks = 180, dismissible = true): HudNotice {
    const notice = deepFreeze({
      id: 'notice:' + tick + ':' + this.#state.notifications.length,
      level,
      message: sanitizeText(message),
      createdTick: Math.max(0, Math.trunc(tick)),
      expiresTick: ttlTicks > 0 ? Math.max(0, Math.trunc(tick)) + Math.trunc(ttlTicks) : null,
      dismissible,
    });
    this.#state = deepFreeze({
      ...this.#state,
      notifications: Object.freeze(
        [...this.#state.notifications, notice].slice(-this.maxNotifications),
      ),
    });
    return notice;
  }

  dismiss(id: string): boolean {
    const before = this.#state.notifications.length;
    const notifications = this.#state.notifications.filter(value => value.id !== id);
    if (notifications.length === before) return false;
    this.#state = deepFreeze({ ...this.#state, notifications: Object.freeze(notifications) });
    return true;
  }

  expire(tick: number): void {
    const currentTick = Math.max(0, Math.trunc(tick));
    this.#state = deepFreeze({
      ...this.#state,
      notifications: Object.freeze(
        this.#state.notifications.filter(value => value.expiresTick === null || value.expiresTick > currentTick),
      ),
    });
  }

  setAccessibility(settings: Partial<AccessibilitySettings>): AccessibilitySettings {
    this.#accessibility = deepFreeze({ ...this.#accessibility, ...settings });
    return this.#accessibility;
  }

  get state(): HudState { return this.#state; }
  get accessibility(): AccessibilitySettings { return this.#accessibility; }
}

function sanitizeText(value: string): string {
  return String(value).replace(/[\u0000-\u001F\u007F]/g, '').slice(0, 512);
}
