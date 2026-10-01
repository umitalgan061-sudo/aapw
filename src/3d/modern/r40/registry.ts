export interface ServiceToken<T> { readonly id: string; readonly type?: T; }
interface Entry { readonly id: string; readonly value: unknown; readonly disposer?: () => void; readonly dependencies: readonly string[]; }

export class TypedServiceRegistry {
  #entries = new Map<string, Entry>();
  provide<T>(token: ServiceToken<T>, value: T, dependencies: readonly string[] = [], disposer?: () => void): boolean {
    if (!token.id || this.#entries.has(token.id) || dependencies.some((dep) => !this.#entries.has(dep))) return false;
    this.#entries.set(token.id, Object.freeze({ id: token.id, value, dependencies: Object.freeze([...dependencies]), disposer }));
    return true;
  }
  replace<T>(token: ServiceToken<T>, value: T, disposer?: () => void): boolean {
    const previous = this.#entries.get(token.id); if (!previous) return false;
    previous.disposer?.(); this.#entries.set(token.id, Object.freeze({ ...previous, value, disposer })); return true;
  }
  get<T>(token: ServiceToken<T>): T | null { return (this.#entries.get(token.id)?.value as T | undefined) ?? null; }
  has(token: ServiceToken<unknown>): boolean { return this.#entries.has(token.id); }
  remove(token: ServiceToken<unknown>): boolean {
    const entry = this.#entries.get(token.id); if (!entry) return false;
    if ([...this.#entries.values()].some((other) => other.dependencies.includes(token.id))) return false;
    entry.disposer?.(); return this.#entries.delete(token.id);
  }
  ids(): readonly string[] { return Object.freeze([...this.#entries.keys()].sort()); }
  clear(): void { for (const entry of this.#entries.values()) entry.disposer?.(); this.#entries.clear(); }
}
