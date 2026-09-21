/**
 * Deterministic scheduler V15.
 *
 * Provides a fixed-step clock, ordered command lanes, a bounded timer queue and
 * an explicit catch-up policy. No wall-clock value participates in simulation ordering.
 */
export type SchedulerLaneV15 = 'input' | 'simulation' | 'world' | 'network' | 'presentation' | 'background';
export type CatchUpPolicyV15 = 'clamp' | 'drop-oldest' | 'slow-motion';

export interface SimulationClockV15 {
  readonly frame: number;
  readonly tick: number;
  readonly simulationTimeMs: number;
  readonly realDeltaMs: number;
  readonly simulationDeltaMs: number;
  readonly accumulatorMs: number;
  readonly steps: number;
}

export interface ScheduledCommandV15<T = unknown> {
  readonly id: string;
  readonly lane: SchedulerLaneV15;
  readonly executeAtTick: number;
  readonly priority: number;
  readonly sequence: number;
  readonly payload: T;
  readonly run: (payload: T, clock: SimulationClockV15) => void | T;
}

export interface ScheduledTimerV15 {
  readonly id: string;
  readonly executeAtTick: number;
  readonly intervalTicks: number;
  readonly repeat: number;
  readonly sequence: number;
  readonly run: (timer: ScheduledTimerV15, clock: SimulationClockV15) => void;
}

export interface SchedulerReportV15 {
  readonly clock: SimulationClockV15;
  readonly executedCommands: readonly string[];
  readonly executedTimers: readonly string[];
  readonly droppedCommands: number;
  readonly droppedTimeMs: number;
  readonly catchUpClamped: boolean;
  readonly laneCounts: Readonly<Record<SchedulerLaneV15, number>>;
}

export interface DeterministicSchedulerOptionsV15 {
  readonly fixedStepMs?: number;
  readonly maxCatchUpSteps?: number;
  readonly maxDebtMs?: number;
  readonly catchUpPolicy?: CatchUpPolicyV15;
  readonly maxCommands?: number;
  readonly maxTimers?: number;
}

const LANES: readonly SchedulerLaneV15[] = ['input','simulation','world','network','presentation','background'];
const finite = (value: number, fallback = 0): number => Number.isFinite(value) ? value : fallback;
const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, finite(value, min)));
const laneRank = (lane: SchedulerLaneV15): number => LANES.indexOf(lane);

export class DeterministicSchedulerV15 {
  readonly #fixedStepMs: number;
  readonly #maxCatchUpSteps: number;
  readonly #maxDebtMs: number;
  readonly #catchUpPolicy: CatchUpPolicyV15;
  readonly #maxCommands: number;
  readonly #maxTimers: number;
  readonly #commands = new Map<string, ScheduledCommandV15>();
  readonly #timers = new Map<string, ScheduledTimerV15>();
  #commandSequence = 0;
  #timerSequence = 0;
  #frame = 0;
  #tick = 0;
  #timeMs = 0;
  #accumulatorMs = 0;

  constructor(options: DeterministicSchedulerOptionsV15 = {}) {
    this.#fixedStepMs = clamp(options.fixedStepMs ?? 1000 / 60, 1, 1000);
    this.#maxCatchUpSteps = Math.max(1, Math.min(60, Math.trunc(options.maxCatchUpSteps ?? 8)));
    this.#maxDebtMs = Math.max(this.#fixedStepMs, Math.floor(options.maxDebtMs ?? this.#fixedStepMs * this.#maxCatchUpSteps * 2));
    this.#catchUpPolicy = options.catchUpPolicy ?? 'clamp';
    this.#maxCommands = Math.max(64, Math.trunc(options.maxCommands ?? 8192));
    this.#maxTimers = Math.max(32, Math.trunc(options.maxTimers ?? 2048));
  }

  get fixedStepMs(): number { return this.#fixedStepMs; }
  get frame(): number { return this.#frame; }
  get tick(): number { return this.#tick; }
  get simulationTimeMs(): number { return this.#timeMs; }
  get pendingCommands(): number { return this.#commands.size; }
  get pendingTimers(): number { return this.#timers.size; }

  queueCommand<T>(command: Omit<ScheduledCommandV15<T>, 'sequence'>): ScheduledCommandV15<T> {
    if (!command.id.trim()) throw new Error('Scheduler command id cannot be empty.');
    if (this.#commands.has(command.id)) throw new Error('Scheduler command already exists: ' + command.id);
    if (this.#commands.size >= this.#maxCommands) throw new Error('Scheduler command capacity reached.');
    const value = Object.freeze({ ...command, priority: Math.max(0, Math.trunc(command.priority)), executeAtTick: Math.max(0, Math.trunc(command.executeAtTick)), sequence: ++this.#commandSequence }) as ScheduledCommandV15<T>;
    this.#commands.set(value.id, value as ScheduledCommandV15);
    return value;
  }

  scheduleTimer(timer: Omit<ScheduledTimerV15, 'sequence'>): ScheduledTimerV15 {
    if (!timer.id.trim()) throw new Error('Scheduler timer id cannot be empty.');
    if (this.#timers.has(timer.id)) throw new Error('Scheduler timer already exists: ' + timer.id);
    if (this.#timers.size >= this.#maxTimers) throw new Error('Scheduler timer capacity reached.');
    const value: ScheduledTimerV15 = Object.freeze({ ...timer, executeAtTick: Math.max(0, Math.trunc(timer.executeAtTick)), intervalTicks: Math.max(1, Math.trunc(timer.intervalTicks)), repeat: Math.max(0, Math.trunc(timer.repeat)), sequence: ++this.#timerSequence });
    this.#timers.set(value.id, value);
    return value;
  }

  cancelCommand(id: string): boolean { return this.#commands.delete(id); }
  cancelTimer(id: string): boolean { return this.#timers.delete(id); }
  clearCommands(): void { this.#commands.clear(); }
  clearTimers(): void { this.#timers.clear(); }

  advance(realDeltaMs: number): SchedulerReportV15 {
    const raw = Math.max(0, finite(realDeltaMs));
    this.#frame += 1;
    this.#accumulatorMs += raw;
    let droppedCommands = 0;
    let droppedTimeMs = 0;
    let catchUpClamped = false;

    if (this.#accumulatorMs > this.#maxDebtMs) {
      droppedTimeMs = this.#accumulatorMs - this.#maxDebtMs;
      this.#accumulatorMs = this.#maxDebtMs;
      catchUpClamped = true;
      if (this.#catchUpPolicy === 'drop-oldest') this.#dropOverdueCommands();
      if (this.#catchUpPolicy === 'slow-motion') this.#accumulatorMs = Math.min(this.#accumulatorMs, this.#fixedStepMs * this.#maxCatchUpSteps * 1.25);
    }

    let steps = 0;
    const executedCommands: string[] = [];
    const executedTimers: string[] = [];
    const laneCounts: Record<SchedulerLaneV15, number> = Object.fromEntries(LANES.map((lane) => [lane, 0])) as Record<SchedulerLaneV15, number>;
    while (this.#accumulatorMs >= this.#fixedStepMs && steps < this.#maxCatchUpSteps) {
      this.#accumulatorMs -= this.#fixedStepMs;
      this.#tick += 1;
      this.#timeMs += this.#fixedStepMs;
      steps += 1;
      const clock = this.#clock(raw, steps);
      for (const command of this.#dueCommands()) {
        try { command.run(command.payload, clock); executedCommands.push(command.id); laneCounts[command.lane] += 1; }
        finally { this.#commands.delete(command.id); }
      }
      for (const timer of this.#dueTimers()) {
        timer.run(timer, clock);
        executedTimers.push(timer.id);
        if (timer.repeat > 1 || timer.repeat === 0) {
          const remaining = timer.repeat === 0 ? 0 : timer.repeat - 1;
          this.#timers.set(timer.id, Object.freeze({ ...timer, repeat: remaining, executeAtTick: timer.executeAtTick + timer.intervalTicks }));
        } else {
          this.#timers.delete(timer.id);
        }
      }
    }

    if (steps === this.#maxCatchUpSteps && this.#accumulatorMs >= this.#fixedStepMs) {
      catchUpClamped = true;
      if (this.#catchUpPolicy === 'clamp') { droppedTimeMs += this.#accumulatorMs - this.#fixedStepMs * 0.5; this.#accumulatorMs = this.#fixedStepMs * 0.5; }
    }
    if (this.#catchUpPolicy === 'drop-oldest') droppedCommands += this.#dropOverdueCommands();

    return Object.freeze({ clock: this.#clock(raw, steps), executedCommands: Object.freeze(executedCommands), executedTimers: Object.freeze(executedTimers), droppedCommands, droppedTimeMs, catchUpClamped, laneCounts: Object.freeze(laneCounts) });
  }

  clock(realDeltaMs = 0, steps = 0): SimulationClockV15 { return Object.freeze({ frame:this.#frame, tick:this.#tick, simulationTimeMs:this.#timeMs, realDeltaMs:Math.max(0,finite(realDeltaMs)), simulationDeltaMs:steps*this.#fixedStepMs, accumulatorMs:this.#accumulatorMs, steps }); }
  snapshot(): Readonly<{ frame:number; tick:number; simulationTimeMs:number; accumulatorMs:number; commands:readonly ScheduledCommandV15[]; timers:readonly ScheduledTimerV15[] }> {
    return Object.freeze({ frame:this.#frame, tick:this.#tick, simulationTimeMs:this.#timeMs, accumulatorMs:this.#accumulatorMs, commands:Object.freeze([...this.#commands.values()].sort((a,b)=>a.executeAtTick-b.executeAtTick||b.priority-a.priority||laneRank(a.lane)-laneRank(b.lane)||a.sequence-b.sequence)), timers:Object.freeze([...this.#timers.values()].sort((a,b)=>a.executeAtTick-b.executeAtTick||a.sequence-b.sequence)) });
  }
  reset(): void { this.#commands.clear(); this.#timers.clear(); this.#commandSequence=0; this.#timerSequence=0; this.#frame=0; this.#tick=0; this.#timeMs=0; this.#accumulatorMs=0; }

  #dueCommands(): readonly ScheduledCommandV15[] { return Object.freeze([...this.#commands.values()].filter((command)=>command.executeAtTick<=this.#tick).sort((a,b)=>a.executeAtTick-b.executeAtTick||laneRank(a.lane)-laneRank(b.lane)||b.priority-a.priority||a.sequence-b.sequence||a.id.localeCompare(b.id))); }
  #dueTimers(): readonly ScheduledTimerV15[] { return Object.freeze([...this.#timers.values()].filter((timer)=>timer.executeAtTick<=this.#tick).sort((a,b)=>a.executeAtTick-b.executeAtTick||a.sequence-b.sequence||a.id.localeCompare(b.id))); }
  #dropOverdueCommands(): number { const overdue=this.#dueCommands(); let dropped=0; for(const command of overdue){ if(command.executeAtTick<this.#tick-1&&!this.#commands.delete(command.id)) continue; if(command.executeAtTick<this.#tick-1)dropped+=1; } return dropped; }
}

export const deterministicTickForTime = (simulationTimeMs:number,fixedStepMs:number):number => Math.max(0,Math.floor(Math.max(0,finite(simulationTimeMs))/Math.max(1,fixedStepMs)));
