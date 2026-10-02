import {
  DeterministicWorldPartition,
} from './worldPartition';
import {
  SpatialInterestManager,
} from './worldInterest';
import {
  InterestUpdateScheduler,
} from './interestScheduler';
import { WorldSignalBus } from './worldSignalBus';
import {
  DeterministicWorldClock,
} from './worldClock';
import {
  DeterministicWeatherDirector,
  type WeatherSample,
  type WeatherState,
} from './weatherDirector';
import type { InterestEntity } from './contracts';

export interface WorldCoordinatorSnapshot {
  readonly tick: number;
  readonly cellCount: number;
  readonly entityCount: number;
  readonly interestCount: number;
  readonly signals: number;
  readonly day: number;
  readonly weather:
    WeatherState['kind'] | 'clear';
  readonly sunlight: number;
}

export class TypedWorldCoordinator {
  readonly partition =
    new DeterministicWorldPartition();
  readonly interest =
    new SpatialInterestManager();
  readonly interestSchedule =
    new InterestUpdateScheduler();
  readonly signals =
    new WorldSignalBus();
  readonly clock =
    new DeterministicWorldClock();
  readonly weather =
    new DeterministicWeatherDirector();

  #lastWeather: WeatherState | null =
    null;

  addEntity(entity: InterestEntity): boolean {
    if (!this.partition.add(entity)) {
      return false;
    }

    if (!this.interest.upsert(entity)) {
      this.partition.remove(entity);
      return false;
    }

    return true;
  }

  removeEntity(entity: InterestEntity): boolean {
    this.interestSchedule.remove(
      entity.id,
    );

    const state = this.clock.state();
    this.signals.emit({
      id:
        'entity-removed-'
        + entity.id
        + '-'
        + state.day,
      tick: state.day,
      kind: 'environment',
      priority: 10,
      payload: {
        entityId: entity.id,
      },
    });

    return (
      this.interest.remove(entity.id)
      && this.partition.remove(entity)
    );
  }

  observe(
    x: number,
    y: number,
    z: number,
    tick: number,
  ): readonly string[] {
    const decisions =
      this.interest.evaluate(x, y, z);

    this.interestSchedule.schedule(
      decisions,
      tick,
    );

    return this.interestSchedule.due(
      tick,
    );
  }

  advance(minutes: number): void {
    this.clock.advance(minutes);

    const state = this.clock.state();
    this.signals.emit({
      id:
        'world-time-'
        + state.day
        + '-'
        + state.minute,
      tick: state.day,
      kind: 'time',
      priority: 50,
      payload: state,
    });
  }

  evaluateWeather(
    sample: WeatherSample,
    tick: number,
  ): WeatherState {
    const next =
      this.weather.evaluate(sample);
    const previous = this.#lastWeather;
    this.#lastWeather = next;

    const changed =
      previous?.kind !== next.kind
      || Math.abs(
        (previous?.intensity ?? 0)
        - next.intensity,
      ) > 0.1;

    if (changed) {
      this.signals.emit({
        id:
          'weather-'
          + tick
          + '-'
          + next.kind,
        tick,
        kind: 'weather',
        priority: 80,
        payload: next,
      });
    }

    return next;
  }

  query(
    x: number,
    y: number,
    z: number,
    radius: number,
  ): readonly InterestEntity[] {
    return this.interest.query(
      x,
      y,
      z,
      radius,
    );
  }

  consumeSignals(
    tick: number,
    max = 128,
  ) {
    return this.signals.consume(
      tick,
      max,
    );
  }

  snapshot(tick: number):
    WorldCoordinatorSnapshot {
    const state = this.clock.state();

    return Object.freeze({
      tick,
      cellCount: this.partition.size(),
      entityCount: this.interest.size(),
      interestCount:
        this.interestSchedule.size(),
      signals: this.signals.size(),
      day: state.day,
      weather:
        this.#lastWeather?.kind
        ?? 'clear',
      sunlight: state.sunlight,
    });
  }

  clear(): void {
    this.partition.clear();
    this.interest.clear();
    this.interestSchedule.clear();
    this.signals.clear();
    this.clock.set(0, 0);
    this.#lastWeather = null;
  }
}
