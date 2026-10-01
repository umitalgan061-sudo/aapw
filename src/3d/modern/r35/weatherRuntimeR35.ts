
import { clamp, stableHash, type R35Id, type R35Vec3 } from './contracts';

export type WeatherKind =
  | 'clear'
  | 'cloudy'
  | 'rain'
  | 'storm'
  | 'snow'
  | 'fog'
  | 'heat'
  | 'wind';

export interface WeatherState {
  readonly tick: number;
  readonly day: number;
  readonly hour: number;
  readonly season: 'spring' | 'summer' | 'autumn' | 'winter';
  readonly kind: WeatherKind;
  readonly intensity: number;
  readonly temperature: number;
  readonly humidity: number;
  readonly visibility: number;
  readonly wind: R35Vec3;
  readonly precipitation: number;
  readonly pressure: number;
  readonly revision: number;
}

export interface WeatherZone {
  readonly id: R35Id;
  readonly center: R35Vec3;
  readonly radius: number;
  readonly climate:
    | 'temperate'
    | 'coastal'
    | 'mountain'
    | 'arid'
    | 'tundra';
  readonly priority: number;
}

const KINDS: readonly WeatherKind[] = [
  'clear',
  'cloudy',
  'rain',
  'storm',
  'snow',
  'fog',
  'heat',
  'wind',
];

function seasonFor(day: number): WeatherState['season'] {
  const phase = ((day % 360) + 360) % 360;
  if (phase < 90) return 'spring';
  if (phase < 180) return 'summer';
  if (phase < 270) return 'autumn';
  return 'winter';
}

function baseTemperature(
  season: WeatherState['season'],
  climate: WeatherZone['climate'],
): number {
  const seasonBias = {
    spring: 10,
    summer: 24,
    autumn: 11,
    winter: -1,
  }[season];
  const climateBias = {
    temperate: 0,
    coastal: -2,
    mountain: -8,
    arid: 8,
    tundra: -14,
  }[climate];
  return seasonBias + climateBias;
}

function pickKind(seed: number, season: WeatherState['season']): WeatherKind {
  const value = Math.abs((seed * 1103515245 + 12345) | 0);
  const index = Math.abs(value) % KINDS.length;
  if (season === 'winter' && index === 2) return 'snow';
  if (season === 'summer' && index === 4) return 'heat';
  return KINDS[index]!;
}

export class WeatherRuntimeR35 {
  readonly tickStep = 60;
  #tick = 0;
  #revision = 0;
  #zones = new Map<R35Id, WeatherZone>();
  #state: WeatherState = Object.freeze({
    tick: 0,
    day: 0,
    hour: 0,
    season: 'spring',
    kind: 'clear',
    intensity: 0,
    temperature: 12,
    humidity: 0.45,
    visibility: 1,
    wind: Object.freeze({ x: 0, y: 0, z: 0 }),
    precipitation: 0,
    pressure: 1013,
    revision: 0,
  });

  registerZone(zone: WeatherZone): boolean {
    if (this.#zones.has(zone.id)) return false;
    if (!zone.id || zone.radius <= 0 || zone.priority < 0) return false;
    this.#zones.set(
      zone.id,
      Object.freeze({
        ...zone,
        radius: clamp(zone.radius, 1, 100000),
      }),
    );
    return true;
  }

  removeZone(id: R35Id): boolean {
    return this.#zones.delete(id);
  }

  advance(ticks = 1): WeatherState {
    const count = clamp(Math.trunc(ticks), 1, 3600);
    for (let index = 0; index < count; index += 1) {
      this.#tick += 1;
      if (this.#tick % this.tickStep === 0) {
        this.#recompute();
      }
    }
    return this.#state;
  }

  state(): WeatherState {
    return this.#state;
  }

  sample(position: R35Vec3): WeatherState {
    const zone = this.#nearestZone(position);
    if (!zone) return this.#state;
    const base = this.#state.temperature;
    const temperature = base + (baseTemperature(this.#state.season, zone.climate) - base) * 0.35;
    const humidity = clamp(
      this.#state.humidity
        + (zone.climate === 'coastal' ? 0.18 : 0)
        - (zone.climate === 'arid' ? 0.22 : 0),
      0,
      1,
    );
    return Object.freeze({
      ...this.#state,
      temperature,
      humidity,
    });
  }

  forecast(hours = 24): readonly WeatherState[] {
    const count = clamp(Math.trunc(hours), 1, 168);
    const baseTick = this.#tick;
    const baseState = this.#state;
    const out: WeatherState[] = [];
    for (let hour = 1; hour <= count; hour += 1) {
      const futureDay = baseState.day + Math.floor((baseState.hour + hour) / 24);
      const futureHour = (baseState.hour + hour) % 24;
      const season = seasonFor(futureDay);
      const seed = baseTick + hour * 17;
      const kind = pickKind(seed, season);
      out.push(
        this.#project(futureDay, futureHour, season, kind, seed),
      );
    }
    return Object.freeze(out);
  }

  movementModifier(): {
    readonly speed: number;
    readonly stamina: number;
    readonly perception: number;
  } {
    const intensity = this.#state.intensity;
    if (this.#state.kind === 'storm') {
      return Object.freeze({
        speed: clamp(1 - intensity * 0.28, 0.55, 1),
        stamina: clamp(1 + intensity * 0.22, 1, 1.4),
        perception: clamp(1 - intensity * 0.42, 0.35, 1),
      });
    }
    if (this.#state.kind === 'snow') {
      return Object.freeze({
        speed: clamp(1 - intensity * 0.2, 0.62, 1),
        stamina: clamp(1 + intensity * 0.12, 1, 1.25),
        perception: clamp(1 - intensity * 0.2, 0.55, 1),
      });
    }
    if (this.#state.kind === 'fog') {
      return Object.freeze({
        speed: 0.92,
        stamina: 1,
        perception: clamp(1 - intensity * 0.55, 0.25, 1),
      });
    }
    if (this.#state.kind === 'heat') {
      return Object.freeze({
        speed: 0.96,
        stamina: clamp(1 + intensity * 0.3, 1, 1.45),
        perception: 0.98,
      });
    }
    return Object.freeze({
      speed: 1,
      stamina: 1,
      perception: 1,
    });
  }

  digest(): string {
    return stableHash({
      tick: this.#tick,
      state: this.#state,
      zones: [...this.#zones.values()].sort((a, b) => a.id.localeCompare(b.id)),
    });
  }

  reset(): void {
    this.#tick = 0;
    this.#revision = 0;
    this.#state = Object.freeze({
      tick: 0,
      day: 0,
      hour: 0,
      season: 'spring',
      kind: 'clear',
      intensity: 0,
      temperature: 12,
      humidity: 0.45,
      visibility: 1,
      wind: Object.freeze({ x: 0, y: 0, z: 0 }),
      precipitation: 0,
      pressure: 1013,
      revision: 0,
    });
  }

  #nearestZone(position: R35Vec3): WeatherZone | null {
    let best: WeatherZone | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const zone of this.#zones.values()) {
      const dx = zone.center.x - position.x;
      const dy = zone.center.y - position.y;
      const dz = zone.center.z - position.z;
      const distance = Math.hypot(dx, dy, dz);
      if (distance > zone.radius) continue;
      if (
        distance < bestDistance
        || (distance === bestDistance && (!best || zone.priority > best.priority))
      ) {
        best = zone;
        bestDistance = distance;
      }
    }
    return best;
  }

  #project(
    day: number,
    hour: number,
    season: WeatherState['season'],
    kind: WeatherKind,
    seed: number,
  ): WeatherState {
    const wave = Math.sin(seed * 0.71) * 0.5 + 0.5;
    const intensity = clamp(0.2 + wave * 0.7, 0, 1);
    const temperature =
      baseTemperature(season, 'temperate')
      + Math.sin((hour / 24) * Math.PI * 2) * 5;
    const precipitation =
      kind === 'rain' || kind === 'storm' || kind === 'snow'
        ? intensity
        : 0;
    const visibility =
      kind === 'fog'
        ? clamp(1 - intensity * 0.7, 0.2, 1)
        : kind === 'storm'
          ? clamp(1 - intensity * 0.35, 0.45, 1)
          : 1;
    const wind = Object.freeze({
      x: Math.sin(seed * 0.17) * intensity,
      y: 0,
      z: Math.cos(seed * 0.19) * intensity,
    });
    return Object.freeze({
      tick: this.#tick + seed,
      day,
      hour,
      season,
      kind,
      intensity,
      temperature,
      humidity: clamp(0.35 + precipitation * 0.5, 0, 1),
      visibility,
      wind,
      precipitation,
      pressure: 1013 - intensity * 24,
      revision: this.#revision,
    });
  }

  #recompute(): void {
    const day = Math.floor(this.#tick / (this.tickStep * 24));
    const hour = Math.floor(this.#tick / this.tickStep) % 24;
    const season = seasonFor(day);
    const seed = day * 31 + hour * 7;
    const kind = pickKind(seed, season);
    const projected = this.#project(day, hour, season, kind, seed);
    this.#revision += 1;
    this.#state = Object.freeze({
      ...projected,
      tick: this.#tick,
      revision: this.#revision,
    });
  }
}

export function weatherDigest(state: WeatherState): string {
  return stableHash(state);
}
