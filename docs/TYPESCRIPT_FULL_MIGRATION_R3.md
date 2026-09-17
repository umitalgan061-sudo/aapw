# TypeScript Full Migration R3

## Objective

AAPW is moving toward a TypeScript-first runtime with a strict, typed ownership boundary. This document records the R3 migration rules for the remaining legacy JavaScript surface.

## Policy

1. New production runtime code is TypeScript.
2. New tests are TypeScript.
3. JavaScript remains only where an existing browser contract or generated/tooling surface has not yet been migrated.
4. Every migrated subsystem gets a typed facade before legacy removal.
5. Deterministic simulation code must not use ambient wall-clock or ambient randomness.
6. Runtime boundaries validate external data before it reaches simulation state.
7. Rendering, persistence, networking, and worker protocols use explicit schemas and discriminated unions.
8. Deletions of legacy JavaScript happen only after the equivalent TypeScript path is exercised by integration tests.

## R3 focus

- typed application composition root
- typed browser lifecycle
- typed input/action protocol
- typed asset and resource lifecycle
- typed worker messages
- typed UI/gameplay event contracts
- typed persistence envelopes
- typed migration accounting
- CI gates that measure remaining JavaScript instead of silently accepting drift

## Completion condition

A subsystem is considered migrated only when the production import path resolves to TypeScript, tests cover the public contract, the legacy implementation is no longer imported by production code, and a migration ledger records the transition.
