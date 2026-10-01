import type { PriorityBand, RuntimePhase } from './contracts';

export interface ResourceQuota {
  readonly phase: RuntimePhase;
  readonly cpuMs: number;
  readonly memoryBytes: number;
  readonly workItems: number;
}

export interface ResourceReservation {
  readonly id: string;
  readonly phase: RuntimePhase;
  readonly priority: PriorityBand;
  readonly cpuMs: number;
  readonly memoryBytes: number;
  readonly workItems: number;
  readonly tick: number;
}

export interface ResourceBudgetSnapshot {
  readonly quotas: readonly ResourceQuota[];
  readonly reservedCpuMs: number;
  readonly reservedMemoryBytes: number;
  readonly reservedWorkItems: number;
  readonly reservationCount: number;
  readonly availableCpuMs: number;
  readonly availableMemoryBytes: number;
  readonly availableWorkItems: number;
}

const SCORE: Record<PriorityBand, number> = {
  critical: 100,
  high: 75,
  normal: 50,
  low: 25,
  background: 5,
};

export class R35ResourceBudget {
  #quotas = new Map<RuntimePhase, ResourceQuota>();
  #reservations = new Map<string, ResourceReservation>();
  #sequence = 0;

  constructor(quotas: readonly ResourceQuota[]) {
    for (const quota of quotas) {
      if (quota.cpuMs <= 0 || quota.memoryBytes <= 0 || quota.workItems < 1) throw new RangeError('invalid resource quota');
      this.#quotas.set(quota.phase, { ...quota });
    }
  }

  reserve(
    phase: RuntimePhase,
    request: Omit<ResourceReservation, 'id' | 'phase'>,
  ): ResourceReservation | null {
    const quota = this.#quotas.get(phase);
    if (!quota) return null;
    if (request.cpuMs < 0 || request.memoryBytes < 0 || request.workItems < 0) return null;

    const existing = this.reservationsFor(phase);
    const cpu = existing.reduce((sum, item) => sum + item.cpuMs, 0);
    const memory = existing.reduce((sum, item) => sum + item.memoryBytes, 0);
    const workItems = existing.reduce((sum, item) => sum + item.workItems, 0);
    if (cpu + request.cpuMs > quota.cpuMs || memory + request.memoryBytes > quota.memoryBytes || workItems + request.workItems > quota.workItems) {
      return null;
    }

    const reservation: ResourceReservation = {
      id: request.id ?? 'reservation-' + (++this.#sequence),
      phase,
      priority: request.priority,
      cpuMs: request.cpuMs,
      memoryBytes: request.memoryBytes,
      workItems: request.workItems,
      tick: request.tick,
    };
    if (this.#reservations.has(reservation.id)) return null;
    this.#reservations.set(reservation.id, reservation);
    return Object.freeze({ ...reservation });
  }

  release(id: string): boolean {
    return this.#reservations.delete(id);
  }

  releasePhase(phase: RuntimePhase): number {
    let released = 0;
    for (const [id, reservation] of this.#reservations) {
      if (reservation.phase !== phase) continue;
      this.#reservations.delete(id);
      released += 1;
    }
    return released;
  }

  rebalance(phase: RuntimePhase): readonly ResourceReservation[] {
    const quota = this.#quotas.get(phase);
    if (!quota) return [];
    const items = this.reservationsFor(phase);
    let cpu = items.reduce((sum, item) => sum + item.cpuMs, 0);
    let memory = items.reduce((sum, item) => sum + item.memoryBytes, 0);
    let work = items.reduce((sum, item) => sum + item.workItems, 0);
    if (cpu <= quota.cpuMs && memory <= quota.memoryBytes && work <= quota.workItems) return items;

    const ordered = items.slice().sort((a, b) => SCORE[a.priority] - SCORE[b.priority] || a.tick - b.tick || a.id.localeCompare(b.id));
    for (const item of ordered) {
      if (cpu <= quota.cpuMs && memory <= quota.memoryBytes && work <= quota.workItems) break;
      this.#reservations.delete(item.id);
      cpu -= item.cpuMs;
      memory -= item.memoryBytes;
      work -= item.workItems;
    }
    return this.reservationsFor(phase);
  }

  reservationsFor(phase: RuntimePhase): readonly ResourceReservation[] {
    return [...this.#reservations.values()]
      .filter((item) => item.phase === phase)
      .sort((a, b) => SCORE[b.priority] - SCORE[a.priority] || a.tick - b.tick || a.id.localeCompare(b.id))
      .map((item) => ({ ...item }));
  }

  snapshot(): ResourceBudgetSnapshot {
    let reservedCpuMs = 0;
    let reservedMemoryBytes = 0;
    let reservedWorkItems = 0;
    for (const reservation of this.#reservations.values()) {
      reservedCpuMs += reservation.cpuMs;
      reservedMemoryBytes += reservation.memoryBytes;
      reservedWorkItems += reservation.workItems;
    }
    const quotas = [...this.#quotas.values()].sort((a, b) => a.phase.localeCompare(b.phase));
    const totalCpu = quotas.reduce((sum, quota) => sum + quota.cpuMs, 0);
    const totalMemory = quotas.reduce((sum, quota) => sum + quota.memoryBytes, 0);
    const totalWork = quotas.reduce((sum, quota) => sum + quota.workItems, 0);
    return {
      quotas,
      reservedCpuMs,
      reservedMemoryBytes,
      reservedWorkItems,
      reservationCount: this.#reservations.size,
      availableCpuMs: Math.max(0, totalCpu - reservedCpuMs),
      availableMemoryBytes: Math.max(0, totalMemory - reservedMemoryBytes),
      availableWorkItems: Math.max(0, totalWork - reservedWorkItems),
    };
  }

  clear(): void {
    this.#reservations.clear();
  }
}

export function createDefaultR35ResourceBudget(): R35ResourceBudget {
  return new R35ResourceBudget([
    { phase: 'simulation', cpuMs: 4.5, memoryBytes: 128 * 1024 * 1024, workItems: 128 },
    { phase: 'ai', cpuMs: 1.6, memoryBytes: 64 * 1024 * 1024, workItems: 64 },
    { phase: 'navigation', cpuMs: 1.2, memoryBytes: 64 * 1024 * 1024, workItems: 64 },
    { phase: 'streaming', cpuMs: 2, memoryBytes: 256 * 1024 * 1024, workItems: 48 },
    { phase: 'network', cpuMs: 1.1, memoryBytes: 32 * 1024 * 1024, workItems: 64 },
    { phase: 'render', cpuMs: 8, memoryBytes: 384 * 1024 * 1024, workItems: 256 },
  ]);
}
