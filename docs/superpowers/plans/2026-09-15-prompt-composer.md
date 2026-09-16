# Secret NPC Prompt Composer

Goal: Show live, source-labeled prompt fragments on Secret Create NPC; let users reorder them independently for portrait and token and preserve the order in presets and generated records.

Design: The Python generator exposes structured fragments from its existing templates. The protected GUI preview invokes that read-only path with current form choices. The browser displays random placeholders for unfixed sources and stores stable fragment IDs rather than sampled text. Generation applies the same layout after rolling. Existing prompts retain their wording when no layout is supplied. Conditional fragments still follow existing roll rules. Names, callsigns and theme remain metadata and roll inputs.

Implementation sequence:
- [x] Add generator fragment construction, layout validation, preview CLI and manifest restoration; test exact default prompt parity, reordering and target filtering.
- [x] Add authenticated preview route and validate layout on creation and preset save/load; test privacy and subprocess arguments.
- [x] Add live composer UI with source colors, drag/drop, keyboard controls, reset, custom text, and preset integration; test state reconciliation and stale responses.
- [x] Document behavior, increment GUI version to 1.1.0, run both project suites and verify DOM behavior. Live visual inspection was unavailable: no browser is connected in this session.

Constraints: Node standard library and Python standard library only. Preserve existing uncommitted work. Keep all previews behind Secret authentication, without rendering or writing generation records.

Validation:
- GUI: `node --test --test-concurrency=4 --test-timeout=120000 "test/*.test.js"` — 1,043 passed.
- Generator: `python -m unittest test.test_prompt_composer test.test_extra_tables test.test_art_styles test.test_set_trait_value` — 124 passed. Final composer-only run: 8 passed.
- Real Python generator through the authenticated HTTP preview and generation dry-run routes: passed with fixed/default/secret traits, disabled Height, reordered snippets and literal custom text; zero images or records written.
- Full generator suite exposed an empty-layout compatibility regression, fixed and verified in the trait-edit tests above. Seven other failures were reproduced against the committed generator: two missing `lab` flag documentation checks, token prompt p99 length, an outdated scientist role lock, and three scientist roll-distribution checks.
- Independent review found and verified fixes for fixed-prose ID stability and style substitutions within table fragments.
