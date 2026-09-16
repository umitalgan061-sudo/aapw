import type { QualityTier, Result } from './types';
import { checksum } from './deterministic';
import { DEFAULT_SESSION_SETTINGS, sanitizeSettings, type SessionSettings } from './runtimeContracts';
import { detectBrowserCapabilities, readNetworkState, type BrowserCapabilities } from './browserPlatform';

export interface UserSettingsV1 extends SessionSettings {
  readonly masterVolume: number;
  readonly muted: boolean;
  readonly quality: QualityTier;
  readonly reducedMotion: boolean;
  readonly cameraSensitivity: number;
  readonly touchSensitivity: number;
  readonly showPerformance: boolean;
  readonly autoSaveMinutes: number;
}

export interface AccessibilitySettings {
  readonly reducedMotion: boolean;
  readonly largeUi: boolean;
  readonly highContrast: boolean;
  readonly captions: boolean;
  readonly screenReaderFriendly: boolean;
}

export interface InputSettings {
  readonly keyboardLayout: 'auto' | 'qwerty' | 'azerty' | 'qwertz';
  readonly mouseSensitivity: number;
  readonly touchSensitivity: number;
  readonly invertY: boolean;
  readonly holdToSprint: boolean;
  readonly gamepadDeadZone: number;
}

export interface GraphicsSettings {
  readonly quality: QualityTier;
  readonly renderScale: number;
  readonly shadows: boolean;
  readonly reflections: boolean;
  readonly volumetrics: boolean;
  readonly vegetationDensity: number;
  readonly viewDistance: number;
  readonly textureBudgetMb: number;
}

export interface AudioSettings {
  readonly master: number;
  readonly music: number;
  readonly effects: number;
  readonly voice: number;
  readonly muted: boolean;
}

export interface UserSettings {
  readonly schema: 'aapw.user-settings';
  readonly version: 3;
  readonly session: SessionSettings;
  readonly accessibility: AccessibilitySettings;
  readonly input: InputSettings;
  readonly graphics: GraphicsSettings;
  readonly audio: AudioSettings;
  readonly checksum: string;
}

export interface SettingsStoreOptions {
  readonly key?: string;
  readonly storage?: Storage | null;
  readonly defaults?: Partial<UserSettings>;
}

const KEY = 'aapw.user-settings.v3';

const DEFAULT_ACCESSIBILITY: AccessibilitySettings = Object.freeze({
  reducedMotion: false,
  largeUi: false,
  highContrast: false,
  captions: false,
  screenReaderFriendly: false,
});

const DEFAULT_INPUT: InputSettings = Object.freeze({
  keyboardLayout: 'auto',
  mouseSensitivity: 1,
  touchSensitivity: 1,
  invertY: false,
  holdToSprint: true,
  gamepadDeadZone: 0.12,
});

const DEFAULT_GRAPHICS: GraphicsSettings = Object.freeze({
  quality: 'high',
  renderScale: 1,
  shadows: true,
  reflections: true,
  volumetrics: true,
  vegetationDensity: 1,
  viewDistance: 1,
  textureBudgetMb: 512,
});

const DEFAULT_AUDIO: AudioSettings = Object.freeze({
  master: 0.8,
  music: 0.7,
  effects: 0.9,
  voice: 1,
  muted: false,
});

function unit(value: number, fallback: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback;
}

function sensitivity(value: number, fallback: number): number {
  return Number.isFinite(value) ? Math.max(0.1, Math.min(4, value)) : fallback;
}

function quality(value: unknown, fallback: QualityTier): QualityTier {
  return value === 'minimal' || value === 'low' || value === 'medium' || value === 'high' || value === 'ultra' ? value : fallback;
}

function parseUnknown(value: string | null): unknown {
  if (!value) return null;
  try { return JSON.parse(value) as unknown; } catch { return null; }
}

export function defaultUserSettings(): UserSettings {
  const payload = {
    schema: 'aapw.user-settings' as const,
    version: 3 as const,
    session: sanitizeSettings(DEFAULT_SESSION_SETTINGS),
    accessibility: DEFAULT_ACCESSIBILITY,
    input: DEFAULT_INPUT,
    graphics: DEFAULT_GRAPHICS,
    audio: DEFAULT_AUDIO,
  };
  return Object.freeze({ ...payload, checksum: checksum(payload) });
}

export function normalizeUserSettings(input: Partial<UserSettings> | null | undefined): UserSettings {
  const base = defaultUserSettings();
  const session = sanitizeSettings({ ...base.session, ...(input?.session ?? {}) });
  const accessibility: AccessibilitySettings = Object.freeze({
    reducedMotion: Boolean(input?.accessibility?.reducedMotion ?? session.reducedMotion),
    largeUi: Boolean(input?.accessibility?.largeUi),
    highContrast: Boolean(input?.accessibility?.highContrast),
    captions: Boolean(input?.accessibility?.captions),
    screenReaderFriendly: Boolean(input?.accessibility?.screenReaderFriendly),
  });
  const inputSettings: InputSettings = Object.freeze({
    keyboardLayout: input?.input?.keyboardLayout ?? base.input.keyboardLayout,
    mouseSensitivity: sensitivity(input?.input?.mouseSensitivity ?? base.input.mouseSensitivity, base.input.mouseSensitivity),
    touchSensitivity: sensitivity(input?.input?.touchSensitivity ?? base.input.touchSensitivity, base.input.touchSensitivity),
    invertY: Boolean(input?.input?.invertY),
    holdToSprint: Boolean(input?.input?.holdToSprint ?? base.input.holdToSprint),
    gamepadDeadZone: Math.max(0, Math.min(0.5, Number.isFinite(input?.input?.gamepadDeadZone) ? Number(input?.input?.gamepadDeadZone) : base.input.gamepadDeadZone)),
  });
  const graphics: GraphicsSettings = Object.freeze({
    quality: quality(input?.graphics?.quality, session.quality),
    renderScale: Math.max(0.5, Math.min(1.25, Number.isFinite(input?.graphics?.renderScale) ? Number(input?.graphics?.renderScale) : base.graphics.renderScale)),
    shadows: Boolean(input?.graphics?.shadows ?? base.graphics.shadows),
    reflections: Boolean(input?.graphics?.reflections ?? base.graphics.reflections),
    volumetrics: Boolean(input?.graphics?.volumetrics ?? base.graphics.volumetrics),
    vegetationDensity: Math.max(0.2, Math.min(1, Number.isFinite(input?.graphics?.vegetationDensity) ? Number(input?.graphics?.vegetationDensity) : base.graphics.vegetationDensity)),
    viewDistance: Math.max(0.25, Math.min(2, Number.isFinite(input?.graphics?.viewDistance) ? Number(input?.graphics?.viewDistance) : base.graphics.viewDistance)),
    textureBudgetMb: Math.max(128, Math.min(2048, Math.trunc(Number.isFinite(input?.graphics?.textureBudgetMb) ? Number(input?.graphics?.textureBudgetMb) : base.graphics.textureBudgetMb))),
  });
  const audio: AudioSettings = Object.freeze({
    master: unit(input?.audio?.master ?? base.audio.master, base.audio.master),
    music: unit(input?.audio?.music ?? base.audio.music, base.audio.music),
    effects: unit(input?.audio?.effects ?? base.audio.effects, base.audio.effects),
    voice: unit(input?.audio?.voice ?? base.audio.voice, base.audio.voice),
    muted: Boolean(input?.audio?.muted ?? session.muted),
  });
  const payload = Object.freeze({ schema: 'aapw.user-settings' as const, version: 3 as const, session, accessibility, input: inputSettings, graphics, audio });
  return Object.freeze({ ...payload, checksum: checksum(payload) });
}

export class SettingsStore {
  readonly key: string;
  #storage: Storage | null;
  #settings: UserSettings;
  #listeners = new Set<(settings: UserSettings) => void>();

  constructor(options: SettingsStoreOptions = {}) {
    this.key = options.key ?? KEY;
    this.#storage = options.storage ?? (typeof localStorage !== 'undefined' ? localStorage : null);
    this.#settings = normalizeUserSettings(options.defaults);
  }

  load(): Result<UserSettings> {
    const raw = parseUnknown(this.#storage?.getItem(this.key) ?? null);
    if (!raw || typeof raw !== 'object') {
      this.#settings = normalizeUserSettings(this.#settings);
      return { ok: true, value: this.#settings };
    }
    const candidate = raw as Partial<UserSettings> & { checksum?: unknown };
    const normalized = normalizeUserSettings(candidate);
    if (typeof candidate.checksum === 'string' && candidate.checksum !== normalized.checksum) {
      this.#settings = defaultUserSettings();
      return { ok: false, error: { code: 'SETTINGS_CHECKSUM_MISMATCH', message: 'Stored settings failed integrity validation', retryable: false } };
    }
    this.#settings = normalized;
    return { ok: true, value: normalized };
  }

  get value(): UserSettings { return this.#settings; }

  update(patch: Partial<UserSettings>): UserSettings {
    this.#settings = normalizeUserSettings({ ...this.#settings, ...patch, session: { ...this.#settings.session, ...(patch.session ?? {}) }, accessibility: { ...this.#settings.accessibility, ...(patch.accessibility ?? {}) }, input: { ...this.#settings.input, ...(patch.input ?? {}) }, graphics: { ...this.#settings.graphics, ...(patch.graphics ?? {}) }, audio: { ...this.#settings.audio, ...(patch.audio ?? {}) } });
    this.#emit();
    return this.#settings;
  }

  save(): Result<UserSettings> {
    try {
      this.#storage?.setItem(this.key, JSON.stringify(this.#settings));
      return { ok: true, value: this.#settings };
    } catch (cause) {
      return { ok: false, error: { code: 'SETTINGS_WRITE_FAILED', message: String(cause), retryable: true, cause } };
    }
  }

  reset(): UserSettings {
    this.#settings = defaultUserSettings();
    this.#storage?.removeItem(this.key);
    this.#emit();
    return this.#settings;
  }

  subscribe(listener: (settings: UserSettings) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  exportJson(): string {
    return JSON.stringify(this.#settings, null, 2);
  }

  importJson(serialized: string): Result<UserSettings> {
    const parsed = parseUnknown(serialized);
    if (!parsed || typeof parsed !== 'object') return { ok: false, error: { code: 'SETTINGS_IMPORT_INVALID', message: 'Settings document is not an object', retryable: false } };
    const normalized = normalizeUserSettings(parsed as Partial<UserSettings>);
    this.#settings = normalized;
    this.#emit();
    return { ok: true, value: normalized };
  }

  diagnostics(): Readonly<Record<string, unknown>> {
    return Object.freeze({ key: this.key, hasStorage: this.#storage !== null, checksum: this.#settings.checksum, version: this.#settings.version });
  }

  #emit(): void { for (const listener of this.#listeners) listener(this.#settings); }
}

export interface DeviceProfile {
  readonly name: 'high-end' | 'balanced' | 'mobile' | 'constrained';
  readonly quality: QualityTier;
  readonly renderScale: number;
  readonly shadows: boolean;
  readonly reflections: boolean;
  readonly volumetrics: boolean;
  readonly vegetationDensity: number;
  readonly viewDistance: number;
  readonly maxWorkers: number;
}

export function resolveDeviceProfile(capabilities: BrowserCapabilities = detectBrowserCapabilities()): DeviceProfile {
  const network = readNetworkState();
  const memory = capabilities.deviceMemoryGb ?? 4;
  const cores = capabilities.hardwareConcurrency;
  const mobile = capabilities.features.touch || capabilities.features.gamepad && capabilities.viewport.width < 900;
  if (!capabilities.features.webgl2 && !capabilities.features.webgpu) {
    return Object.freeze({ name: 'constrained', quality: 'minimal', renderScale: 0.65, shadows: false, reflections: false, volumetrics: false, vegetationDensity: 0.25, viewDistance: 0.35, maxWorkers: 1 });
  }
  if (mobile || network.saveData || memory <= 2 || cores <= 4) {
    return Object.freeze({ name: 'mobile', quality: 'medium', renderScale: 0.8, shadows: false, reflections: false, volumetrics: false, vegetationDensity: 0.5, viewDistance: 0.55, maxWorkers: Math.min(3, cores) });
  }
  if (memory >= 12 && cores >= 12 && capabilities.features.webgpu) {
    return Object.freeze({ name: 'high-end', quality: 'ultra', renderScale: 1, shadows: true, reflections: true, volumetrics: true, vegetationDensity: 1, viewDistance: 1.5, maxWorkers: Math.min(8, cores - 2) });
  }
  return Object.freeze({ name: 'balanced', quality: 'high', renderScale: 0.95, shadows: true, reflections: true, volumetrics: false, vegetationDensity: 0.8, viewDistance: 1, maxWorkers: Math.min(6, Math.max(2, cores - 2)) });
}
