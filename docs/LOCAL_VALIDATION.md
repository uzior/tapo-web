# Local upstream integration - 2026-10-28

Base: upstream main `b5f7678` (0.3.0 plus the subsequent PTZ layout and SD audio fixes).
Local branch: `integration/upstream-0.3`. No new PRs have been opened for these changes.

## Preserved local additions

- SD transfer speed (three-second rolling average, decimal MB/s) and receive-idle notice.
  Metrics belong to each camera's fetch job and are displayed in the list and player.
- Loopback-only UI shutdown with an explicit request header, confirmation and server
  lifespan cleanup. The launcher uses `python -m app.server`.
- Existing `Uruchom Tapo.bat` remains an entry point alongside upstream `start.bat`.
- Polish wording corrections for saved PTZ positions and night mode. New local strings
  have matching English, German, Spanish and Polish catalogs; French remains the source.

## Real-camera checks

Camera: Tapo C520WS, hardware 1.0, firmware 1.3.5 Build 260522 Rel.14207n.

- Configuration migrated from .env, retaining both passwords and the existing recording directory.
- Protocol setting auto selected type 3 and remembered the result.
- Connection checks: network, RTSP camera account and TP-Link control account all passed.
- Live HD playlist and a video segment returned successfully; SD RTSP was also validated
  by the built-in connection check (H.264, 640x360).
- SD status, dates and today's recording list loaded.
- An 18-second SD clip downloaded completely; ffprobe reported H.264 and AAC, 17.92 seconds.
  Transfer speed was reported during the fetch. The MP4 endpoint supported byte-range playback.
- LED and spotlight changed and were restored to their original values.
- A temporary PTZ preset was saved. An ONVIF right nudge succeeded, followed by return
  to the saved position and removal of the temporary preset.
- Privacy, tracking and detection values were read without changing them.
- Only one physical camera was available. Multi-camera behavior and animal detection were
  covered by offline tests, not real-camera validation.
- UI shutdown completed the server lifespan cleanup successfully, followed by a successful
  restart. The new version is running locally for further user validation.

## Additional bug found

The async camera-settings PUT and preset-save POST called synchronous pytapo control
inside the ASGI event loop. This caused a misleading type-3 connection error and an
unawaited authentication-coroutine warning. Those calls now run in the thread pool.
A regression test requires that camera control executes outside the ASGI event loop.
The successful LED, spotlight and preset checks above were repeated after the fix.

## Verification and configuration safety

- Offline suite: 111 passed. One upstream dependency deprecation warning remains.
- JavaScript syntax and git diff whitespace checks passed.
- .env, cameras.json, cameras.tmp and logs/configuration backups are ignored by Git.
  The credential files are not tracked. The tracked/unignored source files were checked
  for the actual saved passwords; no matches were found.
- The camera diagnostic report was checked for the saved passwords and camera address;
  neither was present. The report remains local under logs/.
- Passwords remain plaintext on disk, as with the previous .env. Windows folder ACLs
  govern local access; gitignore is not an access-control or encryption mechanism.
- Previous code remains on local main. The original configuration backup is under the
  ignored logs/upstream-migration-backup/ directory. No recordings were removed.
