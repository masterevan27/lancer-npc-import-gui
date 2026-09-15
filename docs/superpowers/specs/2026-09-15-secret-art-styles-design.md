# Art styles and Secret mode

Approved in conversation on September 14, 2026, with an explicit addition that the GUI must offer art-style selectors and never display hidden styles outside Secret mode.

## Behavior

The generator repository owns `art-styles.json`: an object with a `styles` array of `{id, name, prompt, hidden}` records. `secret: true` is an alias for `hidden: true`. A reserved built-in `default` style is always available and initially selected; missing and whitespace-only files or empty styles arrays retain it. Default output preserves existing subject-specific prompts. Custom styles replace the existing rendering-style instructions while retaining subject and framing instructions. Invalid catalogs and unknown IDs fail clearly rather than silently changing rendering or privacy.

The GUI offers style selectors for NPC, spaceship, and background creation, and shows selected styles on image details. The server returns only public styles unless the browser has authenticated for Secret mode. Hidden styles require authentication even when requested directly by ID.

Settings has a red Secret button opening a username/password dialog. Credentials are stored only in server configuration, with a hashed password. Login establishes an expiring, HttpOnly, SameSite session. A red Leave Secret button logs out and clears private UI state. Secret mode exposes a red Secret Images pill with the current image-card layout.

All generation requested in Secret mode is private, even with the default or another public style. Private outputs and metadata live under a separate configurable secretImagesDir. The private manifest, thumbnails, prompts, job logs and API responses are authenticated. Private files cannot be read via public routes or published into Foundry/SillyTavern. Unauthenticated settings changes cannot repoint public paths or generator commands to circumvent isolation. ComfyUI is a backend under the operator's control; private jobs must not use normal generated-output prefixes.

Private storage configuration is editable only after Secret authentication. Missing credentials disable login; there are no shipped usable credentials. Leaving Secret invalidates the session; separate browsers remain independent. Private requests use no-store caching and same-origin protections.

## Validation

Use synthetic output roots and subprocess generators for tests; do not render real images or change live configuration. Cover fallback catalogs, alias flags, unknown IDs, prompt replacement, isolated output and manifest routing, direct unauthenticated requests, expired/logged-out sessions, private job visibility, public path escapes and settings bypasses, and browser selector/gallery behavior. Preserve all pre-existing working tree modifications.
