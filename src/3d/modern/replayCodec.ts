import type { FrameId, Result, UnixMillis } from './types';
import { checksum } from './deterministic';
import type { InputActionEvent, ReplayFrame, ReplayHeader, ReplayRecording, RuntimeAction, RuntimeInputSource } from './runtimeContracts';

const ACTIONS: readonly RuntimeAction[] = Object.freeze([
  'move.forward','move.backward','move.left','move.right','move.sprint','move.jump',
  'camera.orbit.left','camera.orbit.right','camera.zoom.in','camera.zoom.out',
  'interaction.primary','interaction.secondary','ui.pause','ui.inventory','ui.map','ui.settings','debug.toggle',
]);

const SOURCES: readonly RuntimeInputSource[] = Object.freeze(['keyboard','mouse','touch','gamepad','replay','programmatic']);

function actionIndex(action: RuntimeAction): number { return Math.max(0, ACTIONS.indexOf(action)); }
function sourceIndex(source: RuntimeInputSource): number { return Math.max(0, SOURCES.indexOf(source)); }
function actionAt(index: number): RuntimeAction { return ACTIONS[index] ?? 'interaction.primary'; }
function sourceAt(index: number): RuntimeInputSource { return SOURCES[index] ?? 'programmatic'; }

export interface ReplayEncodeOptions {
  readonly includeTimestamps?: boolean;
  readonly quantization?: number;
}

export interface ReplayDecodeReport {
  readonly frames: number;
  readonly actions: number;
  readonly bytes: number;
  readonly checksum: string;
  readonly valid: boolean;
  readonly warnings: readonly string[];
}

function varUintEncode(value: number, output: number[]): void {
  let current = Math.max(0, Math.trunc(value));
  while (current >= 0x80) { output.push((current & 0x7f) | 0x80); current >>>= 7; }
  output.push(current);
}

function varUintDecode(bytes: Uint8Array, offset: { value: number }): number {
  let result = 0;
  let shift = 0;
  for (let count = 0; count < 5; count += 1) {
    const byte = bytes[offset.value++] ?? 0;
    result |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return result >>> 0;
    shift += 7;
  }
  throw new Error('Malformed varuint');
}

function signedToUint(value: number): number { return value < 0 ? ((-value) * 2 - 1) : value * 2; }
function uintToSigned(value: number): number { return value % 2 === 0 ? value / 2 : -(Math.floor(value / 2) + 1); }

/** Codec that turns a replay event stream into compact bytes without floating-point drift. */
export function encodeReplay(recording: ReplayRecording, options: ReplayEncodeOptions = {}): Uint8Array {
  const quantization = Math.max(100, Math.min(10_000, Math.trunc(options.quantization ?? 1000)));
  const output: number[] = [0x41, 0x41, 0x50, 0x52, 2, Number(options.includeTimestamps ?? true)];
  varUintEncode(Math.max(0, recording.header.seed), output);
  varUintEncode(Math.max(0, Math.trunc(recording.header.fixedStepMs * 1000)), output);
  varUintEncode(Math.max(0, Number(recording.header.createdAt)), output);
  varUintEncode(recording.frames.length, output);
  let lastFrame = 0;
  let lastTimestamp = Number(recording.header.createdAt);
  for (const frame of recording.frames) {
    varUintEncode(Math.max(0, Number(frame.frame) - lastFrame), output);
    if (options.includeTimestamps !== false) varUintEncode(Math.max(0, Number(frame.timestamp) - lastTimestamp), output);
    varUintEncode(frame.actions.length, output);
    let lastEventTimestamp = Number(frame.timestamp);
    for (const event of frame.actions) {
      output.push(actionIndex(event.action));
      output.push(sourceIndex(event.source));
      output.push(event.phase === 'pressed' ? 1 : event.phase === 'released' ? 2 : 3);
      const quantized = Math.max(-quantization, Math.min(quantization, Math.round(event.value * quantization)));
      varUintEncode(signedToUint(quantized), output);
      if (options.includeTimestamps !== false) varUintEncode(Math.max(0, Number(event.timestamp) - lastEventTimestamp), output);
      output.push(event.repeat ? 1 : 0);
      lastEventTimestamp = Number(event.timestamp);
    }
    lastFrame = Number(frame.frame);
    lastTimestamp = Number(frame.timestamp);
  }
  return new Uint8Array(output);
}

export interface ReplayDecodeOptions {
  readonly runtimeVersion?: string;
  readonly quantization?: number;
  readonly maxFrames?: number;
  readonly maxActions?: number;
}

export function decodeReplay(bytes: Uint8Array, options: ReplayDecodeOptions = {}): Result<ReplayRecording> {
  try {
    if (bytes.length < 6 || bytes[0] !== 0x41 || bytes[1] !== 0x41 || bytes[2] !== 0x50 || bytes[3] !== 0x52) {
      return { ok: false, error: { code: 'REPLAY_MAGIC_INVALID', message: 'Replay header is invalid', retryable: false } };
    }
    if (bytes[4] !== 2) return { ok: false, error: { code: 'REPLAY_VERSION_UNSUPPORTED', message: 'Replay version is unsupported', retryable: false } };
    const includeTimestamps = bytes[5] === 1;
    const offset = { value: 6 };
    const seed = varUintDecode(bytes, offset);
    const fixedStepMs = varUintDecode(bytes, offset) / 1000;
    const createdAt = varUintDecode(bytes, offset) as UnixMillis;
    const frameCount = varUintDecode(bytes, offset);
    if (frameCount > (options.maxFrames ?? 100_000)) return { ok: false, error: { code: 'REPLAY_FRAME_CAP', message: 'Replay frame cap exceeded', retryable: false } };
    const frames: ReplayFrame[] = [];
    let frame = 0;
    let timestamp = Number(createdAt);
    let actionTotal = 0;
    const maxActions = options.maxActions ?? 1_000_000;
    for (let index = 0; index < frameCount; index += 1) {
      frame += varUintDecode(bytes, offset);
      if (includeTimestamps) timestamp += varUintDecode(bytes, offset);
      const count = varUintDecode(bytes, offset);
      actionTotal += count;
      if (actionTotal > maxActions) return { ok: false, error: { code: 'REPLAY_ACTION_CAP', message: 'Replay action cap exceeded', retryable: false } };
      const actions: InputActionEvent[] = [];
      let eventTimestamp = timestamp;
      for (let eventIndex = 0; eventIndex < count; eventIndex += 1) {
        const action = actionAt(bytes[offset.value++] ?? 0);
        const source = sourceAt(bytes[offset.value++] ?? 0);
        const phaseCode = bytes[offset.value++] ?? 3;
        const value = uintToSigned(varUintDecode(bytes, offset)) / Math.max(100, Math.min(10_000, Math.trunc(options.quantization ?? 1000)));
        if (includeTimestamps) eventTimestamp += varUintDecode(bytes, offset);
        const repeat = (bytes[offset.value++] ?? 0) !== 0;
        actions.push(Object.freeze({ action, source, phase: phaseCode === 1 ? 'pressed' : phaseCode === 2 ? 'released' : 'value', value, timestamp: eventTimestamp as UnixMillis, frame: frame as FrameId, repeat }));
      }
      frames.push(Object.freeze({ frame: frame as FrameId, timestamp: timestamp as UnixMillis, actions: Object.freeze(actions) }));
    }
    if (offset.value !== bytes.length) return { ok: false, error: { code: 'REPLAY_TRAILING_DATA', message: 'Replay contains trailing bytes', retryable: false } };
    const header: ReplayHeader = Object.freeze({ schema: 'aapw.replay', version: 2, seed, fixedStepMs, createdAt, runtimeVersion: options.runtimeVersion ?? 'aapw-modern-runtime' });
    const base = { header, frames: Object.freeze(frames) };
    return { ok: true, value: Object.freeze({ ...base, checksum: checksum(base) }) };
  } catch (cause) {
    return { ok: false, error: { code: 'REPLAY_DECODE_FAILED', message: String(cause), retryable: false, cause } };
  }
}

export function replayReport(recording: ReplayRecording): ReplayDecodeReport {
  const bytes = encodeReplay(recording);
  const decoded = decodeReplay(bytes, { runtimeVersion: recording.header.runtimeVersion });
  const warnings: string[] = [];
  if (recording.frames.length === 0) warnings.push('Replay contains no input frames');
  if (recording.frames.length > 50_000) warnings.push('Replay is large; consider segmenting it');
  if (bytes.length > 2 * 1024 * 1024) warnings.push('Encoded replay exceeds 2 MiB');
  return Object.freeze({ frames: recording.frames.length, actions: recording.frames.reduce((sum, frame) => sum + frame.actions.length, 0), bytes: bytes.byteLength, checksum: recording.checksum, valid: decoded.ok, warnings: Object.freeze(warnings) });
}

export interface ReplaySegment {
  readonly startFrame: FrameId;
  readonly endFrame: FrameId;
  readonly frames: readonly ReplayFrame[];
  readonly checksum: string;
}

export function splitReplay(recording: ReplayRecording, maxFramesPerSegment = 9000): readonly ReplaySegment[] {
  const size = Math.max(1, Math.trunc(maxFramesPerSegment));
  const segments: ReplaySegment[] = [];
  for (let offset = 0; offset < recording.frames.length; offset += size) {
    const frames = Object.freeze(recording.frames.slice(offset, offset + size));
    const start = frames[0]?.frame ?? 0 as FrameId;
    const end = frames[frames.length - 1]?.frame ?? start;
    segments.push(Object.freeze({ startFrame: start, endFrame: end, frames, checksum: checksum({ start, end, frames }) }));
  }
  return Object.freeze(segments);
}

export function mergeReplay(header: ReplayHeader, segments: readonly ReplaySegment[]): Result<ReplayRecording> {
  const ordered = [...segments].sort((a, b) => Number(a.startFrame) - Number(b.startFrame));
  const frames: ReplayFrame[] = [];
  let last = -1;
  for (const segment of ordered) {
    if (checksum({ start: segment.startFrame, end: segment.endFrame, frames: segment.frames }) !== segment.checksum) {
      return { ok: false, error: { code: 'REPLAY_SEGMENT_TAMPERED', message: 'Replay segment checksum mismatch', retryable: false } };
    }
    if (Number(segment.startFrame) <= last) return { ok: false, error: { code: 'REPLAY_SEGMENT_ORDER', message: 'Replay segments overlap or are out of order', retryable: false } };
    frames.push(...segment.frames);
    last = Number(segment.endFrame);
  }
  const base = { header, frames: Object.freeze(frames) };
  return { ok: true, value: Object.freeze({ ...base, checksum: checksum(base) }) };
}
