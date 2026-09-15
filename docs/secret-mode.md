# Art styles and Secret mode

The generator owns `art-styles.json`, next to `generate-npc.py`. Set `artStylesPath` in GUI `config.json` to use a different catalog. Records have `id`, `name`, `prompt`, and optional boolean `hidden` (or `secret`). The reserved `default` style is always present. Missing/blank catalogs retain Default; malformed catalogs fail validation. Hidden records are only returned after Secret login. Prompt text is never part of the style-list response.

Choose styles in the NPC, spaceship, or background creation form. Cards and image
details show the recorded style. Marking a previously public style hidden excludes
its recorded images from public GUI lists and image routes. This does not relocate
old files or retract copies already exported to another application.

## Configure credentials

Credentials are separate from the Foundry importer's `secret`. No usable credentials ship with the GUI. In PowerShell 7, generate a salted password hash without including the password in command history:

```powershell
$secretPassword = Read-Host 'Secret password' -MaskInput
$secretPassword | node scripts/hash-secret-password.js
Remove-Variable secretPassword
```

Copy the hash into `config.json` and choose a username:

```json
{
  "secretMode": {
    "username": "your-chosen-name",
    "passwordHash": "paste-the-generated-scrypt-hash-here",
    "sessionMinutes": 60
  },
  "secretImagesDir": "G:/PrivateLancerImages"
}
```

Merge these keys into the existing configuration, then restart the GUI server. The default session lasts one hour, with configurable bounds of 1 minute to 24 hours. Login uses a server-held, expiring HttpOnly/SameSite cookie; Leave Secret invalidates that browser session. Failed logins are rate limited. Invalid or missing credentials disable login.

## Private storage and generation

Use a separate absolute storage directory, outside Foundry, SillyTavern, public output, staged references, presets, and the web root. The authenticated Settings dialog can change it immediately after active private jobs finish. Old roots remain recorded in `secretImageRoots` so their files continue to be excluded from public routes after a restart. Changing storage does not move existing images.

Private NPCs and ships use `manifest.json` under this root and their own `npcs/` and `spaceships/` trees. Backgrounds use `backgrounds/`. Every Secret generation is private, including Default and other public styles. Private job status, logs, images, and metadata require a current session and use `Cache-Control: no-store`. Private entries cannot be imported into Foundry or SillyTavern. Public path/settings changes cannot point at private storage. Normal settings writes require Secret authentication once credentials or private storage exist; if credentials are removed, restore them by editing the server config to regain settings access.

The generator receives `--art-style`, `--art-styles`, `--secret`, and `--secret-config` and must be updated together with the GUI. Private ComfyUI output uses a separate prefix. ComfyUI itself remains an operator-controlled backend with its own output/history access; the GUI session does not protect direct access to that service. Keep it accessible only to trusted operators. For network access, serve the GUI through HTTPS and a same-origin reverse proxy; do not expose the backend or private folder as static files.

Private browsing and creation are available; public-item editing, animation, and import controls are disabled while in Secret mode. Return to normal mode to use those public operations.

For an HTTPS reverse proxy, configure `publicOrigin` to the exact external origin, such as `https://lancer.example`. This enables HTTPS origin validation and Secure session cookies without trusting spoofable `X-Forwarded-*` request headers. Leave it blank for direct localhost HTTP use. Restart after changing this setting.

See [validation results and remaining verification limits](secret-mode-validation.md).
