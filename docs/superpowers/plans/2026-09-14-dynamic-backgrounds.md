# Dynamic backgrounds implementation plan

**Goal:** Add reproducible, editable scene generation and reference-based orthographic battlemaps to Create Background.

**Approved design:** Dynamic and Bespoke modes; preview, locks and rerolls; at least 20 unique entries in every new pool; indoor/outdoor/space compatibility; metadata beside images; full-frame composition; separate gridless battlemap add-on and direct top-down generation.

**Architecture:** The Python generator owns tables, compatibility, randomization and prompts. Node passes JSON through stdin and owns GUI jobs and path validation. Images remain folder-backed; `<image stem>.background.json` carries generation metadata, and `<stem> Battlemap.png` is a separate derivative.

**Constraints:** Preserve existing NPC table edits and bespoke/animation behavior. Use existing Python stdlib/Node/browser patterns. No new runtime dependencies. Existing Qwen image-edit models serve the battlemap workflow. Do not automatically publish, import, or overwrite source images.

## Task 1: Generator (delegated)
- [x] Add `generate-background.py`, `background_scene.py`, `prompts/background-generator-tables.md`, generator tests and documentation.
- [x] Test pool minimums, enabled weights, context compatibility, deterministic rolls, locking, batch diversity, validation, prompts, sidecar and battlemap graphs before implementing.
- [x] CLI: `--catalogue --tables PATH` returns `{environments:["outdoor","indoor","space"],tables:[{name,values:[{text,environments,weight}]}]}`.
- [x] CLI: `--preview --request-stdin --tables PATH` reads `{environment,seed,count,traits,locked,reroll,view,notes,width,height}`; returns `{plans:[{version:1,environment,seed,traits,prompt,motionPrompt,view,notes,width,height}]}`. Traits are raw bullet text (including flags). First scene preserves supplied traits unless reroll=true, which preserves locked traits only; later scenes preserve locked traits only. Optional fields receive defaults. Empty trait text omits an applicable feature. Reject unknown fields/invalid traits/locks and incompatible pinned traits; omit inapplicable pools.
- [x] CLI: `--render --request-stdin --tables PATH --output-dir PATH` consumes `{plans:[...]}` from preview and renders exact prompts, validating plans; stdout emits `BACKGROUND_RESULT {"path":"absolute image path"}` per completed image.
- [x] CLI: `--battlemap IMAGE --width N --height N --seed N --notes TEXT --output-dir PATH` edits image via Qwen with top-down gridless prompt. Save separate uniquely named image and metadata (kind=battlemap, source path/mtime), same result event.
- [x] Saved metadata uses plan fields plus kind=background, or kind=battlemap for map outputs. Save atomically as `<stem>.background.json`; preserve source and avoid collisions.
- [x] Remove chat-center reservation instructions in bespoke catalogues without removing intentional physical empty spaces.

## Task 2: GUI service and controls (local)
- [x] Add derived generator/table/preset paths and a tables-only background registry entry.
- [x] Add `lib/dynamicBackgrounds.js` for subprocess protocol, request bounds, metadata access and output verification.
- [x] Add catalogue/preview/render/battlemap endpoints; exact produced files belong to each job; provide actionable subprocess errors and per-source battlemap conflict guards.
- [x] Extend Create Background with mode, environment, view, count, locks, per-trait edits/rerolls, prompt preview, layout notes, batch rendering and saved scene loading.
- [x] Add battlemap controls beside animation; dimension controls, source-based generation, status/log/output link. Keep derivatives out of ordinary still gallery and include them in source deletion.
- [x] Extend Tables selector and documentation/config example. Preserve existing routes and tests.

## Task 3: Review and verification
- [x] Run focused Python and Node suites and broad regression suites; smoke-test real Python CLI through Node.
- [x] Inspect served GUI and review workflow structures without requiring GPU renders; render if an available ComfyUI runtime permits it.
- [x] Independent review, fix material findings, report tested results and any rendering limitations.

## Decisions / progress
- Work on feature branches in the existing paired checkouts so the installed GUI continues to use its configured generator path; preserve unrelated working changes.
- The approved design authorizes implementation; proceed through tasks without additional design or execution-choice pauses.
- Completed; see `2026-09-14-dynamic-backgrounds-verification.md` for test results, live rendering evidence and remaining preexisting test failures.
