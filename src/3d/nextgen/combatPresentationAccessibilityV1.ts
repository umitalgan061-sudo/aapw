/** Device-independent accessibility projection for combat presentation. */
import type { CombatEvent } from './combatSimulation';
import type { CombatPresentationCue, CombatPresentationDevice } from './combatPresentationV1';

export type CombatAccessibilityMode = 'standard' | 'reduced-motion' | 'high-contrast' | 'silent' | 'haptics-only';
export interface CombatAccessibilityOptions { readonly mode?: CombatAccessibilityMode; readonly device?: CombatPresentationDevice; readonly announceCritical?: boolean; readonly announceDeath?: boolean; readonly announceBlocked?: boolean; }
export interface CombatAccessibilitySignal { readonly tick: number; readonly cueId: string; readonly semantic: CombatPresentationCue['semantic']; readonly label: string; readonly priority: number; readonly visualEmphasis: number; readonly motionScale: number; readonly haptic: boolean; readonly audio: boolean; readonly ariaLive: 'off' | 'polite' | 'assertive'; }

const LABELS: Readonly<Record<CombatPresentationCue['semantic'], string>> = Object.freeze({
  'attack-start': 'SALDIRI', impact: 'VURUŞ', 'blocked-impact': 'BLOK', 'critical-impact': 'KRİTİK VURUŞ', stagger: 'SERSEMLETİLDİ', death: 'DÜŞMAN DÜŞTÜ', dodge: 'KAÇIŞ',
});

function clamp(value: number, min = 0, max = 1): number { return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min)); }
function ariaFor(cue: CombatPresentationCue, options: CombatAccessibilityOptions): 'off' | 'polite' | 'assertive' {
  if (cue.semantic === 'critical-impact' && options.announceCritical !== false) return 'assertive';
  if (cue.semantic === 'death' && options.announceDeath !== false) return 'assertive';
  if ((cue.semantic === 'blocked-impact' || cue.semantic === 'stagger') && options.announceBlocked !== false) return 'polite';
  return 'off';
}

export function projectCombatAccessibility(cues: readonly CombatPresentationCue[], options: CombatAccessibilityOptions = {}): readonly CombatAccessibilitySignal[] {
  const mode = options.mode ?? 'standard';
  const device = options.device ?? 'virtual';
  const motionScale = mode === 'reduced-motion' ? 0.25 : 1;
  const hapticsAllowed = mode !== 'silent' && device !== 'keyboard' && device !== 'mouse';
  const audioAllowed = mode !== 'silent' && mode !== 'haptics-only';
  return Object.freeze([...cues].sort((a, b) => b.priority - a.priority || a.tick - b.tick || a.id.localeCompare(b.id)).map((cue) => Object.freeze({
    tick: cue.tick, cueId: cue.id, semantic: cue.semantic, label: LABELS[cue.semantic], priority: cue.priority,
    visualEmphasis: clamp(cue.intensity * (mode === 'high-contrast' ? 1.15 : 1)), motionScale,
    haptic: hapticsAllowed && cue.haptics.length > 0, audio: audioAllowed && cue.audio.volume > 0, ariaLive: ariaFor(cue, options),
  })));
}

export function buildCombatFeedbackSummary(cues: readonly CombatPresentationCue[]): Readonly<{ count: number; criticals: number; blocked: number; deaths: number; dodges: number; strongest: CombatPresentationCue['semantic'] | null }> {
  let strongest: CombatPresentationCue | null = null;
  for (const cue of cues) if (!strongest || cue.priority > strongest.priority || (cue.priority === strongest.priority && cue.intensity > strongest.intensity)) strongest = cue;
  return Object.freeze({ count: cues.length, criticals: cues.filter((cue) => cue.semantic === 'critical-impact').length, blocked: cues.filter((cue) => cue.semantic === 'blocked-impact').length, deaths: cues.filter((cue) => cue.semantic === 'death').length, dodges: cues.filter((cue) => cue.semantic === 'dodge').length, strongest: strongest?.semantic ?? null });
}

export function eventToSemanticHint(event: CombatEvent): CombatPresentationCue['semantic'] {
  if (event.type === 'attack-start') return 'attack-start';
  if (event.type === 'blocked') return 'blocked-impact';
  if (event.type === 'critical') return 'critical-impact';
  if (event.type === 'stagger') return 'stagger';
  if (event.type === 'death') return 'death';
  if (event.type === 'dodge') return 'dodge';
  return 'impact';
}

export function validateCombatAccessibilitySignal(signal: CombatAccessibilitySignal): boolean {
  return signal.tick >= 0 && signal.cueId.length > 0 && signal.label.length > 0 && signal.priority >= 0 && Number.isFinite(signal.visualEmphasis) && signal.visualEmphasis >= 0 && signal.visualEmphasis <= 1 && Number.isFinite(signal.motionScale) && signal.motionScale >= 0 && signal.motionScale <= 1;
}