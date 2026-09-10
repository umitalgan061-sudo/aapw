# RCA — Run 370 (2026-09-10): git-lfs failure is proxy auth, not the repo rename

## Summary

Every run since Run 344 has logged the missing 3D model bytes (`assets/**/*.glb` etc. are
~130-byte Git LFS pointer text, not real binary) as blocked on an **owner decision about a
GitHub repo rename** (`westeros-pwa` → `aapw`), per `RCA_RUN344_LFS_REPO_RENAME.md` and the
repeated 🔴 entries in `QUESTIONS_FOR_OWNER.md`. This run re-investigated with `GIT_TRACE=1
GIT_CURL_VERBOSE=1 GIT_TRACE_CURL=1` instead of accepting the prior conclusion, because the
prior RCA was inferred from a `git push origin <tag>` 403, not from a captured HTTP response.

**Finding: the rename is not the (or at least not the whole) story, and renaming the repo back
would not fix this on its own.**

- `git remote -v` in this session resolves to `https://github.com/umitalgan061-sudo/westeros-pwa`
  — exactly the name the session was scoped to. No `aapw` redirect was observed anywhere in this
  run's traces.
- `git lfs pull` for a single known object hangs in a **tight retry loop** (115 POSTs to
  `.../info/lfs/objects/batch` in ~40s, no backoff, never exits) instead of failing cleanly.
- Captured verbose output shows the POST request headers **never include an `Authorization`
  header**, and the one captured response is `HTTP/1.1 307 Temporary Redirect` from GitHub — i.e.
  the request reaches GitHub fine (this environment's egress proxy is not blocking or mangling
  it), but it arrives unauthenticated, GitHub redirects it (consistent with an unauthenticated
  LFS batch request), and `git-lfs` just retries the same unauthenticated request forever instead
  of surfacing an error.
- By contrast, plain `git fetch`/`git push` succeed in this same session with no credential setup
  visible in `git config` (`credential.helper` is unset; `git credential fill` itself fails with
  "terminal prompts disabled"). That only works because this remote environment's outbound HTTPS
  proxy (`/root/.ccr/README.md`, `HTTPS_PROXY=http://127.0.0.1:41385`) transparently injects
  GitHub auth for the plain git smart-HTTP protocol (env shows `GH_TOKEN=proxy-injected`,
  `gitConfigInjection: true` in the proxy status endpoint).
- `git-lfs` is a **separate binary making its own HTTP client calls**, not going through git's
  smart-HTTP request path — so it does not receive that transparent credential injection. It has
  no other way to authenticate (no credential helper configured, and the environment's `README.md`
  confirms auth injection is scoped to what the proxy recognizes as git traffic).

## Root cause

This class of remote execution environment's proxy authenticates normal `git` operations to
GitHub but does not extend that to `git-lfs`'s independent HTTP client, so LFS batch/download
requests are always sent unauthenticated and GitHub always redirects them. This is a proxy/tooling
gap in the session environment, not a property of the repository name.

## Why this was mis-attributed for ~26 runs (344→369)

Run 344 observed a `git push origin <tag>` `403` alongside a repo-rename signal and an
already-broken LFS state, and connected the two. Every run after that re-confirmed "LFS still
broken, repo scope still shows old name" without re-running a verbose trace, so the loop kept
re-confirming the *symptom* (pointer files, no real bytes) without re-checking the *mechanism*.
The tag-push 403 may be a real, separate rename/permissions issue (not re-investigated this run —
out of scope) but it is not shown to share a root cause with the LFS pointer problem.

## What this does and doesn't change

- **Does not** mean the repo-rename question is resolved or unimportant — leaving it as its own
  open item in `QUESTIONS_FOR_OWNER.md` (it may still explain the separate tag-push 403).
- **Does** mean a future run should not expect "rename the repo back" (or "point the environment
  at `aapw`") to fix asset loading by itself — the LFS-vs-proxy-auth gap would remain either way,
  because it is not name-dependent.
- No code changed this run. This is a diagnosis-only correction to the RCA record.

## Suggested paths forward (owner decision, not guessed)

1. Ask Anthropic support / the environment owner whether the agent proxy can be extended to
   authenticate `git-lfs`'s HTTP client the same way it does plain git (the proxy's own
   `README.md` explicitly says to report tool gaps like this rather than route around them).
2. Have a human (outside this constrained session) pull the real LFS objects once, on a machine
   with normal GitHub auth, and commit them as regular (non-LFS) blobs if repo size allows, or
   host them externally and fetch over plain HTTPS (which *is* proxy-authenticated / doesn't need
   auth for a public asset host) instead of git-lfs.
3. Provide a personal access token to this session's environment config specifically for
   `git-lfs` (e.g. via `.lfsconfig` `lfs.url` credentials or `GIT_ASKPASS`), if the environment
   supports injecting one safely.

None of these were applied — each is an environment/credentials decision outside a single
session's safe blast radius.

## Risk

LOW / documentation-only. No runtime code touched, no assets touched, no config touched.
