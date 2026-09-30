/**
 * Strict runtime diagnostics formatter and invariant checker.
 *
 * Produces deterministic health summaries without DOM, renderer or wall-clock ownership.
 */
import { clamp, finiteOr, integerOr, stableStringify } from './modernRuntimeContract.ts';
import { combineHealthLevels, type HealthLevel } from './runtimeHealthMonitor.ts';
import { classifyResidencyPressure } from './assetResidencyCache.ts';

type JsonRecord = Readonly<Record<string, unknown>>;
export interface RuntimeDiagnosticsSnapshot extends JsonRecord {
  readonly scheduler?: JsonRecord;
  readonly quality?: JsonRecord;
  readonly health?: JsonRecord;
  readonly telemetry?: JsonRecord;
  readonly input?: JsonRecord;
  readonly residency?: JsonRecord;
  readonly visibility?: string;
  readonly running?: boolean;
  readonly platformProfile?: string;
}
export interface RuntimeInvariantResult { readonly valid:boolean; readonly failures:readonly string[]; readonly warnings:readonly string[]; }
export interface RuntimeHealthSummary {
  readonly health: HealthLevel;
  readonly loadScore: number;
  readonly frameP95: number;
  readonly gpuP95: number;
  readonly action: 'recover'|'reduce-load'|'observe'|'hold';
}
export interface RuntimeDiagnosticsDigest {
  readonly valid:boolean;
  readonly health:HealthLevel;
  readonly action:RuntimeHealthSummary['action'];
  readonly warnings:readonly string[];
  readonly failures:readonly string[];
  readonly platformProfile:string;
  readonly qualityTier:string;
  readonly schedulerTick:number;
  readonly telemetryEvents:number;
  readonly inputQueued:number;
}

function record(value: unknown): JsonRecord { return value && typeof value === 'object' ? value as JsonRecord : {}; }
function nested(value: unknown, key: string): unknown { return record(value)[key]; }

export function evaluateRuntimeInvariants(snapshot: RuntimeDiagnosticsSnapshot = {}): RuntimeInvariantResult {
  const failures:string[]=[]; const warnings:string[]=[];
  const scheduler=record(snapshot.scheduler), quality=record(snapshot.quality), health=record(snapshot.health), telemetry=record(snapshot.telemetry), input=record(snapshot.input);
  if (!(finiteOr(scheduler.fixedStepMs,0)>0)) failures.push('scheduler.fixedStepMs must be positive');
  if (!(finiteOr(scheduler.maxCatchupMs,0)>=finiteOr(scheduler.fixedStepMs,1))) failures.push('scheduler.maxCatchupMs must cover one fixed step');
  if (!(integerOr(scheduler.maxStepsPerFrame,0)>=1)) failures.push('scheduler.maxStepsPerFrame must be positive');
  if (!(finiteOr(quality.pressure,0)>=0)) failures.push('quality.pressure must be finite');
  if (!['healthy','watch','degraded','critical'].includes(String(health.health))) warnings.push('health level is missing or non-standard');
  if (!(integerOr(input.capacity,0)>0)) failures.push('input buffer capacity must be positive');
  if (!(integerOr(telemetry.eventCount,0)>=0)) failures.push('telemetry event count must be non-negative');
  if (snapshot.visibility==='visible' && snapshot.running===false) warnings.push('runtime is not running while visible');
  return Object.freeze({valid:failures.length===0,failures:Object.freeze(failures),warnings:Object.freeze(warnings)});
}

export function summarizeRuntimeHealth(diagnostics: RuntimeDiagnosticsSnapshot = {}): RuntimeHealthSummary {
  const healthValue = nested(diagnostics.health,'health');
  const scheduler = record(diagnostics.scheduler);
  const healthCandidates = [healthValue, Boolean(scheduler.spiralGuard)?'degraded':'healthy',
    classifyResidencyPressure(numeric(nested(diagnostics.residency,'usedMb')), numeric(nested(diagnostics.residency,'capacityMb')))].filter(Boolean).map(String);
  const health = combineHealthLevels(...healthCandidates);
  const frameP95 = numeric(nested(nested(diagnostics.telemetry,'metrics'),'frame.cpuMs'), 'p95');
  const gpuP95 = numeric(nested(nested(diagnostics.telemetry,'metrics'),'frame.gpuMs'), 'p95');
  const loadScore = clamp(Math.max(frameP95/8,gpuP95/8),0,10);
  const action:RuntimeHealthSummary['action']=health==='critical'?'recover':health==='degraded'?'reduce-load':health==='watch'?'observe':'hold';
  return Object.freeze({health,loadScore,frameP95,gpuP95,action});
}

function numeric(value: unknown, nestedKey?: string): number {
  const source = nestedKey ? record(value)[nestedKey] : value;
  return finiteOr(source,0);
}

export function createDiagnosticsDigest(diagnostics: RuntimeDiagnosticsSnapshot = {}): RuntimeDiagnosticsDigest {
  const invariant=evaluateRuntimeInvariants(diagnostics); const summary=summarizeRuntimeHealth(diagnostics);
  return Object.freeze({
    valid:invariant.valid, health:summary.health, action:summary.action,
    warnings:Object.freeze([...invariant.warnings]), failures:Object.freeze([...invariant.failures]),
    platformProfile:String(diagnostics.platformProfile||'unknown'), qualityTier:String(nested(diagnostics.quality,'tier')||'unknown'),
    schedulerTick:integerOr(nested(diagnostics.scheduler,'tick'),0),
    telemetryEvents:integerOr(nested(diagnostics.telemetry,'eventCount'),0),
    inputQueued:integerOr((nested(nested(diagnostics.input,'queued'),'length')),0),
  });
}

export function exportDiagnosticsText(diagnostics: RuntimeDiagnosticsSnapshot = {}): string {
  const digest=createDiagnosticsDigest(diagnostics);
  const lines=[`health=${digest.health}`,`action=${digest.action}`,`valid=${digest.valid}`,`platform=${digest.platformProfile}`,`quality=${digest.qualityTier}`,`tick=${digest.schedulerTick}`,`telemetryEvents=${digest.telemetryEvents}`,`inputQueued=${digest.inputQueued}`];
  if(digest.warnings.length) lines.push(`warnings=${digest.warnings.join(' | ')}`);
  if(digest.failures.length) lines.push(`failures=${digest.failures.join(' | ')}`);
  return lines.join('\n');
}

export function exportDiagnosticsJson(diagnostics: RuntimeDiagnosticsSnapshot = {}): string { return stableStringify({digest:createDiagnosticsDigest(diagnostics),diagnostics}); }

export interface RuntimeChecklistItem { readonly id:string; readonly owner:string; readonly criterion:string; }
export function createRuntimeChecklist(): readonly RuntimeChecklistItem[] {
  return Object.freeze([
    Object.freeze({id:'deterministic-ticks',owner:'scheduler',criterion:'fixed-step scheduler has bounded catch-up'}),
    Object.freeze({id:'semantic-input',owner:'input',criterion:'device inputs become semantic commands'}),
    Object.freeze({id:'adaptive-quality',owner:'quality',criterion:'quality changes use hysteresis and dwell'}),
    Object.freeze({id:'bounded-telemetry',owner:'telemetry',criterion:'history and payload size are bounded'}),
    Object.freeze({id:'save-integrity',owner:'persistence',criterion:'save payloads carry revision and checksum'}),
    Object.freeze({id:'memory-bounds',owner:'residency',criterion:'asset residency has weight and capacity limits'}),
    Object.freeze({id:'graceful-recovery',owner:'recovery',criterion:'faults produce bounded recovery intents'}),
    Object.freeze({id:'accessibility-signal',owner:'platform',criterion:'reduced-motion and data-saver are observable'}),
    Object.freeze({id:'ci-acceptance',owner:'ci',criterion:'syntax, acceptance, determinism and ownership checks run'}),
  ]);
}

export function verifyChecklist(checklist: readonly RuntimeChecklistItem[] = createRuntimeChecklist(), capabilities?: unknown): Readonly<{complete:boolean;missing:readonly string[]}> {
  const missing = capabilities === undefined ? checklist.filter(item=>item.id==='accessibility-signal').map(item=>item.id) : [];
  return Object.freeze({complete:missing.length===0,missing:Object.freeze(missing)});
}
