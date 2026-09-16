import type { WeatherKind, WorldClockState } from './worldSimulation.ts';

export interface WeatherProfile {
  readonly fogDensity: number;
  readonly cloudCoverage: number;
  readonly rainRate: number;
  readonly snowRate: number;
  readonly windMultiplier: number;
  readonly thunderRate: number;
  readonly ambientGain: number;
  readonly visibility: number;
  readonly wetness: number;
}

export interface WeatherPresentationState {
  readonly weather: WeatherKind;
  readonly intensity: number;
  readonly profile: WeatherProfile;
  readonly audio: { readonly rainGain: number; readonly windGain: number; readonly thunderProbability: number };
  readonly lighting: { readonly diffuse: number; readonly specular: number; readonly fog: number };
  readonly particles: { readonly rain: number; readonly snow: number; readonly debris: number };
}

const profiles: Readonly<Record<WeatherKind, WeatherProfile>> = Object.freeze({
  clear: Object.freeze({ fogDensity: 0.005, cloudCoverage: 0.08, rainRate: 0, snowRate: 0, windMultiplier: 0.65, thunderRate: 0, ambientGain: 1, visibility: 1, wetness: 0 }),
  cloudy: Object.freeze({ fogDensity: 0.012, cloudCoverage: 0.55, rainRate: 0, snowRate: 0, windMultiplier: 0.85, thunderRate: 0.001, ambientGain: 0.94, visibility: 0.92, wetness: 0.1 }),
  rain: Object.freeze({ fogDensity: 0.024, cloudCoverage: 0.8, rainRate: 0.75, snowRate: 0, windMultiplier: 1.1, thunderRate: 0.008, ambientGain: 0.84, visibility: 0.72, wetness: 0.72 }),
  storm: Object.freeze({ fogDensity: 0.032, cloudCoverage: 0.98, rainRate: 1, snowRate: 0, windMultiplier: 1.65, thunderRate: 0.04, ambientGain: 0.72, visibility: 0.58, wetness: 0.95 }),
  snow: Object.freeze({ fogDensity: 0.028, cloudCoverage: 0.88, rainRate: 0, snowRate: 0.85, windMultiplier: 1.15, thunderRate: 0, ambientGain: 0.8, visibility: 0.64, wetness: 0.3 }),
  fog: Object.freeze({ fogDensity: 0.085, cloudCoverage: 0.45, rainRate: 0, snowRate: 0, windMultiplier: 0.35, thunderRate: 0, ambientGain: 0.9, visibility: 0.28, wetness: 0.08 }),
});

const clamp01 = (value: number): number => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
const scale = (value: number, intensity: number, base = 0): number => base + (value - base) * intensity;

export const profileForWeather = (weather: WeatherKind): WeatherProfile => profiles[weather];

export const composeWeatherPresentation = (clock: WorldClockState, nightFactor = 0): WeatherPresentationState => {
  const intensity = clamp01(clock.weatherIntensity);
  const profile = profiles[clock.weather];
  const daylight = clamp01((clock.sunElevation + 0.12) / 0.7);
  const night = clamp01(nightFactor || 1 - daylight);
  return Object.freeze({
    weather: clock.weather,
    intensity,
    profile,
    audio: Object.freeze({
      rainGain: scale(profile.rainRate, intensity) * 0.85,
      windGain: profile.windMultiplier * (0.35 + intensity * 0.65),
      thunderProbability: profile.thunderRate * intensity,
    }),
    lighting: Object.freeze({
      diffuse: Math.max(0.08, daylight * profile.ambientGain + night * 0.18),
      specular: Math.max(0.05, daylight * (1 - intensity * 0.5)),
      fog: scale(profile.fogDensity, intensity),
    }),
    particles: Object.freeze({
      rain: Math.floor(profile.rainRate * intensity * 4000),
      snow: Math.floor(profile.snowRate * intensity * 3000),
      debris: Math.floor(profile.windMultiplier * intensity * 220),
    }),
  });
};

export interface WeatherTransition { readonly from: WeatherKind; readonly to: WeatherKind; readonly durationMs: number; readonly elapsedMs: number; }

export class WeatherTransitionController {
  #current: WeatherKind = 'clear';
  #from: WeatherKind = 'clear';
  #elapsedMs = 0;
  #durationMs = 1;
  #transitionCount = 0;

  set(weather: WeatherKind, durationMs = 2500): void {
    if (weather === this.#current && this.#elapsedMs >= this.#durationMs) return;
    this.#from = this.currentWeather();
    this.#current = weather;
    this.#elapsedMs = 0;
    this.#durationMs = Math.max(1, durationMs);
    this.#transitionCount += 1;
  }

  update(deltaMs: number): WeatherTransition {
    this.#elapsedMs = Math.min(this.#durationMs, this.#elapsedMs + Math.max(0, deltaMs));
    return Object.freeze({ from: this.#from, to: this.#current, durationMs: this.#durationMs, elapsedMs: this.#elapsedMs });
  }

  currentWeather(): WeatherKind { return this.#current; }
  factor(): number { return clamp01(this.#elapsedMs / this.#durationMs); }
  transitions(): number { return this.#transitionCount; }

  blendedProfile(): WeatherProfile {
    const a = profiles[this.#from];
    const b = profiles[this.#current];
    const t = this.factor();
    const lerp = (x: number, y: number) => x + (y - x) * t;
    return Object.freeze({
      fogDensity: lerp(a.fogDensity, b.fogDensity),
      cloudCoverage: lerp(a.cloudCoverage, b.cloudCoverage),
      rainRate: lerp(a.rainRate, b.rainRate),
      snowRate: lerp(a.snowRate, b.snowRate),
      windMultiplier: lerp(a.windMultiplier, b.windMultiplier),
      thunderRate: lerp(a.thunderRate, b.thunderRate),
      ambientGain: lerp(a.ambientGain, b.ambientGain),
      visibility: lerp(a.visibility, b.visibility),
      wetness: lerp(a.wetness, b.wetness),
    });
  }
}
