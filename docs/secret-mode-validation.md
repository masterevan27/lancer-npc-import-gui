# Secret mode validation

Validation performed September 14–15, 2026, using synthetic manifests, private
folders, credentials, and generator subprocesses. Live configuration was not edited
and no real ComfyUI image generation was requested.

## Passing checks

- Final generator regression run: **388 tests passed**.
  `python -m unittest test.test_art_styles test.test_ship_prompts test.test_ship_manifest test.test_ship_cli test.test_generate_expressions test.test_animate_portrait test.test_3d_cli test.test_background_scene`
- Final GUI/privacy run: **41 tests passed**, including private output routing,
  hidden styles, session expiry/logout, separate sessions, direct file requests,
  Windows junctions, metadata symlinks, protected settings, background generation,
  browser transport, selector population, gallery details and late response rejection.
  `node --test --test-concurrency=1 --test-timeout=120000 test/api.tableBullets.test.js test/api.secret.test.js test/api.secretIsolation.test.js test/artStyles.test.js test/secretMode.test.js test/ui.secretMode.test.js test/settings.test.js`
- Background UI regression run: **38 tests passed**.
  `node --test --test-concurrency=1 --test-timeout=120000 test/ui.secretMode.test.js test/ui.dynamicBackgrounds.test.js test/ui.backgrounds.test.js`
- Python compilation, JavaScript syntax and Git whitespace checks passed.

## Full-suite results and limitations

The final full GUI run (`node --test --test-concurrency=1 --test-timeout=120000
"test/*.test.js"`) passed **991 of 993 tests**. Two `api.tableBullets` tests failed
because their test server could not bind port 5199 (Windows EACCES). Both passed
unchanged in the final focused run above. An earlier full run also encountered
expression test timing/cleanup failures; all 22 expression and Foundry expression
import tests passed unchanged when run separately. The Settings configuration-field
test was updated for the intentionally private/server-only configuration keys.

The full Python run discovered **1,343 tests** and reported eight failures. One
standalone 3D metadata regression introduced during development was fixed and is
covered by the final passing regression run. The other seven failures were
reproduced by loading HEAD's unchanged `generate-npc.py` with the existing tables
and skill files (41 baseline tests):

- `test_import_skill_flags`: Gear's `lab` flag missing from the routing row, and
  the shape-line flag documentation check.
- `test_prompt_budget`: token prompt 99th percentile exceeds its limit.
- `test_role_lock`: a live role lock names a role that no longer exists.
- `test_scientists`: scientist lab backdrop frequency, lab-coat frequency, and
  civilian access to lab coats.

No connected browser was available to the browser automation tool. The new UI was
checked through its actual JavaScript transport and a DOM fixture, plus the
repository's existing served-page tests. Visual browser QA and live rendering
remain unverified.

ComfyUI and filesystem access are outside the GUI authentication boundary. Keep
those backend surfaces private; see [setup and deployment](secret-mode.md).
