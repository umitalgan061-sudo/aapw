# Typed Boundary Rules

New runtime code enters the typed foundation through explicit contracts.

1. External browser APIs are treated as untrusted input and normalized.
2. Legacy JavaScript values enter through adapters and are validated before use.
3. IDs are branded so world, entity, asset and tick values are not interchangeable.
4. Runtime state is immutable outside transaction boundaries.
5. Schedulers sort by deterministic keys before execution.
6. Worker work supports cancellation and bounded queues.
7. Asset streaming is controlled by byte and concurrency budgets.
8. Renderer selection keeps WebGPU optional and WebGL2 available as fallback.
9. Save data has semantic versions and checksums.
10. Recovery uses explicit error codes and integrity observations.
11. Telemetry buffers are bounded and tags are sanitized.
12. New contracts should be readonly by default.
13. `unknown` is preferred to `any` at integration seams.
14. A migration can remain JavaScript-backed while its public contract is TypeScript.
15. Runtime behavior is not changed solely to satisfy the type system.
16. Deterministic replay is preferred over wall-clock-dependent simulation.
17. Quality degradation should shed optional work before protected gameplay work.
18. Memory pressure should trigger explicit residency decisions rather than arbitrary cache clears.
19. Rendering metrics remain separate from gameplay correctness.
20. Type-check failures block promotion of a converted runtime boundary.
