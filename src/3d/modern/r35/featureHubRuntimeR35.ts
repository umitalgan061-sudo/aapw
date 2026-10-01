
import { AccessibilityRuntimeR35 } from './accessibilityRuntimeR35';
import { AnimationRuntimeR35 } from './animationRuntimeR35';
import { CombatRuntimeR35 } from './combatRuntimeR35';
import { ContentRegistryR35 } from './contentRegistryR35';
import { CraftingRuntimeR35 } from './craftingRuntimeR35';
import { DialogueRuntimeR35 } from './dialogueRuntimeR35';
import { EconomyRuntimeR35 } from './economyRuntimeR35';
import { InteractionRuntimeR35 } from './interactionRuntimeR35';
import { InventoryRuntimeR35 } from './inventoryRuntimeR35';
import { LocalizationRuntimeR35 } from './localizationRuntimeR35';
import { NavigationRuntimeR35 } from './navigationRuntimeR35';
import { PhotoModeRuntimeR35 } from './photoModeRuntimeR35';
import { QuestRuntimeR35 } from './questRuntimeR35';
import { ReplayRuntimeR35 } from './replayRuntimeR35';
import { SaveRuntimeR35 } from './saveRuntimeR35';
import { StreamingRuntimeR35 } from './streamingRuntimeR35';
import { TelemetryRuntimeR35 } from './telemetryRuntimeR35';
import { WeatherRuntimeR35 } from './weatherRuntimeR35';
import { WorldSimulationR35 } from './worldSimulationR35';
import { stableHash, type R35HealthReport, type R35ItemDefinition, type R35QuestDefinition, type R35Vec3 } from './contracts';
export interface FeatureHubConfig {
  readonly inventoryCapacity?: number;
  readonly saveSchema?: number;
  readonly streamBytes?: number;
}

export interface FeatureTickResult {
  readonly tick: number;
  readonly weather: ReturnType<WeatherRuntimeR35['state']>;
  readonly combatEvents: ReturnType<CombatRuntimeR35['step']>;
  readonly interactions: ReturnType<InteractionRuntimeR35['candidates']>;
  readonly stream: ReturnType<StreamingRuntimeR35['resident']>;
  readonly digest: string;
}

export interface FeatureHealthReport extends R35HealthReport {
  readonly marketItems: number;
  readonly craftingRecipes: number;
  readonly navigationNodes: number;
  readonly animationActors: number;
  readonly streamUsage: number;
  readonly weatherDigest: string;
  readonly featureDigest: string;
}

export class FeatureHubRuntimeR35 {
  readonly world: WorldSimulationR35;
  readonly quests: QuestRuntimeR35;
  readonly inventory: InventoryRuntimeR35;
  readonly dialogue: DialogueRuntimeR35;
  readonly save: SaveRuntimeR35;
  readonly replay: ReplayRuntimeR35;
  readonly accessibility: AccessibilityRuntimeR35;
  readonly content: ContentRegistryR35;
  readonly telemetry: TelemetryRuntimeR35;
  readonly weather: WeatherRuntimeR35;
  readonly economy: EconomyRuntimeR35;
  readonly crafting: CraftingRuntimeR35;
  readonly combat: CombatRuntimeR35;
  readonly navigation: NavigationRuntimeR35;
  readonly interaction: InteractionRuntimeR35;
  readonly animation: AnimationRuntimeR35;
  readonly photoMode: PhotoModeRuntimeR35;
  readonly localization: LocalizationRuntimeR35;
  readonly streaming: StreamingRuntimeR35;

  #tick = 0;
  #phase: 'active' | 'paused' | 'recovering' = 'active';
  #warnings: string[] = [];

  constructor(config: FeatureHubConfig = {}) {
    this.world = new WorldSimulationR35();
    this.quests = new QuestRuntimeR35();
    this.inventory = new InventoryRuntimeR35(
      config.inventoryCapacity ?? 32,
    );
    this.dialogue = new DialogueRuntimeR35();
    this.save = new SaveRuntimeR35(config.saveSchema ?? 1);
    this.replay = new ReplayRuntimeR35(
      'feature-hub-r35',
      35,
      0,
    );
    this.accessibility = new AccessibilityRuntimeR35();
    this.content = new ContentRegistryR35();
    this.telemetry = new TelemetryRuntimeR35();
    this.weather = new WeatherRuntimeR35();
    this.economy = new EconomyRuntimeR35();
    this.crafting.reset();
    this.combat = new CombatRuntimeR35();
    this.navigation = new NavigationRuntimeR35();
    this.interaction = new InteractionRuntimeR35();
    this.animation = new AnimationRuntimeR35();
    this.photoMode = new PhotoModeRuntimeR35();
    this.localization = new LocalizationRuntimeR35();
    this.streaming = new StreamingRuntimeR35(
      config.streamBytes
      ?? 384 * 1024 * 1024,
    );
  }

  setPlayerPosition(position: R35Vec3): void {
    this.world.setPlayerPosition(position);
  }

  registerQuest(definition: R35QuestDefinition): boolean {
    const result = this.quests.register(definition);
    if (!result.ok) {
      this.#warnings.push(result.error.code);
      return false;
    }
    return true;
  }

  registerItem(definition: R35ItemDefinition): boolean {
    const result = this.inventory.registerItem(
      definition,
    );
    if (!result.ok) {
      this.#warnings.push(result.error.code);
      return false;
    }
    return true;
  }

  start(): void {
    if (this.#phase === 'paused') {
      this.#phase = 'active';
    }
  }

  pause(): void {
    if (this.#phase === 'active') {
      this.#phase = 'paused';
    }
  }

  beginRecovery(): void {
    this.#phase = 'recovering';
  }

  finishRecovery(): void {
    this.#phase = 'active';
  }

  tick(
    ticks = 1,
    streamRequired: readonly string[] = [],
  ): FeatureTickResult {
    const count = Math.max(
      1,
      Math.min(8, Math.trunc(ticks)),
    );

    let weather = this.weather.state();
    let combatEvents: ReturnType<CombatRuntimeR35['step']> = [];
    let interactions: ReturnType<InteractionRuntimeR35['candidates']> =
      Object.freeze([]);
    let stream = this.streaming.resident();

    if (this.#phase !== 'active') {
      return Object.freeze({
        tick: this.#tick,
        weather,
        combatEvents,
        interactions,
        stream,
        digest: this.digest(),
      });
    }

    for (let index = 0; index < count; index += 1) {
      this.#tick += 1;

      this.world.step(1);
      this.weather.advance(1);
      combatEvents = this.combat.step(1);
      this.interaction.advance(1);
      this.animation.step(1 / 60);
      this.streaming.advance(1);

      if (streamRequired.length > 0) {
        const plan = this.streaming.plan(
          streamRequired,
        );
        if (plan.ok) {
          this.streaming.commit(plan.value);
        } else {
          this.#warnings.push(
            plan.error.code,
          );
        }
      }

      weather = this.weather.state();
      interactions = this.interaction.candidates(
        { x: 0, y: 0, z: 0 },
        32,
      );
      stream = this.streaming.resident();

      this.telemetry.record(
        'r35.world.entities',
        this.world.snapshotAll().length,
        this.#tick,
      );
      this.telemetry.record(
        'r35.stream.bytes',
        this.streaming.residentBytes(),
        this.#tick,
      );
      this.telemetry.record(
        'r35.market.items',
        this.economy.snapshot().length,
        this.#tick,
      );
    }

    const digest = stableHash({
      tick: this.#tick,
      weather,
      combatEvents,
      interactions,
      stream,
      feature: this.digest(),
    });

    return Object.freeze({
      tick: this.#tick,
      weather,
      combatEvents,
      interactions,
      stream,
      digest,
    });
  }

  health(): FeatureHealthReport {
    const metrics = this.telemetry.metrics(96);
    const base = {
      phase: this.#phase,
      tick: this.#tick,
      entities: this.world.snapshotAll().length,
      activeQuests: this.quests.active().length,
      inventoryWeight: this.inventory.weight(),
      metrics,
      warnings: Object.freeze([
        ...new Set(this.#warnings),
      ]),
      digest: '',
    };

    const reportDigest = stableHash({
      ...base,
      digest: undefined,
    });

    return Object.freeze({
      ...base,
      digest: reportDigest,
      marketItems: this.economy.snapshot().length,
      craftingRecipes: this.crafting.recipesForSkill(
        'unknown',
      ).length,
      navigationNodes: this.navigation.snapshot().length,
      animationActors: this.animation.snapshots().length,
      streamUsage: this.streaming.usageRatio(),
      weatherDigest: this.weatherDigest(),
      featureDigest: this.digest(),
    });
  }

  snapshot(): unknown {
    return Object.freeze({
      tick: this.#tick,
      phase: this.#phase,
      world: this.world.snapshotAll(),
      quests: this.quests.snapshot(),
      inventory: this.inventory.snapshot(),
      weather: this.weather.state(),
      economy: this.economy.snapshot(),
      combatants: this.combat.all(),
      navigation: this.navigation.snapshot(),
      animations: this.animation.snapshots(),
      accessibility: this.accessibility.profile(),
      content: this.content.manifest(),
      streaming: this.streaming.resident(),
      localization: this.localization.snapshot(),
      telemetry: this.telemetry.metrics(96),
      digest: this.digest(),
    });
  }

  digest(): string {
    return stableHash({
      tick: this.#tick,
      phase: this.#phase,
      world: this.world.digest(),
      quests: this.quests.digest(),
      inventory: this.inventory.snapshot(),
      weather: this.weather.digest(),
      economy: this.economy.digest(),
      combat: this.combat.digest(),
      navigation: this.navigation.snapshot(),
      animation: this.animation.graphDigest(),
      content: this.content.manifest(),
      streaming: this.streaming.resident(),
      localization: this.localization.snapshot(),
    });
  }

  weatherDigest(): string {
    return stableHash(this.weather.state());
  }

  reset(): void {
    this.#tick = 0;
    this.#phase = 'active';
    this.#warnings = [];
    this.world.reset();
    this.weather.reset();
    this.economy.reset();
    this.crafting = new CraftingRuntimeR35();
    this.combat.reset();
    this.navigation.reset();
    this.interaction.reset();
    this.streaming.reset();
    this.telemetry.clear();
  }
}
