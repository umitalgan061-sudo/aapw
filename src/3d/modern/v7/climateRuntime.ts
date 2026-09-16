import { clamp, digest, integer, stableSort, type Disposable } from './primitives.js';

export type WeatherType = 'clear' | 'cloudy' | 'rain' | 'storm' | 'snow' | 'fog';
export interface ClimateState { readonly tick: number; readonly weather: WeatherType; readonly intensity: number; readonly temperatureC: number; readonly humidity01: number; readonly wind: { readonly x: number; readonly y: number; readonly z: number }; readonly visibility01: number; readonly precipitation01: number; readonly wetness01: number; readonly daylight01: number; readonly revision: number; }
export interface ClimateParameters { readonly latitude01: number; readonly season01: number; readonly altitudeM: number; readonly stormBias01: number; readonly snowLineM: number; }
export interface ClimateEvent { readonly type: 'weather-change' | 'day-phase' | 'storm-warning'; readonly tick: number; readonly from: string; readonly to: string; readonly intensity: number; }
export interface ClimateStats { readonly ticks: number; readonly weatherChanges: number; readonly storms: number; readonly averageTemperature: number; readonly averageVisibility: number; }

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * clamp(t, 0, 1);
}

export class DeterministicClimateRuntime implements Disposable {
  readonly parameters: ClimateParameters;
  readonly dayTicks: number;
  #state: ClimateState;
  #events: ClimateEvent[] = [];
  #ticks = 0;
  #weatherChanges = 0;
  #storms = 0;
  #temperatureSum = 0;
  #visibilitySum = 0;
  #disposed = false;

  constructor(parameters: Partial<ClimateParameters> = {}, dayTicks = 86_400) {
    this.parameters = Object.freeze({
      latitude01: clamp(parameters.latitude01 ?? .5, 0, 1),
      season01: clamp(parameters.season01 ?? .5, 0, 1),
      altitudeM: clamp(parameters.altitudeM ?? 0, -500, 9000),
      stormBias01: clamp(parameters.stormBias01 ?? .2, 0, 1),
      snowLineM: clamp(parameters.snowLineM ?? 1800, 200, 6000),
    });
    this.dayTicks = Math.max(3600, integer(dayTicks));
    this.#state = Object.freeze(this.#compute(0));
  }

  tick(tick: number): ClimateState {
    if (this.#disposed) return this.#state;
    const normalized = Math.max(this.#state.tick, integer(tick));
    const previous = this.#state;
    const next = Object.freeze(this.#compute(normalized));
    this.#state = next;
    this.#ticks += 1;
    this.#temperatureSum += next.temperatureC;
    this.#visibilitySum += next.visibility01;
    if (next.weather !== previous.weather) {
      this.#weatherChanges += 1;
      this.#events.push(Object.freeze({ type: 'weather-change', tick: normalized, from: previous.weather, to: next.weather, intensity: next.intensity }));
    }
    if (next.weather === 'storm' && previous.weather !== 'storm') {
      this.#storms += 1;
      this.#events.push(Object.freeze({ type: 'storm-warning', tick: normalized, from: previous.weather, to: next.weather, intensity: next.intensity }));
    }
    if (this.#events.length > 512) this.#events.shift();
    return next;
  }

  state(): ClimateState {
    return this.#state;
  }

  events(): readonly ClimateEvent[] {
    return Object.freeze([...this.#events]);
  }

  sampleWeather(tick: number, weather: WeatherType): ClimateState {
    if (this.#disposed) return this.#state;
    const previous = this.#state;
    const base = this.#compute(Math.max(this.#state.tick, integer(tick)));
    const intensity = clamp(base.intensity + (weather === 'storm' ? .25 : weather === 'clear' ? -.15 : 0), 0, 1);
    const visibility01 = weather === 'fog' ? lerp(base.visibility01, .28, intensity) : weather === 'storm' ? lerp(base.visibility01, .45, intensity) : base.visibility01;
    this.#state = Object.freeze({ ...base, weather, intensity, visibility01, precipitation01: ['rain', 'storm', 'snow'].includes(weather) ? intensity : 0, wetness01: ['rain', 'storm'].includes(weather) ? clamp(base.wetness01 + intensity * .1, 0, 1) : clamp(base.wetness01 - .02, 0, 1), revision: base.revision + 1 });
    if (weather !== previous.weather) this.#events.push(Object.freeze({ type: 'weather-change', tick: this.#state.tick, from: previous.weather, to: weather, intensity }));
    return this.#state;
  }

  stats(): ClimateStats {
    return Object.freeze({
      ticks: this.#ticks,
      weatherChanges: this.#weatherChanges,
      storms: this.#storms,
      averageTemperature: this.#ticks ? this.#temperatureSum / this.#ticks : this.#state.temperatureC,
      averageVisibility: this.#ticks ? this.#visibilitySum / this.#ticks : this.#state.visibility01,
    });
  }

  digest(): string {
    return digest(this.#state, this.#events.slice(-64));
  }

  dispose(): void {
    this.#disposed = true;
    this.#events.length = 0;
  }

  #compute(tick: number): Omit<ClimateState, 'revision'> & { readonly revision: number } {
    const dayPhase = (tick % this.dayTicks) / this.dayTicks;
    const seasonal = Math.sin(this.parameters.season01 * Math.PI * 2 - Math.PI / 2);
    const latitude = Math.abs(this.parameters.latitude01 * 2 - 1);
    const altitudePenalty = this.parameters.altitudeM / 2000;
    const temperatureC = clamp(22 - seasonal * 18 - latitude * 16 - altitudePenalty * 6, -35, 42);
    const stormWave = (Math.sin(tick / 930 + this.parameters.stormBias01 * 7) + 1) / 2;
    const humidity01 = clamp(.52 + seasonal * .12 + stormWave * .22, 0, 1);
    const snowEligible = temperatureC < 1 && this.parameters.altitudeM >= this.parameters.snowLineM * .35;
    const stormEligible = humidity01 > .68 && stormWave > .68;
    const rainEligible = humidity01 > .58;
    const fogEligible = humidity01 > .72 && Math.abs(Math.sin(tick / 420)) > .72;
    let weather: WeatherType = 'clear';
    if (snowEligible && stormEligible) weather = 'snow';
    else if (stormEligible) weather = 'storm';
    else if (snowEligible && rainEligible) weather = 'snow';
    else if (rainEligible) weather = 'rain';
    else if (fogEligible) weather = 'fog';
    else if (humidity01 > .45) weather = 'cloudy';
    const intensity = clamp((humidity01 - .35) / .6 + stormWave * .15, 0, 1);
    const daylight01 = clamp(Math.sin(dayPhase * Math.PI * 2 - Math.PI / 2) * .5 + .5, 0, 1);
    const visibility01 = clamp(weather === 'fog' ? .35 : weather === 'storm' ? .52 : weather === 'rain' ? .7 : weather === 'snow' ? .62 : .86 + daylight01 * .14, .05, 1);
    const windAngle = tick / 700;
    const windSpeed = weather === 'storm' ? 18 * intensity : weather === 'rain' ? 8 * intensity : 4 * intensity;
    const wind = Object.freeze({ x: Math.cos(windAngle) * windSpeed, y: weather === 'storm' ? Math.sin(windAngle * .7) * 2 : 0, z: Math.sin(windAngle) * windSpeed });
    const precipitation01 = ['rain', 'storm', 'snow'].includes(weather) ? intensity : 0;
    const wetness01 = clamp(precipitation01 * .8 + humidity01 * .2, 0, 1);
    return { tick, weather, intensity, temperatureC, humidity01, wind, visibility01, precipitation01, wetness01, daylight01, revision: this.#state.revision + 1 };
  }
}

export function sortClimateEvents(events: readonly ClimateEvent[]): readonly ClimateEvent[] {
  return Object.freeze(stableSort(events, (a, b) => a.tick - b.tick || a.type.localeCompare(b.type)));
}
