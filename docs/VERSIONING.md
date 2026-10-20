---
type: "Reference"
title: "Versioning"
description: "Release version source, increment rules and automation for this repository."
status: stable
tags:
  - documentation
  - versioning
sources:
  - id: version-module
    resource: ../lib/version.js
    title: Displayed release version source
  - id: version-test
    resource: ../test/version.test.js
    title: Displayed version test
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-20T05:03:51Z
stale_after: 2027-01-18T00:00:00Z
---
# Versioning

The GUI release version remains exported from `lib/version.js`.

Version `1.3.5` records OKF lifecycle, tags, provenance, code sources and review
deadlines in every documentation concept and adopts house profile 1.1.0, which
warns when provenance, runbook sources or review deadlines are missing. No
document is marked verified.

Every completed change should update the project version once, including changes made directly on the default branch. Use patch/subversion increases for ordinary changes, minor increases for larger compatible changes, and reserve major increases for intentional breaking or owner-approved releases. Use conventional unpadded numeric versions where the existing project format permits it.

Canonical version source: [`lib/version.js`](../lib/version.js). Keep this file as the agent-facing explanation of that source; do not create a competing version field when release automation already owns the version.

The existing source is authoritative for this project. Update it according to the project workflow before reporting a completed change.

