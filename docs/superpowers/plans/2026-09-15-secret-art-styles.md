# Secret Art Styles Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development to implement independent tasks, then review the integrated change.

**Goal:** Select public art styles and provide authenticated private generation and browsing across the two Lancer repositories.

**Architecture:** Python owns catalog validation, prompt style composition, and generator output routing. Node provides server-side sessions, filtered catalogs, and isolated private generation/gallery routes. The existing browser UI consumes those contracts without embedding hidden style data.

**Tech Stack:** Python standard library, Node standard library, vanilla browser JavaScript, existing Python/Node test runners.

**Spec:** `docs/superpowers/specs/2026-09-15-secret-art-styles-design.md`

## Global Constraints

- Preserve existing uncommitted changes; no live credentials or output directories modified.
- Built-in default always available; hidden records never leave authenticated APIs.
- Private outputs, manifests, jobs and paths require server authentication.
- No new runtime dependencies.

## Task 1: Generator style and output contracts

Files: generator `art_styles.py`, `art-styles.json`, generator CLIs and Python tests.

Interface: catalog `{styles:[{id,name,prompt,hidden}]}`; CLI `--art-style ID`, `--art-styles PATH`, `--secret`, `--secret-config PATH`. Private config holds `secretImagesDir`; private manifest is under that root. Public hidden selection is refused.

- [x] Write and run failing catalog, prompt and output-routing tests.
- [x] Implement catalog validation and reserved default; replace rendering instructions for custom styles.
- [x] Thread selection through NPC, spaceship, background and catalogue rendering, persisting style metadata. Route private outputs and Comfy prefixes separately.
- [x] Run Python tests, document CLI configuration.

## Task 2: Authentication and isolated server APIs

Files: GUI `lib/artStyles.js`, `lib/secretMode.js`, `server.js`, config example and API tests.

Interface: GET `/api/art-styles` returns `{styles}` filtered by session; `/api/secret/session`, POST `/api/secret/login`, POST `/api/secret/logout`; protected `/api/secret/items`, `/api/secret/image`, `/api/secret/create`, `/api/secret/create-status`, `/api/secret/settings` and background routes. Public create accepts `artStyle` and rejects hidden selection. Style metadata is `{id,name}`.

- [x] Write and run failing session, filtering, generation and direct access tests.
- [x] Implement hashed credential verification, expiring server sessions, request-origin validation, output containment and private APIs.
- [x] Wire public style selection and metadata into existing generation; restrict settings changes that could bypass privacy when Secret credentials are configured.
- [x] Run relevant integration tests and document setup without real credentials.

## Task 3: Browser controls and gallery

Files: GUI `public/app.js`, `public/index.html`, `public/style.css`, `public/dynamic-backgrounds.js`, focused UI tests.

- [x] Write failing UI tests for style controls and Secret navigation.
- [x] Add style selectors to creation forms and style labels to details.
- [x] Add login form, Leave Secret button, private storage setting and red gallery pill.
- [x] Route private jobs separately; clear private state on logout/expiry and prevent late responses repopulating it.
- [x] Verify selector filtering, generation payloads and gallery behavior.

## Task 4: Integration review and validation

- [x] Review privacy boundary and cross-language catalog parity.
- [x] Run Python and Node suites with the documented concurrency limits.
- [x] Attempt browser verification (no connected browser available); verify JavaScript behavior with a DOM fixture and review diffs for unrelated edits.
- [x] Report validation and configuration steps, including material backend access assumptions.
