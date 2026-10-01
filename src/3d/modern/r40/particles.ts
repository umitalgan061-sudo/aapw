import type { Vec3 } from './types';
import { DeterministicRng, clamp, vec3Add, vec3Scale } from './deterministic';

export interface Particle { readonly id: number; readonly position: Vec3; readonly velocity: Vec3; readonly life: number; readonly age: number; readonly size: number; readonly seed: number; }
export interface ParticleEmitterConfig { readonly maxParticles: number; readonly rate: number; readonly lifetime: number; readonly spread: number; readonly speed: number; readonly gravity: Vec3; }
export interface ParticleFrame { readonly particles: readonly Particle[]; readonly spawned: number; readonly removed: number; readonly digest: string; }

export class DeterministicParticleEmitter {
  readonly config: ParticleEmitterConfig;
  readonly origin: Vec3;
  #rng: DeterministicRng;
  #particles: Particle[] = [];
  #carry = 0;
  #id = 0;
  constructor(seed: string, origin: Vec3, config: Partial<ParticleEmitterConfig> = {}) {
    this.origin = Object.freeze({ ...origin });
    this.config = Object.freeze({ maxParticles: config.maxParticles ?? 2048, rate: config.rate ?? 32, lifetime: config.lifetime ?? 2, spread: config.spread ?? 0.5, speed: config.speed ?? 4, gravity: config.gravity ?? Object.freeze({ x: 0, y: -3, z: 0 }) });
    this.#rng = new DeterministicRng(seed);
  }
  update(dt: number): ParticleFrame {
    const delta = clamp(dt, 0, 0.25);
    this.#carry += this.config.rate * delta;
    const spawn = Math.min(Math.floor(this.#carry), this.config.maxParticles - this.#particles.length);
    this.#carry -= spawn;
    for (let i = 0; i < spawn; i += 1) this.#particles.push(this.spawn());
    let removed = 0;
    const next: Particle[] = [];
    for (const particle of this.#particles) {
      const age = particle.age + delta;
      if (age >= particle.life) { removed += 1; continue; }
      next.push(Object.freeze({ ...particle, age, velocity: vec3Add(particle.velocity, vec3Scale(this.config.gravity, delta)), position: vec3Add(particle.position, vec3Scale(particle.velocity, delta)) }));
    }
    this.#particles = next;
    return Object.freeze({ particles: Object.freeze([...this.#particles]), spawned: spawn, removed, digest: this.digest() });
  }
  #randomDirection(): Vec3 {
    const x = this.#rng.signed(), y = this.#rng.next(), z = this.#rng.signed();
    const length = Math.hypot(x, y, z) || 1;
    return Object.freeze({ x: x / length, y: y / length, z: z / length });
  }
  spawn(): Particle {
    const direction = this.#randomDirection();
    const life = this.config.lifetime * (0.7 + this.#rng.next() * 0.6);
    return Object.freeze({ id: this.#id++, position: this.origin, velocity: vec3Scale(direction, this.config.speed * (0.8 + this.#rng.next() * 0.4)), life, age: 0, size: 0.5 + this.#rng.next() * this.config.spread, seed: this.#rng.nextUint32() });
  }
  digest(): string {
    let value = 2166136261;
    for (const p of this.#particles) value = Math.imul(value ^ p.id ^ Math.trunc(p.age * 1000), 16777619);
    return (value >>> 0).toString(16).padStart(8, '0');
  }
  clear(): void { this.#particles.length = 0; this.#carry = 0; }
}
