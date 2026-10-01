
import { fail, ok, type R35Result } from './contracts';

export type LocaleCode = 'tr-TR' | 'en-US' | 'de-DE' | 'fr-FR';

export interface LocalePack {
  readonly locale: LocaleCode;
  readonly revision: number;
  readonly entries: Readonly<Record<string, string>>;
  readonly plurals: Readonly<Record<string, { one: string; other: string }>>;
}

export interface TranslationRequest {
  readonly key: string;
  readonly count?: number;
  readonly args?: Readonly<Record<string, string | number>>;
}

export interface LocaleCoverage {
  readonly locale: LocaleCode;
  readonly total: number;
  readonly translated: number;
  readonly missing: readonly string[];
  readonly ratio: number;
}

export class LocalizationRuntimeR35 {
  #packs = new Map<LocaleCode, LocalePack>();
  #fallback: LocaleCode = 'en-US';
  #active: LocaleCode = 'tr-TR';
  #revision = 0;

  register(pack: LocalePack): R35Result<LocalePack> {
    if (
      pack.revision < 1
      || Object.keys(pack.entries).length > 50000
      || Object.keys(pack.plurals).length > 50000
    ) {
      return fail(
        'LOCALE_INVALID',
        'Locale pack exceeds the localization safety limits',
      );
    }

    for (const key of Object.keys(pack.entries)) {
      if (!key || key.length > 256) {
        return fail(
          'LOCALE_KEY',
          'Localization key is invalid',
        );
      }
    }

    this.#packs.set(
      pack.locale,
      Object.freeze({
        ...pack,
        entries: Object.freeze({ ...pack.entries }),
        plurals: Object.freeze({ ...pack.plurals }),
      }),
    );

    if (this.#packs.size === 1) {
      this.#active = pack.locale;
      this.#fallback = pack.locale;
    }

    this.#revision += 1;
    return ok(pack);
  }

  setActive(locale: LocaleCode): boolean {
    if (!this.#packs.has(locale)) return false;
    this.#active = locale;
    return true;
  }

  setFallback(locale: LocaleCode): boolean {
    if (!this.#packs.has(locale)) return false;
    this.#fallback = locale;
    return true;
  }

  active(): LocaleCode {
    return this.#active;
  }

  fallback(): LocaleCode {
    return this.#fallback;
  }

  translate(request: TranslationRequest): string {
    const count = request.count;
    const active = this.#packs.get(this.#active);
    const fallback = this.#packs.get(this.#fallback);

    const template =
      this.#plural(active, request.key, count)
      ?? active?.entries[request.key]
      ?? this.#plural(fallback, request.key, count)
      ?? fallback?.entries[request.key]
      ?? request.key;

    return this.#format(
      template,
      request.args ?? {},
    );
  }

  coverage(
    keys: readonly string[],
    locale = this.#active,
  ): LocaleCoverage {
    const pack = this.#packs.get(locale);

    const missing = keys.filter(
      (key) =>
        !pack?.entries[key]
        && !pack?.plurals[key],
    );

    const translated =
      keys.length - missing.length;

    return Object.freeze({
      locale,
      total: keys.length,
      translated,
      missing: Object.freeze(missing),
      ratio:
        keys.length === 0
          ? 1
          : translated / keys.length,
    });
  }

  missing(
    keys: readonly string[],
    locale = this.#active,
  ): readonly string[] {
    return this.coverage(keys, locale).missing;
  }

  batch(
    requests: readonly TranslationRequest[],
  ): readonly string[] {
    const limited = requests.length > 4096
      ? requests.slice(0, 4096)
      : requests;

    return Object.freeze(
      limited.map((request) =>
        this.translate(request),
      ),
    );
  }

  snapshot(): {
    readonly active: LocaleCode;
    readonly fallback: LocaleCode;
    readonly revision: number;
    readonly locales: readonly LocaleCode[];
  } {
    return Object.freeze({
      active: this.#active,
      fallback: this.#fallback,
      revision: this.#revision,
      locales: Object.freeze(
        [...this.#packs.keys()].sort(),
      ),
    });
  }

  #plural(
    pack: LocalePack | undefined,
    key: string,
    count: number | undefined,
  ): string | null {
    const entry = pack?.plurals[key];

    if (!entry || count === undefined) {
      return null;
    }

    return count === 1
      ? entry.one
      : entry.other;
  }

  #format(
    template: string,
    args: Readonly<Record<string, string | number>>,
  ): string {
    return template.replace(
      /{([a-zA-Z0-9_.-]+)}/g,
      (_, key: string) => {
        const value = args[key];

        if (value === undefined) {
          return '{' + key + '}';
        }

        return String(value);
      },
    );
  }
}
