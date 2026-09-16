import { clamp, freeze } from '../domain/contracts.ts';

export interface AccessibilityPreferences {
  readonly reducedMotion: boolean;
  readonly highContrast: boolean;
  readonly largeText: boolean;
  readonly captions: boolean;
  readonly screenReader: boolean;
  readonly haptics: boolean;
  readonly colorBlindMode: 'none' | 'protanopia' | 'deuteranopia' | 'tritanopia';
}

export interface AccessibilityPalette {
  readonly background: string;
  readonly foreground: string;
  readonly accent: string;
  readonly positive: string;
  readonly warning: string;
  readonly negative: string;
  readonly neutral: string;
}

export interface UiScale {
  readonly fontScale: number;
  readonly controlScale: number;
  readonly spacingScale: number;
}

const defaultPreferences: AccessibilityPreferences = freeze({ reducedMotion: false, highContrast: false, largeText: false, captions: true, screenReader: false, haptics: true, colorBlindMode: 'none' });

export const detectAccessibilityPreferences = (): AccessibilityPreferences => {
  if (typeof window === 'undefined') return defaultPreferences;
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
  const contrast = window.matchMedia?.('(prefers-contrast: more)').matches === true;
  return freeze({ ...defaultPreferences, reducedMotion: reduce, highContrast: contrast });
};

export const deriveUiScale = (preferences: AccessibilityPreferences, width = typeof window === 'undefined' ? 1280 : window.innerWidth): UiScale => {
  const base = width < 600 ? 1.05 : width < 1000 ? 1 : 0.98;
  return freeze({
    fontScale: clamp(base * (preferences.largeText ? 1.25 : 1), 0.9, 1.6),
    controlScale: clamp(base * (preferences.largeText ? 1.12 : 1), 0.9, 1.5),
    spacingScale: clamp(base * (preferences.largeText ? 1.1 : 1), 0.9, 1.4),
  });
};

export const paletteFor = (preferences: AccessibilityPreferences): AccessibilityPalette => {
  if (preferences.highContrast) return freeze({ background: '#000000', foreground: '#ffffff', accent: '#ffd400', positive: '#64ff64', warning: '#ffff00', negative: '#ff6060', neutral: '#d8d8d8' });
  switch (preferences.colorBlindMode) {
    case 'protanopia': return freeze({ background: '#08090c', foreground: '#f4f5f6', accent: '#56b4e9', positive: '#009e73', warning: '#e69f00', negative: '#cc79a7', neutral: '#aaaaaa' });
    case 'deuteranopia': return freeze({ background: '#08090c', foreground: '#f4f5f6', accent: '#0072b2', positive: '#56b4e9', warning: '#e69f00', negative: '#d55e00', neutral: '#aaaaaa' });
    case 'tritanopia': return freeze({ background: '#08090c', foreground: '#f4f5f6', accent: '#d55e00', positive: '#009e73', warning: '#e69f00', negative: '#cc79a7', neutral: '#aaaaaa' });
    default: return freeze({ background: '#06040a', foreground: '#f2eee6', accent: '#c8960a', positive: '#67d58b', warning: '#e8b43c', negative: '#df6b68', neutral: '#aaa19a' });
  }
};

export interface FocusBoundaryOptions { readonly root?: HTMLElement; readonly selector?: string; }

export class FocusBoundary {
  readonly #root: HTMLElement | null;
  readonly #selector: string;
  readonly #previous: HTMLElement | null;
  #active = false;
  #handler?: (event: KeyboardEvent) => void;

  constructor(options: FocusBoundaryOptions = {}) {
    this.#root = options.root ?? null;
    this.#selector = options.selector ?? 'button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])';
    this.#previous = typeof document !== 'undefined' && document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }

  activate(): void {
    if (this.#active || !this.#root) return;
    this.#active = true;
    this.#handler = (event) => {
      if (event.key !== 'Tab' || !this.#root) return;
      const focusable = [...this.#root.querySelectorAll<HTMLElement>(this.#selector)].filter((element) => !element.hasAttribute('disabled') && element.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    this.#root.addEventListener('keydown', this.#handler);
  }

  deactivate(): void {
    if (!this.#active || !this.#root) return;
    this.#root.removeEventListener('keydown', this.#handler!);
    this.#active = false;
    this.#previous?.focus();
  }

  dispose(): void { this.deactivate(); }
}

export const announce = (message: string, priority: 'polite' | 'assertive' = 'polite'): void => {
  if (typeof document === 'undefined') return;
  let node = document.getElementById('aapw-live-region');
  if (!node) {
    node = document.createElement('div');
    node.id = 'aapw-live-region';
    node.setAttribute('aria-live', priority);
    node.setAttribute('aria-atomic', 'true');
    Object.assign(node.style, { position: 'fixed', width: '1px', height: '1px', overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' });
    document.body.appendChild(node);
  }
  node.setAttribute('aria-live', priority);
  node.textContent = message.slice(0, 500);
};

export const respectMotion = (preferences: AccessibilityPreferences, durationMs: number): number => preferences.reducedMotion ? 0 : Math.max(0, durationMs);
export const captionRequired = (preferences: AccessibilityPreferences, category: 'voice' | 'cinematic' | 'tutorial'): boolean => preferences.captions && category !== 'tutorial';
