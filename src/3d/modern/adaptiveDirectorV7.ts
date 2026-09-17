import { clampV7, type QualityTierV7, type RuntimeBudgetV7, type RuntimeHealthV7, type RuntimeUsageV7, type Vec3V7 } from './runtimeContractsV7';

export interface DirectorSignalV7 {
  readonly cpuMs: number;
  readonly gpuMs: number;
  readonly frameMs: number;
  readonly memoryBytes: number;
  readonly networkKbps: number;
  readonly loadedAssets: number;
  readonly visibleEntities: number;
  readonly simulationDebtMs: number;
}

export interface DirectorDecisionV7 {
  readonly quality: QualityTierV7;
  readonly renderScale: number;
  readonly simulationScale: number;
  readonly maxVisible: number;
  readonly assetConcurrency: number;
  readonly reason: string;
  readonly pressure: number;
  readonly cooldownFrames: number;
}

export interface AdaptiveDirectorOptionsV7 {
  readonly budget: RuntimeBudgetV7;
  readonly now?: () => number;
  readonly minimumQuality?: QualityTierV7;
  readonly initialQuality?: QualityTierV7;
  readonly hysteresisFrames?: number;
  readonly recoveryFrames?: number;
  readonly maxHistory?: number;
}

export interface DirectorHistoryEntryV7 {
  readonly frame: number;
  readonly quality: QualityTierV7;
  readonly pressure: number;
  readonly reason: string;
}

const TIERS: readonly QualityTierV7[] = ['minimal', 'low', 'medium', 'high', 'ultra'];
const qualityIndex = (tier: QualityTierV7): number => TIERS.indexOf(tier);
const downgrade = (tier: QualityTierV7): QualityTierV7 => TIERS[Math.max(0, qualityIndex(tier) - 1)] ?? 'minimal';
const upgrade = (tier: QualityTierV7): QualityTierV7 => TIERS[Math.min(TIERS.length - 1, qualityIndex(tier) + 1)] ?? 'ultra';

const finitePositive = (value: number, fallback: number): number => Number.isFinite(value) && value > 0 ? value : fallback;

function pressureForSignal(signal: DirectorSignalV7, budget: RuntimeBudgetV7): number {
  const ratios = [
    signal.cpuMs / finitePositive(budget.cpuMs, 1),
    signal.gpuMs / finitePositive(budget.gpuMs, 1),
    signal.frameMs / Math.max(1, finitePositive(budget.cpuMs + budget.gpuMs, 16)),
    signal.visibleEntities / Math.max(1, budget.visibleEntities),
    signal.simulationDebtMs / Math.max(4, budget.cpuMs),
  ];
  const memoryRatio = signal.memoryBytes > 0 && budget.assetBytes > 0
    ? signal.memoryBytes / Math.max(budget.assetBytes * 4, 1)
    : 0;
  ratios.push(memoryRatio);
  ratios.push(signal.networkKbps > 0 ? signal.networkKbps / Math.max(256, budget.networkBytes / 1024) : 0);
  return clampV7(Math.max(...ratios), 0, 4);
}

function tierProfile(tier: QualityTierV7): Omit<DirectorDecisionV7, 'quality' | 'reason' | 'pressure' | 'cooldownFrames'> {
  switch (tier) {
    case 'minimal': return { renderScale: 0.55, simulationScale: 0.85, maxVisible: 500, assetConcurrency: 2 };
    case 'low': return { renderScale: 0.7, simulationScale: 0.92, maxVisible: 900, assetConcurrency: 3 };
    case 'medium': return { renderScale: 0.85, simulationScale: 1, maxVisible: 1600, assetConcurrency: 4 };
    case 'high': return { renderScale: 1, simulationScale: 1, maxVisible: 2600, assetConcurrency: 6 };
    case 'ultra': return { renderScale: 1.15, simulationScale: 1, maxVisible: 4200, assetConcurrency: 8 };
  }
}

export class AdaptiveDirectorV7 {
  readonly budget: RuntimeBudgetV7;
  readonly minimumQuality: QualityTierV7;
  #quality: QualityTierV7;
  #now: () => number;
  #frame = 0;
  #badFrames = 0;
  #goodFrames = 0;
  #cooldown = 0;
  #hysteresisFrames: number;
  #recoveryFrames: number;
  #history: DirectorHistoryEntryV7[] = [];
  #maxHistory: number;
  #lastDecision: DirectorDecisionV7;

  constructor(options: AdaptiveDirectorOptionsV7) {
    this.budget = Object.freeze({ ...options.budget });
    this.minimumQuality = options.minimumQuality ?? 'minimal';
    const initial = options.initialQuality ?? 'high';
    this.#quality = qualityIndex(initial) < qualityIndex(this.minimumQuality) ? this.minimumQuality : initial;
    this.#now = options.now ?? (() => Date.now());
    this.#hysteresisFrames = Math.max(1, Math.trunc(options.hysteresisFrames ?? 30));
    this.#recoveryFrames = Math.max(1, Math.trunc(options.recoveryFrames ?? 90));
    this.#maxHistory = Math.max(8, Math.trunc(options.maxHistory ?? 128));
    this.#lastDecision = this.#buildDecision(0, 'initialization', 0);
  }

  sample(signal: DirectorSignalV7): DirectorDecisionV7 {
    this.#frame += 1;
    const pressure = pressureForSignal(signal, this.budget);
    if (this.#cooldown > 0) this.#cooldown -= 1;

    const severe = pressure >= 1.5 || signal.simulationDebtMs > this.budget.cpuMs * 2;
    const stressed = pressure >= 1.08;
    const healthy = pressure <= 0.82;
    if (severe) {
      this.#badFrames = this.#hysteresisFrames;
      this.#goodFrames = 0;
    } else if (stressed) {
      this.#badFrames += 1;
      this.#goodFrames = 0;
    } else if (healthy) {
      this.#goodFrames += 1;
      this.#badFrames = Math.max(0, this.#badFrames - 1);
    } else {
      this.#badFrames = Math.max(0, this.#badFrames - 1);
      this.#goodFrames = Math.max(0, this.#goodFrames - 1);
    }

    let reason = 'stable';
    if (this.#cooldown === 0 && (severe || this.#badFrames >= this.#hysteresisFrames)) {
      const next = severe ? downgrade(downgrade(this.#quality)) : downgrade(this.#quality);
      if (qualityIndex(next) < qualityIndex(this.#quality)) {
        this.#quality = qualityIndex(next) < qualityIndex(this.minimumQuality) ? this.minimumQuality : next;
        this.#cooldown = this.#hysteresisFrames;
        reason = severe ? 'severe-pressure' : 'sustained-pressure';
        this.#badFrames = 0;
      }
    } else if (this.#cooldown === 0 && this.#goodFrames >= this.#recoveryFrames && pressure < 0.62) {
      const next = upgrade(this.#quality);
      if (qualityIndex(next) >= qualityIndex(this.#quality) && qualityIndex(next) <= qualityIndex('ultra')) {
        this.#quality = next;
        this.#cooldown = this.#recoveryFrames;
        reason = 'sustained-recovery';
        this.#goodFrames = 0;
      }
    }

    this.#lastDecision = this.#buildDecision(pressure, reason, this.#cooldown);
    this.#history.push(Object.freeze({ frame: this.#frame, quality: this.#quality, pressure, reason }));
    if (this.#history.length > this.#maxHistory) this.#history.splice(0, this.#history.length - this.#maxHistory);
    return this.#lastDecision;
  }

  decision(): DirectorDecisionV7 { return this.#lastDecision; }
  quality(): QualityTierV7 { return this.#quality; }
  history(): readonly DirectorHistoryEntryV7[] { return Object.freeze(this.#history.slice()); }

  health(usage: RuntimeUsageV7): RuntimeHealthV7 {
    const pressure = pressureForSignal({
      cpuMs: usage.cpuMs,
      gpuMs: usage.gpuMs,
      frameMs: usage.frameMs,
      memoryBytes: usage.memoryBytes,
      networkKbps: usage.networkBytes / Math.max(1, usage.frameMs),
      loadedAssets: usage.activeEntities,
      visibleEntities: usage.visibleEntities,
      simulationDebtMs: Math.max(0, usage.simulationSteps - this.budget.simulationSteps) * 2,
    }, this.budget);
    const score = Math.round(clampV7(100 - pressure * 35, 0, 100));
    const degraded = score < 80 || this.#quality !== 'ultra';
    const stable = score >= 70 && this.#cooldown === 0;
    const reasons = [
      ...(score < 70 ? ['runtime-pressure'] : []),
      ...(usage.queuedAssets > 0 ? ['asset-backlog'] : []),
      ...(usage.pendingCommands > 32 ? ['command-backlog'] : []),
      ...(this.#quality !== 'ultra' ? ['quality-adaptation-active'] : []),
    ];
    return Object.freeze({ score, stable, degraded, reasons: Object.freeze(reasons) });
  }

  #buildDecision(pressure: number, reason: string, cooldownFrames: number): DirectorDecisionV7 {
    const profile = tierProfile(this.#quality);
    return Object.freeze({ quality: this.#quality, ...profile, pressure, reason, cooldownFrames });
  }
}

export function distanceBandV7(distance: number): 'critical' | 'near' | 'mid' | 'far' {
  if (distance <= 20) return 'critical';
  if (distance <= 80) return 'near';
  if (distance <= 240) return 'mid';
  return 'far';
}

export function cameraPressureV7(camera: Vec3V7, focus: Vec3V7, velocity: Vec3V7): number {
  const dx = camera.x - focus.x;
  const dy = camera.y - focus.y;
  const dz = camera.z - focus.z;
  const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const speed = Math.sqrt(velocity.x * velocity.x + velocity.y * velocity.y + velocity.z * velocity.z);
  return clampV7((speed * 0.04) + (1 / Math.max(1, distance)) * 2, 0, 1);
}
