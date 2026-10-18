## Context

The startup window already owns a single random local clip and releases it through the normal handoff or media-failure path. The user-supplied HEVC clip is converted to H.264 while preserving its complete 4K, 60-fps image and duration.

## Decisions

- Reuse the owned startup-frame playback IPC with a `skip` signal and the existing immediate finish operation.
- Keep button copy in the Desktop locale dictionaries and place the translucent native button in the isolated startup document. Native button semantics provide keyboard activation and a visible focus indicator.
- Cancel preload playback callbacks on Skip. Closing the window clears the minimum and dissolve timers and removes its IPC listener.
- A queued destination is shown immediately; otherwise later destination presentation follows the normal loading path. Skip neither marks the Host ready nor persists across launches.

## Validation

Extend the existing owner-local Electron qualification to play all three clips and activate Skip before destination readiness, before playback completion, and during tail and late dissolves. Keep user data isolated and retain normal playback and media-failure checks.
