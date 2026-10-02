export interface EntityHandle {
  readonly id: string;
  readonly generation: number;
}
interface EntityRecord<T> {
  readonly handle: EntityHandle;
  value: T;
}
export class GenerationEntityRegistry<T> {
  readonly maxEntities: number;
  #nextGeneration = 1;
  #records = new Map<string, EntityRecord<T>>();

  constructor(maxEntities = 50000) {
    this.maxEntities = Math.max(
      64,
      Math.trunc(maxEntities),
    );
  }

  spawn(
    id: string,
    value: T,
  ): EntityHandle | null {
    if (
      !id.trim()
      || this.#records.has(id)
      || this.#records.size >= this.maxEntities
    ) {
      return null;
    }
    const handle = Object.freeze({
      id,
      generation: this.#nextGeneration++,
    });
    this.#records.set(id, {
      handle,
      value,
    });
    return handle;
  }

  get(handle: EntityHandle): T | null {
    const record =
      this.#records.get(handle.id);
    return record
      && record.handle.generation
        === handle.generation
      ? record.value
      : null;
  }

  set(
    handle: EntityHandle,
    value: T,
  ): boolean {
    const record =
      this.#records.get(handle.id);
    if (
      !record
      || record.handle.generation
        !== handle.generation
    ) {
      return false;
    }
    record.value = value;
    return true;
  }

  despawn(
    handle: EntityHandle,
  ): boolean {
    const record =
      this.#records.get(handle.id);
    if (
      !record
      || record.handle.generation
        !== handle.generation
    ) {
      return false;
    }
    return this.#records.delete(
      handle.id,
    );
  }

  ids(): readonly string[] {
    return Object.freeze([
      ...this.#records.keys(),
    ].sort());
  }

  handles(): readonly EntityHandle[] {
    return Object.freeze(
      [...this.#records.values()]
        .map(record => record.handle)
        .sort(
          (a, b) =>
            a.id.localeCompare(b.id),
        ),
    );
  }

  size(): number {
    return this.#records.size;
  }

  clear(): void {
    this.#records.clear();
  }
}
