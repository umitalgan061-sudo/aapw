export type TextScale = 'normal' | 'large' | 'xlarge';
export type ContrastMode = 'default' | 'high' | 'maximum';
export type ColorMode = 'default' | 'deuteranopia' | 'protanopia' | 'tritanopia' | 'monochrome';
export type InputMode = 'standard' | 'one-hand' | 'left-hand' | 'right-hand';

export interface AccessibilityProfile {
  readonly textScale: TextScale;
  readonly contrast: ContrastMode;
  readonly colorMode: ColorMode;
  readonly reducedMotion: boolean;
  readonly subtitles: boolean;
  readonly subtitleScale: number;
  readonly screenReaderHints: boolean;
  readonly holdToToggle: boolean;
  readonly inputMode: InputMode;
  readonly aimAssist: number;
  readonly cameraShake: number;
  readonly flashIntensity: number;
  readonly hapticIntensity: number;
  readonly autoSprint: boolean;
  readonly stickyKeys: boolean;
}

export const DEFAULT_ACCESSIBILITY: AccessibilityProfile = Object.freeze({ textScale: 'normal', contrast: 'default', colorMode: 'default', reducedMotion: false, subtitles: true, subtitleScale: 1, screenReaderHints: false, holdToToggle: false, inputMode: 'standard', aimAssist: 0, cameraShake: 1, flashIntensity: 1, hapticIntensity: 1, autoSprint: false, stickyKeys: false });

const scaleMap: Readonly<Record<TextScale, number>> = Object.freeze({ normal: 1, large: 1.2, xlarge: 1.45 });
const contrastMap: Readonly<Record<ContrastMode, number>> = Object.freeze({ default: 1, high: 1.35, maximum: 1.8 });

export class AccessibilityProfileStore {
  #profile: AccessibilityProfile;
  #revision = 0;
  readonly #listeners = new Set<(profile: AccessibilityProfile, revision: number) => void>();

  constructor(initial: Partial<AccessibilityProfile> = {}) { this.#profile = this.normalize(initial); }
  current(): AccessibilityProfile { return this.#profile; }
  revision(): number { return this.#revision; }

  update(patch: Partial<AccessibilityProfile>): AccessibilityProfile {
    this.#profile = this.normalize({ ...this.#profile, ...patch });
    this.#revision += 1;
    for (const listener of this.#listeners) listener(this.#profile, this.#revision);
    return this.#profile;
  }

  subscribe(listener: (profile: AccessibilityProfile, revision: number) => void): () => void {
    this.#listeners.add(listener);
    return () => { this.#listeners.delete(listener); };
  }

  normalize(input: Partial<AccessibilityProfile>): AccessibilityProfile {
    return Object.freeze({
      textScale: input.textScale ?? DEFAULT_ACCESSIBILITY.textScale,
      contrast: input.contrast ?? DEFAULT_ACCESSIBILITY.contrast,
      colorMode: input.colorMode ?? DEFAULT_ACCESSIBILITY.colorMode,
      reducedMotion: Boolean(input.reducedMotion ?? DEFAULT_ACCESSIBILITY.reducedMotion),
      subtitles: Boolean(input.subtitles ?? DEFAULT_ACCESSIBILITY.subtitles),
      subtitleScale: this.range(input.subtitleScale ?? DEFAULT_ACCESSIBILITY.subtitleScale, 0.75, 2),
      screenReaderHints: Boolean(input.screenReaderHints ?? DEFAULT_ACCESSIBILITY.screenReaderHints),
      holdToToggle: Boolean(input.holdToToggle ?? DEFAULT_ACCESSIBILITY.holdToToggle),
      inputMode: input.inputMode ?? DEFAULT_ACCESSIBILITY.inputMode,
      aimAssist: this.range(input.aimAssist ?? DEFAULT_ACCESSIBILITY.aimAssist, 0, 1),
      cameraShake: this.range(input.cameraShake ?? DEFAULT_ACCESSIBILITY.cameraShake, 0, 1),
      flashIntensity: this.range(input.flashIntensity ?? DEFAULT_ACCESSIBILITY.flashIntensity, 0, 1),
      hapticIntensity: this.range(input.hapticIntensity ?? DEFAULT_ACCESSIBILITY.hapticIntensity, 0, 1),
      autoSprint: Boolean(input.autoSprint ?? DEFAULT_ACCESSIBILITY.autoSprint),
      stickyKeys: Boolean(input.stickyKeys ?? DEFAULT_ACCESSIBILITY.stickyKeys),
    });
  }

  effectiveScale(): number { return scaleMap[this.#profile.textScale]; }
  effectiveContrast(): number { return contrastMap[this.#profile.contrast]; }
  effectiveMotionScale(): number { return this.#profile.reducedMotion ? 0.25 : 1; }
  effectiveCameraShake(): number { return this.#profile.cameraShake * this.effectiveMotionScale(); }
  effectiveFlash(): number { return this.#profile.flashIntensity * this.effectiveMotionScale(); }
  effectiveHaptics(): number { return this.#profile.hapticIntensity; }
  shouldAnnounce(): boolean { return this.#profile.screenReaderHints; }

  reset(): AccessibilityProfile { this.#profile = DEFAULT_ACCESSIBILITY; this.#revision += 1; for (const listener of this.#listeners) listener(this.#profile, this.#revision); return this.#profile; }
  #range(value: number, min: number, max: number): number { return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min)); }
}

export const detectReducedMotionPreference = (source: { matches: boolean } | undefined): boolean => Boolean(source?.matches);

export const createCssAccessibilityVariables = (profile: AccessibilityProfile): Readonly<Record<string, string>> => Object.freeze({
  '--aapw-text-scale': profile.textScale === 'normal' ? '1' : profile.textScale === 'large' ? '1.2' : '1.45',
  '--aapw-contrast': String(contrastMap[profile.contrast]),
  '--aapw-motion-scale': String(profile.reducedMotion ? 0.25 : 1),
  '--aapw-flash-scale': String(profile.flashIntensity),
  '--aapw-camera-shake': String(profile.cameraShake),
});
