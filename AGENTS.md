# Agent instructions

## Dashboard

Dashboard project ID: lancer-npc-import-gui

Use the scoped dashboard check-in endpoint GET http://127.0.0.1:5080/api/checkin?project=lancer-npc-import-gui for project context and POST http://127.0.0.1:5080/api/checkin/lancer-npc-import-gui/events for project-scoped updates.

## Before starting project work

Before starting work in this project, check the dashboard for project-scoped human notes, active work, blockers, and additional instructions. After work, record completed, blocked, planned, test, and documentation findings through the dashboard API or CLI. Never edit materialized state files directly.

## Dashboard updates

When work in this repository is completed, blocked, planned, tested, or found
to have stale documentation, update the local AI agent dashboard. Start
`G:\GIT-REPOS\ai-agent-dashboard\server.js` if needed, then use its API or
CLI, for example:

```powershell
node G:\GIT-REPOS\ai-agent-dashboard\dashboard-cli.js add-note --project lancer-npc-import-gui --note "Describe the change and remaining work"
```

Use unique event ids and never edit `ai-agent-dashboard/data/state.json` or
`events.jsonl` directly. The canonical protocol is in
`G:\GIT-REPOS\ai-agent-dashboard\data\README.md`.

## Release versioning

The GUI release version is maintained in `lib/version.js` and is rendered in
the shared top bar, so it is visible on every tab. It starts at `1.0.0`; each
major, minor, and subversion component may contain at most two digits, and
versions use the conventional unpadded form such as `1.0.1`.

Increment the version once for every completed change to the website, including
changes made or committed directly to `main`. This applies even when no branch
or worktree is merged. After merging any branch or worktree, ensure its changes
include a version increment; do not increment twice for the same change.

Use a subversion increase for almost all changes, especially small changes. Use a
minor version increase for a large change and reset the subversion to zero. If
the subversion is about to overflow past `99`, increase the major version and
reset the minor version and subversion. Ask the project owner for permission
before increasing the major version for any other reason.
