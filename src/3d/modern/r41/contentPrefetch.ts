import type { CommandPriority } from './contracts';

export interface PrefetchCandidate {
  readonly id: string;
  readonly distance: number;
  readonly importance: number;
  readonly bytes: number;
  readonly priority: CommandPriority;
}

export interface PrefetchPlan {
  readonly selected: readonly string[];
  readonly deferred: readonly string[];
  readonly bytes: number;
}

export class ContentPrefetchPlanner {
  readonly budgetBytes: number;
  readonly maxItems: number;

  constructor(
    budgetBytes = 16 * 1024 * 1024,
    maxItems = 16,
  ) {
    this.budgetBytes = Math.max(
      1024,
      Math.trunc(budgetBytes),
    );
    this.maxItems = Math.max(
      1,
      Math.trunc(maxItems),
    );
  }

  plan(
    candidates: readonly PrefetchCandidate[],
    resident: ReadonlySet<string>,
  ): PrefetchPlan {
    const priority = (
      value: CommandPriority,
    ): number => {
      switch (value) {
        case 'critical':
          return 5;
        case 'high':
          return 4;
        case 'normal':
          return 3;
        case 'low':
          return 2;
        case 'background':
          return 1;
      }
    };

    const ordered = [
      ...candidates,
    ]
      .filter(
        candidate =>
          !resident.has(candidate.id),
      )
      .sort(
        (a, b) =>
          priority(b.priority)
          - priority(a.priority)
          || b.importance
          - a.importance
          || a.distance
          - b.distance
          || a.id.localeCompare(b.id),
      );

    const selected: string[] = [];
    const deferred: string[] = [];
    let bytes = 0;

    for (const candidate of ordered) {
      if (
        selected.length
          < this.maxItems
        && bytes + candidate.bytes
          <= this.budgetBytes
      ) {
        selected.push(candidate.id);
        bytes += Math.max(
          0,
          candidate.bytes,
        );
      } else {
        deferred.push(candidate.id);
      }
    }

    return Object.freeze({
      selected:
        Object.freeze(selected),
      deferred:
        Object.freeze(deferred),
      bytes,
    });
  }
}
