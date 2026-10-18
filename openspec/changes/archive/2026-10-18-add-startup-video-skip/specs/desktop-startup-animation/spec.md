## MODIFIED Requirements

### Requirement: Bundled startup video pool
Desktop SHALL select once per process from the bundled cyberpunk, awakening and chibi videos and show it before Host preparation without reading selection-plugin configuration or making a media network request.

#### Scenario: Cold launch
- **WHEN** the Desktop process starts
- **THEN** its startup window loads the bundled video before profile preparation and Host startup

### Requirement: Handoff follows client readiness
Unless the user skips playback, Desktop SHALL retain the animation while Host is ready but the workspace has not mounted, and SHALL start the dissolve only after successful mount and painted frames. The playing video SHALL dissolve into the ready workspace during its final two seconds, following media time through playback stalls. Unless explicitly skipped, the handoff SHALL complete only after full playback and at least seven visible seconds, including the dissolve. A loaded Welcome window SHALL follow the same playback requirements.

#### Scenario: Delayed client mount
- **WHEN** Host is ready and the workspace is still mounting
- **THEN** the animation remains visible and the workspace remains hidden

#### Scenario: Client failure
- **WHEN** client initialization reports failure
- **THEN** no successful mount acknowledgement is sent and the existing recovery flow closes the animation

### Requirement: One animation per process
Desktop SHALL close the animation during handoff, explicit skip, media failure, reduced motion, recovery or quit and SHALL NOT replay it on navigation, reload, or session changes.

#### Scenario: Reload after handoff
- **WHEN** a successfully displayed workspace is reloaded
- **THEN** the startup video does not reopen

#### Scenario: Early destination readiness
- **WHEN** the workspace or Welcome is ready before seven seconds of visible playback and the user has not skipped playback
- **THEN** it remains hidden until the final two seconds, then appears beneath the dissolving video; the handoff completes only after seven seconds have elapsed and the video has ended

#### Scenario: Long video
- **WHEN** seven seconds have elapsed but the video is still playing and the user has not skipped playback
- **THEN** Desktop waits for the ended signal before handoff

#### Scenario: Media failure
- **WHEN** the local video fails to load
- **THEN** the startup window closes and ordinary startup continues

## ADDED Requirements

### Requirement: Immediate playback skip
Desktop SHALL provide a localized, translucent Skip button at the top right of every startup clip, operable with mouse and keyboard. Activating it SHALL close the current startup playback immediately, including a running dissolve, without waiting for the seven-second minimum or video completion. It SHALL release playback callbacks, timers and the startup IPC listener. Host preparation SHALL continue independently. A queued destination SHALL be shown immediately; otherwise later presentation SHALL follow the normal loading path. Skip SHALL affect only the current process launch and SHALL NOT replay the animation.

#### Scenario: Skip before the destination exists
- **WHEN** the user activates Skip before a destination window has been queued
- **THEN** the startup video closes immediately and the destination follows its normal loading flow when available

#### Scenario: Skip before playback completion
- **WHEN** the user activates Skip while any bundled video is playing
- **THEN** the video closes immediately and the queued destination appears without waiting for the minimum duration or ended signal

#### Scenario: Skip during a dissolve
- **WHEN** the user activates Skip during either the media-tail dissolve or the late-destination dissolve
- **THEN** the dissolve is cancelled and the destination remains visible without replay

#### Scenario: Unowned skip signal
- **WHEN** a document other than the owned startup main frame sends a skip signal
- **THEN** it cannot close the startup video or reveal a destination
