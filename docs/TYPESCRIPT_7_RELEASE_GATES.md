# Typed Runtime Release Gates

Before promoting a TypeScript runtime subsystem, verify the following gates.

- strict TypeScript 7 compilation completes without weakening compiler options;
- the public boundary exports readonly contracts and explicit error states;
- legacy JavaScript inputs are normalized through an adapter;
- deterministic ordering is documented for scheduling, indexing and replay;
- GPU selection retains WebGL2 fallback when WebGPU is unavailable;
- asset and worker queues have explicit concurrency and memory limits;
- save envelopes carry semantic versions and integrity checksums;
- runtime recovery has a bounded decision path;
- telemetry buffers and labels are bounded and sanitized;
- focused regression cases cover invalid input as well as valid paths;
- generated migration coverage remains deterministic;
- the pull request is based on the latest available `main` before merge;
- the final merge preserves existing runtime entrypoints unless a migration gate explicitly approves the change.
