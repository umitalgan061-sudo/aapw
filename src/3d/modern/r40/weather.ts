import { clamp, criticallyDamped, hashJson, stableNumber } from './deterministic';

export type WeatherState = 'clear' | 'cloudy' | 'rain' | 'storm' | 'snow' | 'fog';
export interface WeatherSample { readonly state: WeatherState; readonly intensity: number; readonly humidity: number; readonly wind: number; readonly visibility: number; readonly lightning: number; }
export interface WeatherTarget { readonly state: WeatherState; readonly intensity: number; readonly humidity: number; readonly wind: number; readonly visibility: number; }
export interface WeatherFrame { readonly current: WeatherSample; readonly digest: string; }

export class WeatherController {
  #current: WeatherSample = Object.freeze({ state: 'clear', intensity: 0, humidity: 0.35, wind: 0.15, visibility: 1, lightning: 0 });
  #target: WeatherTarget = Object.freeze({ state: 'clear', intensity: 0, humidity: 0.35, wind: 0.15, visibility: 1 });
  #velocity = { intensity: 0, humidity: 0, wind: 0, visibility: 0 };
  setTarget(target: Partial<WeatherTarget>): void {
    this.#target = Object.freeze({ ...this.#target, ...target, intensity: clamp(target.intensity ?? this.#target.intensity, 0, 1), humidity: clamp(target.humidity ?? this.#target.humidity, 0, 1), wind: clamp(target.wind ?? this.#target.wind, 0, 1), visibility: clamp(target.visibility ?? this.#target.visibility, 0, 1) });
  }
  update(dt: number, lightningSeed = 0): WeatherFrame {
    const step = Math.max(0, Math.min(1 / 10, dt));
    const intensity = criticallyDamped(this.#current.intensity, this.#target.intensity, this.#velocity.intensity, step, 1.5);
    const humidity = criticallyDamped(this.#current.humidity, this.#target.humidity, this.#velocity.humidity, step, 1);
    const wind = criticallyDamped(this.#current.wind, this.#target.wind, this.#velocity.wind, step, 0.8);
    const visibility = criticallyDamped(this.#current.visibility, this.#target.visibility, this.#velocity.visibility, step, 1.2);
    this.#velocity = { intensity: intensity.velocity, humidity: humidity.velocity, wind: wind.velocity, visibility: visibility.velocity };
    const lightning = this.#target.state === 'storm' && this.#current.intensity > 0.65 && ((lightningSeed * 1103515245 + 12345) >>> 0) % 240 === 0 ? 1 : 0;
    this.#current = Object.freeze({ state: this.#target.state, intensity: clamp(stableNumber(intensity.value), 0, 1), humidity: clamp(stableNumber(humidity.value), 0, 1), wind: clamp(stableNumber(wind.value), 0, 1), visibility: clamp(stableNumber(visibility.value), 0.05, 1), lightning });
    return Object.freeze({ current: this.#current, digest: hashJson(this.#current) });
  }
  current(): WeatherSample { return this.#current; }
  reset(): void { this.#current = Object.freeze({ state: 'clear', intensity: 0, humidity: 0.35, wind: 0.15, visibility: 1, lightning: 0 }); this.setTarget(this.#current); }
}
