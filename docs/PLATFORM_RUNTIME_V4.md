# Platform Runtime V4

V4 makes browser capability detection an explicit deterministic policy boundary. The browser adapter samples capabilities once; pure policy code maps those signals to a bounded rendering, worker, streaming and accessibility configuration.

The policy prefers WebGPU, preserves WebGL2/headless fallbacks, limits resource pressure from device signals, and respects save-data/reduced-motion preferences without exposing mutable browser globals to gameplay systems.
