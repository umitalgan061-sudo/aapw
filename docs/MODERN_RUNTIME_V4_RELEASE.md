# v4 Release Operations

The v4 runtime is designed around bounded work, deterministic ordering and explicit TypeScript contracts. Release validation should include the v4 Vitest suite, the deterministic platform guard, strict type checking, the modern build and a browser smoke test through `RuntimeV4Facade`.

Performance policy: sustained pressure may downgrade presentation quality, while fixed-step simulation remains authoritative. Network reliable queues take precedence over telemetry and asset queues are priority ordered with bounded concurrency.

Migration policy: legacy integrations remain behind the v4 facade until parity evidence is recorded. A surface without a successful parity sample must not be promoted.
