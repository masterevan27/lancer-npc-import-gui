# Versioning

The GUI release version remains exported from `lib/version.js`.

Every completed change should update the project version once, including changes made directly on the default branch. Use patch/subversion increases for ordinary changes, minor increases for larger compatible changes, and reserve major increases for intentional breaking or owner-approved releases. Use conventional unpadded numeric versions where the existing project format permits it.

Canonical version source: [`lib/version.js`](../lib/version.js). Keep this file as the agent-facing explanation of that source; do not create a competing version field when release automation already owns the version.

The existing source is authoritative for this project. Update it according to the project workflow before reporting a completed change.

