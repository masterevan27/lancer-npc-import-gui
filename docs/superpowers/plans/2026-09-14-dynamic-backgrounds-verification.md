# Dynamic backgrounds verification

> **Status, 2026-09-14: merged and pushed.** Both repos' `feature/dynamic-backgrounds`
> fast-forwarded into `main` (generator `3e21670`, GUI `0402281`) and the branch was
> deleted. The notes below are the pre-merge verification record.

Implemented in both existing checkouts on `feature/dynamic-backgrounds`. Existing
NPC tables and local Claude settings were preserved.

- GUI: `node --test --test-concurrency=4 --test-timeout=120000 "test/*.test.js"`
  passed all 963 tests on the final code.
- Generator: `python -m unittest test.test_background_scene test.test_background_animation_table -q`
  passed all 32 tests; new scene suite contains 16 tests.
- Python broad discovery: 1,323 tests, seven failures in existing NPC import
  flag, prompt budget, role-lock and scientist distribution tests. Those exact
  tests failed again in isolation without importing background tests. No changes
  were made to those existing behaviors.
- Real Node-to-Python previews for outdoor/indoor/space batches succeeded;
  replay from saved traits produced identical prompts.
- Local ComfyUI live rendering passed: 768x512 scene, image-reference Qwen map.
  Visual inspection of early maps found excessive perspective. The final prompt
  uses a short image-reference-only floor-plan instruction; the final CLI render
  at 1024x1024 produced an overhead gridless map with source palette/style.
- Source remained intact; output PNGs and metadata were saved separately.
- Browser automation was unavailable. Served HTML/API checks and VM-driven
  browser-handler tests cover controls, locks, dependent edits, request failures,
  selection races and late catalogue responses. Native visual layout inspection
  remains unperformed.
- Independent reviews of GUI and generator changes completed; material findings
  were reproduced in tests and fixed, with scoped re-review.

Logs and live examples are under `G:/GIT-REPOS/.codex-artifacts/`:
`background-gui-tests-final.log`, `background-existing-failures.log`,
`background-generator-report.md`, and `background-live-smoke/`.

Restart the installed GUI server and refresh the browser to load the new routes
and controls. No real GUI configuration or import destinations were changed.
