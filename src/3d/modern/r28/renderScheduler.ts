export interface RenderBudget {
  readonly frameTargetMs: number;
  readonly maxSubmissions: number;
  readonly maxShadowUpdates: number;
}

export interface RenderSubmission {
  readonly id: string;
  readonly priority: number;
  readonly cost: number;
  readonly execute: () => void;
}

export interface RenderSchedule {
  readonly submitted: readonly string[];
  readonly deferred: readonly string[];
  readonly estimatedCost: number;
  readonly budget: RenderBudget;
}

export class DeterministicRenderScheduler {
  readonly budget: RenderBudget;
  #queue = new Map<string, RenderSubmission>();

  constructor(budget: Partial<RenderBudget> = {}) {
    this.budget = Object.freeze({
      frameTargetMs: Math.max(1, budget.frameTargetMs ?? 16.67),
      maxSubmissions: Math.max(1, Math.floor(budget.maxSubmissions ?? 512)),
      maxShadowUpdates: Math.max(0, Math.floor(budget.maxShadowUpdates ?? 64)),
    });
  }

  enqueue(submission: RenderSubmission): void {
    if (!submission.id || !Number.isFinite(submission.priority) || submission.cost < 0) return;
    this.#queue.set(submission.id, submission);
  }

  run(availableCost = this.budget.frameTargetMs): RenderSchedule {
    const remaining = Math.max(0, availableCost);
    const ordered = [...this.#queue.values()]
      .sort((a, b) => b.priority - a.priority || a.cost - b.cost || a.id.localeCompare(b.id));
    const submitted: string[] = [];
    const deferred: string[] = [];
    let used = 0;

    for (const submission of ordered) {
      const withinCount = submitted.length < this.budget.maxSubmissions;
      const withinCost = used + submission.cost <= remaining;
      if (withinCount && withinCost) {
        submission.execute();
        submitted.push(submission.id);
        used += submission.cost;
        this.#queue.delete(submission.id);
      } else {
        deferred.push(submission.id);
      }
    }

    return Object.freeze({
      submitted,
      deferred,
      estimatedCost: used,
      budget: this.budget,
    });
  }

  clear(): void {
    this.#queue.clear();
  }

  size(): number {
    return this.#queue.size;
  }
}
