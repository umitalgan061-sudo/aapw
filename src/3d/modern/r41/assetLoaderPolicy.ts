import type { CommandPriority } from './contracts';

export interface AssetLoadContext {
  readonly visible: boolean;
  readonly distance: number;
  readonly importance: number;
  readonly required: boolean;
  readonly priority: CommandPriority;
  readonly online: boolean;
  readonly cacheHit: boolean;
  readonly memoryPressure: number;
}

export interface AssetLoadDecision {
  readonly action:
    | 'load'
    | 'prefetch'
    | 'defer'
    | 'reject'
    | 'cache';
  readonly concurrencyCost: number;
  readonly reason: string;
}

export class AssetLoaderPolicy {
  decide(
    context: AssetLoadContext,
  ): AssetLoadDecision {
    if (
      context.required
      && context.memoryPressure >= 0.98
    ) {
      return Object.freeze({
        action: 'reject',
        concurrencyCost: 0,
        reason: 'critical-memory-pressure',
      });
    }

    if (context.cacheHit) {
      return Object.freeze({
        action: 'cache',
        concurrencyCost: 0,
        reason: 'resident-cache',
      });
    }

    if (!context.online) {
      return Object.freeze({
        action: 'defer',
        concurrencyCost: 0,
        reason: 'offline',
      });
    }

    if (
      context.required
      || (
        context.visible
        && context.distance < 90
      )
    ) {
      return Object.freeze({
        action: 'load',
        concurrencyCost: 1,
        reason: 'visible-or-required',
      });
    }

    if (
      context.distance < 320
      && context.importance > 0.6
    ) {
      const predictive =
        context.memoryPressure < 0.75;

      return Object.freeze({
        action: predictive
          ? 'prefetch'
          : 'defer',
        concurrencyCost: predictive
          ? 1
          : 0,
        reason: predictive
          ? 'predictive-prefetch'
          : 'pressure-limited',
      });
    }

    return Object.freeze({
      action: 'defer',
      concurrencyCost: 0,
      reason:
        context.priority === 'background'
          ? 'background-work'
          : 'low-interest',
    });
  }
}
