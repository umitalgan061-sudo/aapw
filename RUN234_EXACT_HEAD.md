# Run234 Exact-Head Verification Anchor

This additive documentation-only anchor exists to trigger a user-authored GitHub Actions run after the Run234 checkpoint commit produced by `GITHUB_TOKEN`.
Its sole purpose is to ensure the final branch HEAD, including `3D_GAME_PROGRESS.md`, `perf_log.csv`, and `STABLE_TAGS.md` checkpoint additions, passes the complete Run234 validation chain before PR merge.
