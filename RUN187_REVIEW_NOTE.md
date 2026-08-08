# Run 187 Concurrency Review

The first Run 187 candidate, `chatgpt/run187-canonical-chunk-shadow-harness`, was created from the same Run 186 main base and its baseline browser smoke passed. Its new integration checker then stopped on a 0.000007629 m Float32 BufferAttribute quantization difference because the checker used an unnecessarily strict 0.000001 m geometry tolerance. That candidate was not published or merged.

During that run, the independently-created `chatgpt/run187-canonical-chunk-integration-shadow` branch appeared from the same base. Per GOVERNANCE concurrency rules, duplicate development stopped. The second candidate was reviewed instead because it uses a Float32-aware geometry tolerance, adds a reusable shadow chunk/collider module rather than only a test-local mutation, and completed the full DoD chain successfully.

Only the fully validated second candidate is eligible for publication. The failed duplicate branch remains unmerged and has no pull request.
