export type AppPhase =
  | 'created'
  | 'booting'
  | 'ready'
  | 'running'
  | 'paused'
  | 'recovering'
  | 'stopping'
  | 'stopped'
  | 'failed';

export type AppPriority = 'critical' | 'high' | 'normal' | 'low' | 'background';
export type AppSubsystem = 'input' | 'simulation' | 'render' | 'streaming' | 'network' | 'audio' | 'save' | 'telemetry' | 'accessibility' | 'security';

export interface AppClock {
  readonly nowMs: number;
  readonly frame: number;
  readonly simulationTick: number;
  readonly deltaMs: number;
  readonly realDeltaMs: number;
  readonly paused: boolean;
}
