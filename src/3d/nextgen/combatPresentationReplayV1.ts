/** Deterministic recording/replay tools for combat presentation QA. */
import type { CombatEvent } from './combatSimulation';
import { deterministicHash } from './deterministicMath';
import type { CombatPresentationContext, CombatPresentationFrame, CombatPresentationCue } from './combatPresentationV1';
import { CombatPresentationDirector, validateCombatPresentationFrame } from './combatPresentationV1';

export interface CombatPresentationRecordingFrame { readonly tick: number; readonly digest: number; readonly cueIds: readonly string[]; readonly hitstopTicks: number; readonly cameraShake: number; readonly droppedCues: number; }
export interface CombatPresentationRecording { readonly version: 1; readonly seed: number; readonly frames: readonly CombatPresentationRecordingFrame[]; readonly finalDigest: number; readonly eventCount: number; }
export interface CombatPresentationReplayDiff { readonly equal: boolean; readonly firstMismatchTick: number | null; readonly expectedDigest: number; readonly actualDigest: number; readonly missingCueIds: readonly string[]; readonly extraCueIds: readonly string[]; }

function frameRecord(frame: CombatPresentationFrame): CombatPresentationRecordingFrame {
  return Object.freeze({ tick: frame.tick, digest: frame.deterministicDigest, cueIds: Object.freeze(frame.cues.map((cue) => cue.id)), hitstopTicks: frame.hitstopTicks, cameraShake: frame.cameraShake, droppedCues: frame.droppedCues });
}

export class CombatPresentationRecorder {
  #frames: CombatPresentationRecordingFrame[] = [];
  #events = 0;
  #seed: number;

  constructor(seed = 0xC0B47) { this.#seed = seed >>> 0; }
  record(frame: CombatPresentationFrame, eventCount = 0): void {
    if (!validateCombatPresentationFrame(frame).valid) throw new Error('cannot record invalid presentation frame');
    this.#frames.push(frameRecord(frame)); this.#events += Math.max(0, eventCount);
  }
  clear(): void { this.#frames = []; this.#events = 0; }
  recording(): CombatPresentationRecording {
    const finalDigest = deterministicHash(this.#frames.flatMap((frame) => [frame.tick, frame.digest, frame.hitstopTicks, Math.round(frame.cameraShake * 1000), frame.droppedCues]));
    return Object.freeze({ version: 1 as const, seed: this.#seed, frames: Object.freeze([...this.#frames]), finalDigest, eventCount: this.#events });
  }
  serialize(): string { return JSON.stringify(this.recording()); }
}

export function replayCombatPresentation(eventsByTick: ReadonlyMap<number, readonly CombatEvent[]>, statesByTick: ReadonlyMap<number, CombatPresentationContext['states']>, config = {}, seed = 0xC0B47): CombatPresentationRecording {
  const director = new CombatPresentationDirector(config);
  const recorder = new CombatPresentationRecorder(seed);
  const ticks = [...new Set([...eventsByTick.keys(), ...statesByTick.keys()])].sort((a, b) => a - b);
  for (const tick of ticks) {
    const frame = director.ingest(eventsByTick.get(tick) ?? [], { states: statesByTick.get(tick) ?? [], device: 'replay' });
    recorder.record(frame, (eventsByTick.get(tick) ?? []).length);
  }
  return recorder.recording();
}

export function compareCombatPresentationRecordings(expected: CombatPresentationRecording, actual: CombatPresentationRecording): CombatPresentationReplayDiff {
  if (expected.version !== 1 || actual.version !== 1) throw new Error('unsupported presentation recording version');
  const max = Math.max(expected.frames.length, actual.frames.length);
  for (let index = 0; index < max; index += 1) {
    const a = expected.frames[index]; const b = actual.frames[index];
    if (!a || !b || a.digest !== b.digest || a.tick !== b.tick || a.cueIds.length !== b.cueIds.length) {
      const expectedIds = a?.cueIds ?? []; const actualIds = b?.cueIds ?? [];
      return Object.freeze({ equal: false, firstMismatchTick: b?.tick ?? a?.tick ?? null, expectedDigest: a?.digest ?? expected.finalDigest, actualDigest: b?.digest ?? actual.finalDigest, missingCueIds: Object.freeze(expectedIds.filter((id) => !actualIds.includes(id))), extraCueIds: Object.freeze(actualIds.filter((id) => !expectedIds.includes(id))) });
    }
  }
  return Object.freeze({ equal: expected.finalDigest === actual.finalDigest, firstMismatchTick: expected.finalDigest === actual.finalDigest ? null : actual.frames.at(-1)?.tick ?? null, expectedDigest: expected.finalDigest, actualDigest: actual.finalDigest, missingCueIds: Object.freeze([]), extraCueIds: Object.freeze([]) });
}

export function summarizeCombatPresentationRecording(recording: CombatPresentationRecording): Readonly<{ frames: number; eventCount: number; cueCount: number; droppedCues: number; peakHitstopTicks: number; peakCameraShake: number; digest: number }> {
  return Object.freeze({
    frames: recording.frames.length,
    eventCount: recording.eventCount,
    cueCount: recording.frames.reduce((sum, frame) => sum + frame.cueIds.length, 0),
    droppedCues: recording.frames.reduce((sum, frame) => sum + frame.droppedCues, 0),
    peakHitstopTicks: recording.frames.reduce((max, frame) => Math.max(max, frame.hitstopTicks), 0),
    peakCameraShake: recording.frames.reduce((max, frame) => Math.max(max, frame.cameraShake), 0),
    digest: recording.finalDigest,
  });
}

export function extractCueById(recording: CombatPresentationRecording, id: string): CombatPresentationRecordingFrame | null {
  for (const frame of recording.frames) if (frame.cueIds.includes(id)) return frame;
  return null;
}