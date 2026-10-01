/** Fault-isolated, deterministic fan-out bus for combat presentation consumers. */
import type { CombatAccessibilitySignal } from './combatPresentationAccessibilityV1';
import type { CombatPresentationDispatch } from './combatPresentationQueueV1';

export type CombatPresentationConsumerChannel = 'vfx' | 'sfx' | 'haptic' | 'camera' | 'accessibility';
export interface CombatPresentationConsumerContext { readonly tick: number; readonly sequence: number; readonly channel: CombatPresentationConsumerChannel; }
export interface CombatPresentationConsumer { readonly id: string; readonly channels: readonly CombatPresentationConsumerChannel[]; readonly priority?: number; readonly consume: (dispatch: CombatPresentationDispatch, accessibility: readonly CombatAccessibilitySignal[], context: CombatPresentationConsumerContext) => void; }
export interface CombatPresentationBusReport { readonly tick: number; readonly dispatched: number; readonly delivered: number; readonly rejected: number; readonly consumerFailures: number; readonly consumerIds: readonly string[]; }

export class CombatPresentationBus {
  #consumers = new Map<string, CombatPresentationConsumer>();
  #sequence = 0;
  #failures: string[] = [];

  subscribe(consumer: CombatPresentationConsumer): void {
    if (!consumer.id.trim()) throw new Error('presentation consumer id must not be empty');
    if (this.#consumers.has(consumer.id)) throw new Error('duplicate presentation consumer ' + consumer.id);
    if (typeof consumer.consume !== 'function') throw new TypeError('presentation consumer must expose consume');
    this.#consumers.set(consumer.id, Object.freeze({ ...consumer, channels: Object.freeze([...consumer.channels]), priority: consumer.priority ?? 0 }));
  }
  unsubscribe(id: string): boolean { return this.#consumers.delete(id); }
  clear(): void { this.#consumers.clear(); this.#failures = []; }
  consumerCount(): number { return this.#consumers.size; }
  failureLog(): readonly string[] { return Object.freeze([...this.#failures]); }

  dispatch(dispatches: readonly CombatPresentationDispatch[], accessibility: readonly CombatAccessibilitySignal[] = [], tick = 0): CombatPresentationBusReport {
    const consumers = [...this.#consumers.values()].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0) || a.id.localeCompare(b.id));
    let delivered = 0; let rejected = 0; let failures = 0;
    const ids: string[] = [];
    for (const dispatch of dispatches) {
      this.#sequence += 1;
      for (const consumer of consumers) {
        const channelEnabled = consumer.channels.some((channel) => channel === 'accessibility' ? accessibility.some((signal) => signal.cueId === dispatch.cue.id) : dispatch.channels[channel]);
        if (!channelEnabled) continue;
        ids.push(consumer.id);
        try { consumer.consume(dispatch, accessibility, Object.freeze({ tick, sequence: this.#sequence, channel: (consumer.channels.find((channel) => channel !== 'accessibility' && dispatch.channels[channel]) ?? 'accessibility'), })); delivered += 1; }
        catch (error) { failures += 1; this.#failures.push(consumer.id + ':' + (error instanceof Error ? error.message : String(error))); }
      }
      if (dispatch.channels.vfx || dispatch.channels.sfx || dispatch.channels.haptic || dispatch.channels.camera) rejected += 0;
    }
    if (this.#failures.length > 64) this.#failures.splice(0, this.#failures.length - 64);
    return Object.freeze({ tick, dispatched: dispatches.length, delivered, rejected, consumerFailures: failures, consumerIds: Object.freeze([...new Set(ids)].sort()) });
  }
}

export function createCombatPresentationBus(): CombatPresentationBus { return new CombatPresentationBus(); }

export function validateCombatPresentationBusReport(report: CombatPresentationBusReport): boolean {
  return Number.isInteger(report.tick) && report.tick >= 0 && report.dispatched >= 0 && report.delivered >= 0 && report.consumerFailures >= 0 && report.consumerIds.every((id) => id.length > 0);
}