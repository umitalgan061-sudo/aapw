import type { DeviceTier, RuntimeConfig, Tick } from './contracts.ts';
import { TIER_CONFIG, hashString, stableJson } from './contracts.ts';
import { NextGenRuntime, createRuntime } from './runtime.ts';
import { EventBus, CommandBus } from './events.ts';
import { AiDirector } from './ai.ts';
import { CombatSystem } from './gameplay.ts';
import { QuestJournal } from './quests.ts';
import { ProceduralWorld } from './world.ts';
import { SnapshotHistory } from './network.ts';
import { HealthMonitor } from './telemetry.ts';

export interface GameSessionOptions {
  readonly tier?: DeviceTier;
  readonly networkMode?: RuntimeConfig['networkMode'];
  readonly seed?: number;
  readonly build?: string;
}

export interface SessionSnapshot {
  readonly build: string;
  readonly tick: Tick;
  readonly runtime: ReturnType<NextGenRuntime['snapshot']>;
  readonly worldChecksum: string;
  readonly questsChecksum: string;
  readonly networkChecksum: string;
  readonly eventDigest: string;
  readonly checksum: string;
}

export class GameSession {
  readonly runtime: NextGenRuntime;
  readonly events: EventBus;
  readonly commands: CommandBus;
  readonly ai: AiDirector;
  readonly combat: CombatSystem;
  readonly quests: QuestJournal;
  readonly world: ProceduralWorld;
  readonly networkHistory: SnapshotHistory;
  readonly health: HealthMonitor;
  readonly #build: string;

  constructor(options: GameSessionOptions = {}) {
    const seed = options.seed ?? 0x5e5510;
    this.#build = options.build ?? 'nextgen-dev';
    this.runtime = createRuntime(options.tier ?? 'balanced', options.networkMode ?? 'offline', seed);
    this.events = new EventBus(2048);
    this.commands = new CommandBus(512);
    this.ai = new AiDirector(seed ^ 0xa5a5a5, { maxThinkers: 128, thinkIntervalTicks: 8, memoryLimit: 16 });
    this.combat = new CombatSystem();
    this.quests = new QuestJournal();
    this.world = new ProceduralWorld({ seed, cellSize: 32, worldRadius: 64 });
    this.networkHistory = new SnapshotHistory(96);
    this.health = new HealthMonitor();
    this.#wire();
  }

  #wire(): void {
    this.commands.register('quest:start', (command) => {
      const id = String(command.payload);
      if (this.quests.start(id)) this.events.emit('quest:started', { id }, command.tick, 'gameplay');
    });
    this.commands.register('quest:progress', (command) => {
      const payload = command.payload as { id: string; objective: string; amount: number };
      const state = this.quests.progress(payload.id, payload.objective, payload.amount);
      if (state) this.events.emit('quest:progress', state, command.tick, 'gameplay');
    });
    this.runtime.on('tick', ({ state }) => {
      this.world.step(state.simulationDeltaSeconds);
      this.quests.setTick(state.tick);
      this.quests.tick(state.tick);
      this.ai.tick(Number(state.tick));
      this.combat.tick(state.simulationDeltaSeconds * 1000, new Map(), new Map());
      this.commands.dispatch(state.tick);
    });
    this.runtime.on('health', ({ health }) => this.events.emit('runtime:health', health, this.runtime.snapshot().clock.tick, 'telemetry'));
  }

  start(now = performance.now()): void { this.runtime.start(now); }
  frame(now: number, input: Parameters<NextGenRuntime['frame']>[1] = {}): ReturnType<NextGenRuntime['snapshot']> { return this.runtime.frame(now, input); }
  stop(): void { this.runtime.stop(); }

  snapshot(): SessionSnapshot {
    const runtime = this.runtime.snapshot();
    const world = this.world.snapshot();
    const quests = this.quests.snapshot();
    const networkChecksum = this.networkHistory.latest()?.checksum ?? hashString('network:empty');
    const eventDigest = this.events.digest();
    const payload = { build: this.#build, tick: runtime.clock.tick, runtime, worldChecksum: world.checksum, questsChecksum: quests.checksum, networkChecksum, eventDigest };
    return Object.freeze({ ...payload, checksum: hashString(stableJson(payload)) });
  }
}

export const createSession = (options?: GameSessionOptions): GameSession => new GameSession(options);
export const tierSummary = (tier: DeviceTier) => Object.freeze({ tier, config: TIER_CONFIG[tier], configDigest: hashString(stableJson(TIER_CONFIG[tier])) });
