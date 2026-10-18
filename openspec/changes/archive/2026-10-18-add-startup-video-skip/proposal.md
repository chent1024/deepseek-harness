## Why

Users need their supplied video in the startup pool and a way to enter the application without waiting for any startup clip to finish.

## What Changes

- Bundle the complete user-supplied chibi clip beside the existing two videos.
- Add a localized translucent Skip button at the top right of every startup clip.
- End the current playback and dissolve immediately on Skip while Host startup continues.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `desktop-startup-animation`: include the chibi clip and allow explicit skipping of the current startup playback.

## Impact

Desktop media resources, packaging, shell locale copy, startup document and preload, and the existing startup qualification tests. No persistent setting or Host startup change.
