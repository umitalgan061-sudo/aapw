# Worker Rendering Readiness

The runtime may eventually move GPU command encoding or expensive scene preparation into a worker. OffscreenCanvas is broadly available, while WebGPU itself remains less uniformly supported; therefore the worker path is capability-gated and must preserve a WebGL fallback.

No worker is spawned by this contract alone. The current stage records the capability boundary so later renderer adoption can be incremental without coupling gameplay systems to browser threading details.
