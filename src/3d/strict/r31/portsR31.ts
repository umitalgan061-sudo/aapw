import type { NetworkPortR31, PersistencePortR31, RenderPortR31 } from './applicationTypesR31.ts';

export interface PortRegistryDiagnosticsR31 {
  readonly renderPorts: number;
  readonly networkPorts: number;
  readonly persistencePorts: number;
  readonly namedPorts: number;
}

export class PortRegistryR31 {
  readonly #render = new Map<string, RenderPortR31>();
  readonly #network = new Map<string, NetworkPortR31>();
  readonly #persistence = new Map<string, PersistencePortR31>();

  registerRender(name: string, port: RenderPortR31): () => void {
    return this.#register(this.#render, name, port);
  }

  registerNetwork(name: string, port: NetworkPortR31): () => void {
    return this.#register(this.#network, name, port);
  }

  registerPersistence(name: string, port: PersistencePortR31): () => void {
    return this.#register(this.#persistence, name, port);
  }

  render(name: string): RenderPortR31 | null { return this.#render.get(name) ?? null; }
  network(name: string): NetworkPortR31 | null { return this.#network.get(name) ?? null; }
  persistence(name: string): PersistencePortR31 | null { return this.#persistence.get(name) ?? null; }

  requireRender(name: string): RenderPortR31 {
    const port = this.render(name);
    if (!port) throw new Error(`Missing render port: ${name}`);
    return port;
  }

  requireNetwork(name: string): NetworkPortR31 {
    const port = this.network(name);
    if (!port) throw new Error(`Missing network port: ${name}`);
    return port;
  }

  requirePersistence(name: string): PersistencePortR31 {
    const port = this.persistence(name);
    if (!port) throw new Error(`Missing persistence port: ${name}`);
    return port;
  }

  diagnostics(): PortRegistryDiagnosticsR31 {
    return Object.freeze({
      renderPorts: this.#render.size,
      networkPorts: this.#network.size,
      persistencePorts: this.#persistence.size,
      namedPorts: this.#render.size + this.#network.size + this.#persistence.size,
    });
  }

  clear(): void {
    this.#render.clear();
    this.#network.clear();
    this.#persistence.clear();
  }

  #register<T>(map: Map<string, T>, name: string, port: T): () => void {
    const key = name.trim();
    if (!key) throw new Error('Port name cannot be empty');
    if (map.has(key)) throw new Error(`Duplicate port: ${key}`);
    map.set(key, port);
    return () => map.delete(key);
  }
}
