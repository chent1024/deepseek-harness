# Bundled videos during Desktop startup

## Why
Electron currently keeps its first window hidden while the Host starts. A client overlay can only play after the client plugins load. The user requests a local startup video independent of the selection plugin and easy to retain when updating upstream.

## What Changes
- Bundle the brand, cyberpunk and awakening videos and their BSD license; select once per process.
- Show an isolated startup window before Host preparation, preserving the complete video and fitting the display work area.
- Reveal the mounted and painted workspace, or loaded Welcome, after full video completion and at least seven visible seconds.
- Close the startup window on media failure, reduced motion, recovery or quit. Never restart it on document reload or workspace changes.

## Impact
Desktop lifecycle, its private boot acknowledgement, Web carrier, packaging resources, and focused tests. No plugin modifications, user configuration, sessions, provider requests, or release actions.
