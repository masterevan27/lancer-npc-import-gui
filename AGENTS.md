# Agent instructions

## Release versioning

The GUI release version is maintained in `lib/version.js` and is rendered in
the shared top bar, so it is visible on every tab. It starts at `1.0.0`; each
major, minor, and subversion component may contain at most two digits, and
versions use the conventional unpadded form such as `1.0.1`.

After merging any branch or worktree, increment the version once. Use a
subversion increase for almost all changes, especially small changes. Use a
minor version increase for a large change and reset the subversion to zero. If
the subversion is about to overflow past `99`, increase the major version and
reset the minor version and subversion. Ask the project owner for permission
before increasing the major version for any other reason.
