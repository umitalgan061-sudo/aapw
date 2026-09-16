# Modern Runtime V3

This directory contains the next-generation TypeScript runtime layer for AAPW.

Design goals:

- deterministic simulation and replay
- typed entity/component storage with deferred mutation
- bounded AI scheduling and explicit state machines
- collision-safe movement helpers without a third-party physics dependency
- render frame planning, visibility and level-of-detail decisions
- snapshot interpolation and transport-independent network state
- versioned persistence with migrations and corruption-safe validation
- first-class budgets, metrics and runtime health signals

The V3 layer is deliberately dependency-light. It is safe to integrate incrementally with the
existing Three.js/legacy presentation surface through the public runtime adapter.
