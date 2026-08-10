# Run216 Live World Console RCA

**Date:** 2026-08-10
**Scope:** PR #103 World Editor browser proof and TransformControls lifecycle.

## Root Cause
The canonical live-world browser proof now reaches Chromium and exposes two console-error classes that earlier CI never reached while Actions was blocked: (1) TransformControls remains attached to a selected editor object after that object has been removed from the scene graph during live-world transfer, so Three.js repeatedly reports that the attached object has no parent; (2) the minimal proof HTTP server returns 404 for the browser's automatic `/favicon.ico` request, which the zero-console-errors gate records as a resource error.

## Prevention
TransformControls must defensively detach stale attachments before its matrix-world update when the selected object is no longer parented. The proof server should answer the browser-only favicon probe without masking application resource failures. Neither change weakens the zero-console-error requirement.

## Regression Verification
Require `Run216 Editor Live World` to pass syntax/source checks, launch Chromium, load the canonical editor, produce zero console/page errors, verify terrain/roads/settlements/castles/live-world snapshot, upload visual evidence, and pass final concurrency/additive gates.

## Risk
LOW-MEDIUM. The TransformControls safeguard only acts when an already-attached object has `parent === null`, a state Three.js itself declares invalid. Normal attached scene objects are unchanged. The favicon response applies only to the test proof server.
