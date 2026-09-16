# NextGen Observability

Track frame time, simulation time, render time, streaming pressure, network bytes, memory and active entities as first-class runtime telemetry.

Diagnostics should preserve the build id, device tier, tick, health score and issue codes needed to reproduce a failure. Aggregates are bounded so telemetry cannot become a hidden memory leak.

Use p95 and p99 values for sustained performance investigations. A single slow frame should be visible, but repeated budget violations should drive adaptive workload shedding and recovery instead of silently degrading deterministic simulation.
