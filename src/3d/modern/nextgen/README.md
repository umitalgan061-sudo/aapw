# AAPW NextGen Runtime

This directory contains the second-generation TypeScript runtime boundary.

Goals:
- deterministic fixed-step simulation;
- typed entity/component storage;
- bounded scheduling and resource budgets;
- versioned command/event transport;
- rollback-friendly snapshots;
- predictable input buffering;
- worker-safe message contracts;
- renderer-independent world queries;
- explicit runtime health and observability.

The layer is intentionally dependency-light. Existing JavaScript gameplay/rendering modules remain compatible while ownership moves toward TypeScript.
