import { V7RuntimeKernel, type RuntimeKernelOptions } from './runtimeKernel.js';
import { ReleaseGate } from './releaseGate.js';
import { RuntimeDiagnostics } from './diagnostics.js';
import { BrowserRuntimeAdapter } from './browserAdapter.js';
import { SnapshotReplicationRuntime } from './snapshotReplication.js';
import { QuestRuntime } from './questRuntime.js';
import { SpatialAudioGraph } from './audioGraph.js';
import { DeterministicCombatRuntime } from './combatRuntime.js';
import { DeterministicGameplaySimulation } from './gameplaySimulation.js';
import { PresentationDirector } from './presentationDirector.js';
import { TransactionalEditorRuntime } from './editorRuntime.js';
import { RecoveryCoordinator } from './recovery.js';
import { asTick, digest, type Disposable } from './primitives.js';

export interface IntegrationOptions extends RuntimeKernelOptions { readonly browser?: boolean; }
export interface IntegrationHealth { readonly runtime: ReturnType<V7RuntimeKernel['health']>; readonly diagnostics: ReturnType<RuntimeDiagnostics['inspect']>; readonly release: ReturnType<ReleaseGate['evaluate']>; readonly digest: string; }

export class AapwV7Integration implements Disposable {
  readonly runtime: V7RuntimeKernel; readonly release: ReleaseGate; readonly snapshots: SnapshotReplicationRuntime; readonly quests: QuestRuntime; readonly audio: SpatialAudioGraph; readonly combat: DeterministicCombatRuntime; readonly gameplay: DeterministicGameplaySimulation; readonly presentation: PresentationDirector; readonly editor: TransactionalEditorRuntime; readonly recovery: RecoveryCoordinator; readonly browser: BrowserRuntimeAdapter | null; readonly diagnostics: RuntimeDiagnostics;
  #disposed = false; #detachBrowser: (() => void) | null = null;
  constructor(options: IntegrationOptions = {}) {
    this.runtime = new V7RuntimeKernel(options); this.release = new ReleaseGate(); this.snapshots = new SnapshotReplicationRuntime(); this.quests = new QuestRuntime(); this.audio = new SpatialAudioGraph(); this.combat = new DeterministicCombatRuntime(); this.gameplay = new DeterministicGameplaySimulation(); this.presentation = new PresentationDirector(); this.editor = new TransactionalEditorRuntime(); this.recovery = new RecoveryCoordinator(); this.browser = options.browser === false ? null : new BrowserRuntimeAdapter(); this.diagnostics = new RuntimeDiagnostics({ scheduler: this.runtime.scheduler, telemetry: this.runtime.telemetry, resources: this.runtime.resources, network: this.runtime.network, render: this.runtime.render });
    this.#wireRecovery(); if (this.browser) this.#detachBrowser = this.browser.attach();
  }
  frame(frameMs: number, signals: Parameters<V7RuntimeKernel['evaluateRender']>[0]): ReturnType<V7RuntimeKernel['advance']> { if (this.#disposed) throw new Error('integration-disposed'); this.audio.update(Number(this.runtime.clock.tick())); this.combat.tick(); this.gameplay.tick(); return this.runtime.advance(frameMs, signals); }
  health(): IntegrationHealth { const runtime = this.runtime.health(); const diagnostics = this.diagnostics.inspect(); const release = this.release.evaluate(this.runtime.version, this.runtime.version); return Object.freeze({ runtime, diagnostics, release, digest: digest(runtime, diagnostics.digest, release.digest) }); }
  markReleaseGate(name: string, status: 'pass' | 'warn' | 'fail' | 'unknown', blocking = false, detail = ''): void { this.release.record({ name, status, blocking, detail }); }
  dispose(): void { if (this.#disposed) return; this.#disposed = true; this.#detachBrowser?.(); this.#detachBrowser = null; this.diagnostics.dispose(); this.browser?.dispose(); this.recovery.dispose(); this.editor.dispose(); this.presentation.dispose(); this.gameplay.dispose(); this.combat.dispose(); this.audio.dispose(); this.quests.dispose(); this.snapshots.dispose(); this.runtime.dispose(); }
  #wireRecovery(): void {
    const noOp = (domain: Parameters<RecoveryCoordinator['register']>[0]['domain'], service: Disposable) => this.recovery.register({ domain, diagnose: () => true, quiesce: () => undefined, reset: () => undefined, restore: () => undefined, resume: () => undefined });
    noOp('input', this.runtime.input); noOp('simulation', this.gameplay); noOp('ai', this.runtime.ai); noOp('streaming', this.runtime.resources); noOp('network', this.runtime.network); noOp('render', this.runtime.render); noOp('save', this.runtime.persistence); noOp('audio', this.audio); noOp('telemetry', this.runtime.telemetry);
  }
}

export function createProductionIntegration(options: IntegrationOptions = {}): AapwV7Integration { return new AapwV7Integration(options); }
export function runWarmup(integration: AapwV7Integration, frames = 60): void { const count = Math.max(1, Math.min(600, Math.trunc(frames))); for (let index = 0; index < count; index += 1) integration.frame(16.667, { frameMs: 16.667, cpuMs: 6, gpuMs: 7, drawCalls: 400, triangles: 500_000, memoryBytes: 128 * 1024 * 1024, thermal01: 0, networkPressure01: 0 }); }
