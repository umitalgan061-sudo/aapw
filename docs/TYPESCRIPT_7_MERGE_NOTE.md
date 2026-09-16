# Merge Readiness

This foundation intentionally adds contracts before replacing legacy runtime implementations. It is deletion-free, preserves the WebGPU/WebGL2 fallback, and keeps persistence and recovery explicit.

The current pull request is the integration boundary for the TypeScript 7 foundation and its regression harnesses.

Future implementation migrations should consume these contracts instead of widening the legacy JavaScript surface.
