import type { Vec3, WorldSeed } from './types';
import { clamp01, hash32, sample01 } from './deterministic';

export type WeatherKind = 'clear' | 'cloudy' | 'rain' | 'storm' | 'snow' | 'fog';

export interface WorldClockState {
  readonly day: number;
  readonly daySeconds: number;
  readonly normalizedDay: number;
  readonly sunElevation: number;
  readonly moonElevation: number;
  readonly weather: WeatherKind;
  readonly weatherIntensity: number;
}

export interface WorldClockOptions {
  readonly secondsPerDay?: number;
  readonly startDay?: number;
  readonly seed?: WorldSeed | number;
}

/** Deterministic day/night + weather state generator shared by gameplay and presentation layers. */
export class WorldClock {
  readonly secondsPerDay: number;
  readonly seed: WorldSeed | number;
  #day: number;
  #daySeconds: number;
  #weather: WeatherKind = 'clear';
  #weatherIntensity = 0;

  constructor(options: WorldClockOptions = {}) {
    this.secondsPerDay = Math.max(60, options.secondsPerDay ?? 1_200);
    this.#day = Math.max(0, Math.floor(options.startDay ?? 1));
    this.#daySeconds = 0;
    this.seed = options.seed ?? 0x57455354;
  }

  update(deltaSeconds: number): WorldClockState {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) throw new RangeError('deltaSeconds must be non-negative');
    this.#daySeconds += Math.min(deltaSeconds, 30);
    while (this.#daySeconds >= this.secondsPerDay) {
      this.#daySeconds -= this.secondsPerDay;
      this.#day += 1;
    }
    this.#updateWeather();
    return this.state();
  }

  state(): WorldClockState {
    const normalizedDay = this.#daySeconds / this.secondsPerDay;
    const phase = normalizedDay * Math.PI * 2 - Math.PI / 2;
    const sunElevation = Math.sin(phase);
    const moonElevation = Math.sin(phase + Math.PI);
    return { day: this.#day, daySeconds: this.#daySeconds, normalizedDay, sunElevation, moonElevation, weather: this.#weather, weatherIntensity: this.#weatherIntensity };
  }

  setTime(day: number, daySeconds: number): void {
    if (!Number.isSafeInteger(day) || day < 0 || !Number.isFinite(daySeconds) || daySeconds < 0) throw new RangeError('invalid world time');
    this.#day = day;
    this.#daySeconds = daySeconds % this.secondsPerDay;
  }

  #updateWeather(): void {
    const cycle = Math.floor((this.#daySeconds + this.#day * this.secondsPerDay) / 90);
    const weatherRoll = sample01(this.seed, cycle);
    const seasonal = (this.#day % 120) / 120;
    const coldBias = seasonal < 0.25 || seasonal > 0.82 ? 0.35 : 0;
    const next: WeatherKind = weatherRoll < 0.08 + coldBias ? 'snow'
      : weatherRoll < 0.16 ? 'storm'
        : weatherRoll < 0.33 ? 'rain'
          : weatherRoll < 0.48 ? 'cloudy'
            : weatherRoll < 0.55 ? 'fog' : 'clear';
    this.#weather = next;
    const intensitySeed = sample01(this.seed, hash32(`${cycle}:${next}`));
    const target = next === 'clear' ? 0 : clamp01(0.25 + intensitySeed * 0.75);
    this.#weatherIntensity += (target - this.#weatherIntensity) * 0.08;
  }
}

export interface WindField {
  readonly sample: (position: Vec3, timeSeconds: number) => Vec3;
}

/** Stable low-cost wind field for vegetation, cloth and ambient effects. */
export function createWindField(seed: WorldSeed | number, scale = 0.012): WindField {
  return {
    sample(position, timeSeconds) {
      const x = Math.sin(position.z * scale + timeSeconds * 0.35 + hash32(seed) * 0.0001);
      const z = Math.cos(position.x * scale - timeSeconds * 0.27 + hash32(seed + 7) * 0.0001);
      const gust = 0.5 + 0.5 * Math.sin((position.x + position.z) * scale * 0.35 + timeSeconds * 0.11);
      return { x: x * (0.3 + gust * 0.7), y: 0, z: z * (0.3 + gust * 0.7) };
    },
  };
}
