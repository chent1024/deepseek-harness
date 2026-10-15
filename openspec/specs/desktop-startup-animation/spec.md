# desktop-startup-animation Specification

## Purpose
Present a complete local video during Electron startup and hand off to a ready workspace or Welcome after full playback and the minimum visible duration.
## Requirements
### Requirement: Bundled startup video pool
Desktop SHALL select once per process from the bundled brand, cyberpunk and awakening videos and show it before Host preparation without reading selection-plugin configuration or making a media network request.

#### Scenario: Cold launch
- **WHEN** the Desktop process starts
- **THEN** its startup window loads the bundled video before profile preparation and Host startup

### Requirement: Handoff follows client readiness
Desktop SHALL retain the animation while Host is ready but the workspace has not mounted, and SHALL reveal the workspace only after successful mount and painted frames, complete video playback and at least seven seconds of visible playback. A loaded Welcome window SHALL follow the same playback requirements.

#### Scenario: Delayed client mount
- **WHEN** Host is ready and the workspace is still mounting
- **THEN** the animation remains visible and the workspace remains hidden

#### Scenario: Client failure
- **WHEN** client initialization reports failure
- **THEN** no successful mount acknowledgement is sent and the existing recovery flow closes the animation

### Requirement: One animation per process
Desktop SHALL close the animation during handoff, media failure, reduced motion, recovery or quit and SHALL NOT replay it on navigation, reload, or session changes.

#### Scenario: Reload after handoff
- **WHEN** a successfully displayed workspace is reloaded
- **THEN** the startup video does not reopen

#### Scenario: Early destination readiness
- **WHEN** the workspace or Welcome is ready before seven seconds of visible playback
- **THEN** it remains hidden until seven seconds have elapsed and the video has ended

#### Scenario: Long video
- **WHEN** seven seconds have elapsed but the video is still playing
- **THEN** Desktop waits for the ended signal before handoff

#### Scenario: Media failure
- **WHEN** the local video fails to load
- **THEN** the startup window closes and ordinary startup continues

### Requirement: Complete video framing
Desktop SHALL display the complete video at its original aspect ratio without cropping and SHALL size the startup window within the primary display work area.

#### Scenario: Smaller display
- **WHEN** the display work area is smaller than the bundled 1280 by 720 video
- **THEN** the startup window scales down to fit and the complete video remains visible
