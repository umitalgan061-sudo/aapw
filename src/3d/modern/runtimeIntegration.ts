import type { QualityTier } from './types';
import { ModernRuntimeFacade, type ModernRuntimeFacadeSnapshot } from './modernRuntimeFacade';
import { RuntimeSession, type RuntimeSceneAdapter } from './runtimeSession';
import { BrowserLifecycleController, detectBrowserCapabilities, registerServiceWorker, type BrowserCapabilities } from './browserPlatform';
import { SettingsStore, resolveDeviceProfile, type DeviceProfile, type UserSettings } from './settingsStore';
import { DEFAULT_RUNTIME_FEATURES, normalizeFeatureSwitches, QualityDirector, type RuntimeFeatureSwitches } from './qualityProfile';
import { auditRuntime, releaseGate, type AuditReport } from './runtimeAudit';

export interface ModernIntegrationOptions {
  readonly canvas?: HTMLCanvasElement;
  readonly scene?: RuntimeSceneAdapter;
  readonly seed?: number;
  readonly settingsStorage?: Storage | null;
  readonly features?: Partial<RuntimeFeatureSwitches>;
  readonly serviceWorker?: boolean;
  readonly onSnapshot?: (snapshot: ModernRuntimeFacadeSnapshot) => void;
  readonly onAudit?: (report: AuditReport) => void;
}

export interface ModernIntegrationStatus {
  readonly initialized: boolean;
  readonly backend: string;
  readonly deviceProfile: DeviceProfile;
  readonly capabilities: BrowserCapabilities;
  readonly features: RuntimeFeatureSwitches;
  readonly settings: UserSettings;
  readonly runtime: ModernRuntimeFacadeSnapshot | null;
  readonly session: ReturnType<RuntimeSession['diagnostics']> | null;
  readonly audit: AuditReport | null;
}

export class ModernIntegrationController {
  readonly capabilities: BrowserCapabilities;
  readonly deviceProfile: DeviceProfile;
  readonly features: RuntimeFeatureSwitches;
  readonly settings: SettingsStore;
  readonly facade: ModernRuntimeFacade;
  readonly session: RuntimeSession;
  readonly lifecycle: BrowserLifecycleController;
  readonly quality: QualityDirector;
  #onSnapshot?: (snapshot: ModernRuntimeFacadeSnapshot) => void;
  #onAudit?: (report: AuditReport) => void;
  #initialized = false;
  #lastAudit: AuditReport | null = null;
  #disposers: Array<() => void> = [];

  constructor(options: ModernIntegrationOptions = {}) {
    this.capabilities = detectBrowserCapabilities();
    this.deviceProfile = resolveDeviceProfile(this.capabilities);
    this.features = normalizeFeatureSwitches(options.features);
    this.settings = new SettingsStore({ storage: options.settingsStorage });
    this.settings.load();
    const graphicsQuality = this.settings.value.graphics.quality;
    this.settings.update({ session: { ...this.settings.value.session, quality: graphicsQuality } });
    this.facade = new ModernRuntimeFacade({ canvas: options.canvas, seed: options.seed });
    this.session = new RuntimeSession({ seed: options.seed, scene: options.scene, settings: this.settings.value.session });
    this.lifecycle = new BrowserLifecycleController({ onEvent: ({ type }) => this.#onLifecycle(type) });
    this.quality = new QualityDirector({ initial: graphicsQuality, min: 'minimal', max: 'ultra' });
    this.#onSnapshot = options.onSnapshot;
    this.#onAudit = options.onAudit;
  }

  async initialize(): Promise<boolean> {
    if (this.#initialized) return true;
    const initialized = await this.facade.initialize();
    if (!initialized.ok) return false;
    this.session.start();
    this.installSettingsPersistence();
    this.lifecycle.start();
    if (this.features.enableDiagnostics) this.#runAudit();
    if (this.features.enableAutosave) this.#installPageSaveHooks();
    if (this.features.enableWorkerStreaming && this.capabilities.features.serviceWorker) await registerServiceWorker();
    this.#initialized = true;
    if (this.features.enableDiagnostics) this.#runAudit();
    return true;
  }

  async frame(deltaMs = 1000 / 60): Promise<boolean> {
    if (!this.#initialized && !(await this.initialize())) return false;
    const result = await this.session.tick(deltaMs);
    const facadeState = this.facade.snapshot(
      result.runtime.context.frame,
      result.runtime.context.quality,
      result.runtime.packet.backend,
      result.runtime.context.pressure.combined,
      result.snapshot.world.loadedCells.length,
    );
    this.#onSnapshot?.(facadeState);
    if (this.features.enableDynamicQuality) {
      const transition = this.quality.observe(this.session.performance.summary());
      if (transition) {
        this.session.updateSettings({ quality: transition.next });
        this.facade.setQuality(transition.next);
        this.settings.update({ graphics: { ...this.settings.value.graphics, quality: transition.next } });
      }
    }
    if (this.features.enableDiagnostics && Number(result.snapshot.frame) % 120 === 0) this.#runAudit();
    return true;
  }

  async save(slot?: number): Promise<boolean> {
    return this.session.requestSave('manual', slot);
  }

  async shutdown(): Promise<void> {
    if (!this.#initialized) return;
    await this.session.stop(true);
    this.lifecycle.stop();
    await this.facade.shutdown();
    this.#initialized = false;
    for (const dispose of this.#disposers.splice(0)) dispose();
  }

  status(): ModernIntegrationStatus {
    return Object.freeze({
      initialized: this.#initialized,
      backend: this.facade.renderer.state.backend,
      deviceProfile: this.deviceProfile,
      capabilities: this.capabilities,
      features: this.features,
      settings: this.settings.value,
      runtime: this.facade.snapshot(),
      session: this.#initialized ? this.session.diagnostics() : null,
      audit: this.#lastAudit,
    });
  }

  audit(): AuditReport {
    if (!this.#lastAudit) this.#runAudit();
    return this.#lastAudit;
  }

  updateQuality(quality: QualityTier): void {
    const transition = this.quality.set(quality, 'user');
    if (!transition) return;
    this.session.updateSettings({ quality });
    this.settings.update({ graphics: { ...this.settings.value.graphics, quality } });
    this.settings.save();
  }

  installSettingsPersistence(): void {
    if (this.#disposers.some((dispose) => dispose.name === 'settings-dispose')) return;
    const unsubscribe = this.settings.subscribe((settings) => {
      this.session.updateSettings(settings.session);
      this.facade.setQuality(settings.graphics.quality);
    });
    const dispose = function settingsDispose(): void { unsubscribe(); };
    this.#disposers.push(dispose);
  }

  #runAudit(): void {
    const report = auditRuntime({
      capabilities: this.capabilities,
      diagnostics: this.#initialized ? this.session.diagnostics() : undefined,
      performance: this.#initialized ? this.session.performance.summary() : undefined,
      features: this.features,
      secureStorageAvailable: Boolean(typeof localStorage !== 'undefined'),
      staticAssetBasePath: './',
    });
    this.#lastAudit = report;
    this.#onAudit?.(report);
    void releaseGate(report, { minimumHealth: 'blocker', allowWarnings: true });
  }

  #installPageSaveHooks(): void {
    if (typeof window === 'undefined') return;
    const save = () => { void this.session.requestSave('page-lifecycle'); };
    window.addEventListener('pagehide', save, { capture: true });
    window.addEventListener('beforeunload', save, { capture: true });
    this.#disposers.push(() => window.removeEventListener('pagehide', save, { capture: true }));
    this.#disposers.push(() => window.removeEventListener('beforeunload', save, { capture: true }));
  }

  #onLifecycle(type: Parameters<BrowserLifecycleController['start']>[0] extends never ? never : 'visible' | 'hidden' | 'pagehide' | 'pageshow' | 'online' | 'offline' | 'freeze' | 'resume'): void {
    if (type === 'hidden' || type === 'pagehide' || type === 'freeze') void this.facade.pause(`browser:${type}`);
    if (type === 'visible' || type === 'pageshow' || type === 'resume') void this.facade.resume(`browser:${type}`);
    if (type === 'offline') this.session.updateSettings({ autoSaveMinutes: 1 });
    if (type === 'online') this.session.updateSettings({ autoSaveMinutes: this.settings.value.session.autoSaveMinutes });
  }
}

export function createModernIntegration(options: ModernIntegrationOptions = {}): ModernIntegrationController {
  return new ModernIntegrationController(options);
}
