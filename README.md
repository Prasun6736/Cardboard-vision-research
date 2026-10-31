# Cardboard visual-field research prototype

An end-to-end desktop-controller/phone-stimulus prototype for experimental visual-field testing. It is **not clinically validated**, does not reproduce calibrated Humphrey perimetry, and must not be used for diagnosis or treatment decisions.

The project also includes a standalone experimental audio audibility-response test at `/audio/`. It is not calibrated audiometry and must not be used to diagnose hearing loss. Participant and test-session data are persisted in a local SQLite database so interrupted and completed sessions survive a browser refresh.

## Configuration

All study and runtime defaults are documented in `shared/config.ts`. Edit that one file to change the visual grid, trial timing, staircase, calibration defaults, rendering values, result-map bounds, audio frequency range and timing, participant limits, WebSocket timing, server port, or certificate filenames. The HTML forms are populated from this configuration at runtime. Windows certificate IP addresses are detected automatically.

## Run it

Requirements: Node.js 20+ and a desktop and phone on the same Wi-Fi network.

```bash
npm install
npm run dev
```

The terminal prints the desktop and phone URLs. Open the desktop URL on the computer and `/phone/` on the phone. On the phone, tap **Enter fullscreen / WebXR** before putting it into the Cardboard headset. Press Space on the desktop once when the patient reports a visible stimulus.

Open `/audio/` for the audio test. It presents a shuffled logarithmic set of tones from 20 Hz to 20 kHz plus silent catch trials. Space during a tone response window records a heard tone; Space during a silent catch or anywhere outside a response window records a false positive. The page reports the observed range, missed frequencies, catch-trial rate, stray key presses, signal-detection metrics, and supports PDF/JSON/CSV export. Use low, comfortable volume: digital gain is not calibrated sound-pressure level or dB HL.

Each visual or audio test can still be downloaded as its own PDF. Once both tests are fully completed for the same participant ID, the **Combined PDF** button becomes available on either test page. It loads the latest completed visual and audio sessions from SQLite and creates one report containing both eye maps, audio results, response definitions, formulas, and substituted values. Stopped/partial tests remain saved but do not unlock the combined report.

Open `/history/` (or use **Participant history** in the header) to search saved participants, inspect every completed or partial session, download a session's PDF or JSON again, and create the latest combined PDF.

## Local data storage

SQLite data is stored at `data/research-tests.sqlite`, with the previous persisted snapshot retained as `data/research-tests.backup.sqlite`; the `data/` directory is ignored by Git. The server uses the cross-platform WebAssembly build of SQLite (`sql.js`), so Windows does not need native SQLite binaries, Visual Studio Build Tools, Python, or `node-gyp`. A snapshot is saved when a session starts, after completed trials, at the between-eye checkpoint, and on stop/completion. The database contains participant names and other identifiable data, is not encrypted, and has no user authentication. Keep the computer secured and apply the retention/deletion requirements of your study protocol. This local prototype storage is not suitable for an internet-facing production deployment.

The local JSON API used by the browser is:

- `POST /api/sessions` — create or update a visual/audio session.
- `GET /api/participants` — list locally saved participants and session counts.
- `GET /api/sessions/:sessionId` — read one saved session.
- `GET /api/participants/:participantId/latest` — read the latest visual and audio sessions.
- `GET /api/participants/:participantId/latest-completed` — read the latest completed pair used for combined reports.
- `GET /api/participants/:participantId/sessions` — list that participant's saved sessions.

For APIs that require a secure context, create a development certificate containing the desktop's LAN IP:

```bash
npm run cert -- 192.168.1.23
npm run dev
```

Trust `certs/localhost.pem` on the desktop and phone, or explicitly accept the development-certificate warning on both. A self-signed certificate is for local development only. If your desktop IP changes, regenerate it with the new address. For a smoother setup, a locally trusted tool such as `mkcert` can be used to replace the two PEM files with a certificate trusted by both devices.

On Windows PowerShell, no OpenSSL installation is required. Run:

```powershell
npm run cert:windows
npm run dev
```

The Windows command automatically detects all active non-loopback IPv4 addresses and includes them in the certificate. This covers Wi-Fi, Ethernet, VirtualBox, WSL, and other active adapters without a fixed IP in configuration. If necessary, append an additional address with `npm run cert:windows -- 192.168.1.23`.

The Windows script uses `New-SelfSignedCertificate`, writes `certs\localhost.pfx` for the server plus `certs\localhost.cer` as the shareable public certificate, and automatically trusts it for the current Windows user. The server detects the PFX automatically; no separate import command is needed on the laptop.

Never share `localhost.pfx`; it contains the private key. The phone must separately trust the public `localhost.cer` certificate or accept the local certificate warning.

Build/type-check with `npm run build`. `npm start` starts the same cross-platform server command as development; the current prototype retains Vite middleware so it can serve the TypeScript clients without a second process.

## Architecture

```text
Desktop browser                     Node server                     Phone browser
┌─────────────────────────┐        ┌──────────────────┐            ┌────────────────────────┐
│ Session + state machine │◄──────►│ HTTPS static/Vite│◄──────────►│ WebXR capability path  │
│ Adaptive staircases     │   WS   │ WebSocket relay  │    WS      │ Stereo Canvas fallback │
│ Spacebar responses      │        │ Role + heartbeat │            │ Local stimulus clock   │
│ Maps + PDF/JSON/CSV     │        │ SQLite storage   │            │ Wake lock + orientation│
└─────────────────────────┘        └──────────────────┘            └────────────────────────┘
```

- The desktop is the session controller. It sequences eyes and trials, accepts responses, updates per-location staircases, stores data, and renders results.
- The server registers one current `desktop` peer and one current `phone` peer, validates message shape, relays commands/results, reports peer status, and checks liveness.
- The phone is the deterministic renderer. It acknowledges a trial, presents and removes the stimulus using its own animation-frame clock, and sends measured timestamps back.
- The phone probes `immersive-vr`. If an XR session can be entered from the phone button, a minimal WebGL XR layer is used. Otherwise, a fullscreen side-by-side Canvas view is used.
- Both tests include randomized stimulus-absent catch trials and report hits, misses, false alarms, correct rejections, hit/false-alarm rates, d-prime, and response bias. Log-linear correction prevents infinite z-scores.
- PDF reports include participant information, field maps or the audio frequency chart, response matrices, calculated metrics, and trial summaries. JSON exports include the derived signal-detection object as well as raw trials.

## Directory structure

```text
server/
  server.ts              HTTPS/HTTP and Vite development server
  api.ts                 local session persistence API
  database.ts            SQLite schema and queries
  websocket.ts           role registration, relay, heartbeat
client/
  index.html             desktop page
  desktop/
    desktop.ts           session controller and trial state machine
    results.ts           maps and JSON/CSV exports
    style.css
  phone/
    index.html
    phone.ts             protocol client and local presentation timing
    renderer.ts          stereo Canvas, angle mapping, RGB abstraction
    vr.ts                WebXR probe and minimal immersive WebGL renderer
    style.css
shared/
  config.ts              single source for configurable values
  protocol.ts            message union and basic validation
  types.ts               session/trial/settings models
  testGrid.ts            replaceable degree-based grid
  thresholdAlgorithm.ts  replaceable adaptive staircase
scripts/
  create-local-cert.sh
```

## WebSocket protocol

All messages are JSON objects with a `type`. Clients reconnect automatically and identify themselves first:

```json
{ "type": "hello", "role": "phone", "clientId": "...", "device": {} }
```

Server-only status messages are `connected`, `peerStatus`, and `pong`. Either client may send `ping`. The desktop sends `startTest`, `pauseTest`, `resumeTest`, `stopTest`, `resetTest`, `testComplete`, and `trial`. The phone sends `trialReceived`, `stimulusShown`, `stimulusHidden`, `stimulusResult`, and errors. A typical exchange is:

```text
desktop → phone  trial { trialId, eye, xDeg, yDeg, intensity, durationMs }
phone → desktop trialReceived { trialId }
phone → desktop stimulusShown { trialId, shownAt, orientation? }
phone → desktop stimulusHidden { trialId, hiddenAt }
phone → desktop stimulusResult { trialId, shownAt, hiddenAt, actualDurationMs, orientation? }
```

Phone timestamps are from `performance.now()` in the phone's clock domain. Desktop response times are from the desktop clock domain. Therefore `estimatedReactionTimeMs` is measured from when the desktop receives `stimulusShown`, not by subtracting clocks across devices. Accurate cross-device reaction time would require clock synchronization and latency estimation.

Duplicate trial IDs are acknowledged but not shown again. Malformed/unroutable messages produce `error` messages. The server uses WebSocket ping/pong liveness checks and clients also send application heartbeats.

## Trial state machine

```text
IDLE → CONNECTED → FIXATION → PRE_STIMULUS → STIMULUS
                          ↑                      ↓
                   INTER_TRIAL_INTERVAL ← RESPONSE_WINDOW

Any active phase → PAUSED → FIXATION
Any active phase → COMPLETE (stop)
Left eye finished → BETWEEN_EYES → operator starts right-eye FIXATION
Right eye finished → COMPLETE
```

The pre-stimulus and inter-trial intervals are randomized. The phone controls the requested 200 ms presentation locally: the desktop never schedules stimulus removal. A pause records an in-flight trial as not seen, cancels timers, and suppresses the phone stimulus.

## Visual-angle and stereo mapping

The fallback divides the physical canvas into equal left and right viewports. Only the viewport matching the active test eye gets fixation and stimulus content; the other stays at the same neutral background.

For each per-eye viewport, degree coordinates are projected independently:

```text
xNormalized = tan(xDeg) / tan(horizontalFovDeg / 2)
yNormalized = tan(yDeg) / tan(verticalFovDeg / 2)
xPixel = viewportWidth  × (0.5 + 0.5 × xNormalized)
yPixel = viewportHeight × (0.5 - 0.5 × yNormalized)
```

This is an approximate pinhole projection. `visualAngleToPosition()` is isolated in `renderer.ts`, so a device/headset calibration model or measured distortion mesh can replace it. The WebXR path uses the same normalized-angle concept per XR eye view. Head orientation is optionally recorded, but it never moves the stimulus.

`backgroundToRGB()` creates a light warm-neutral field. `intensityToRGB()` renders a pure-white (`#FFFFFF`) target whose opacity follows the requested intensity, allowing the staircase to vary contrast while retaining a white stimulus. The prototype uses a dark fixation marker and a larger stimulus for visibility. These RGB values are **not calibrated luminance**. A measured display/headset lookup table can replace both mappings without changing trial logic.

## Threshold strategy and data

Each eye receives exactly 30 trials: 24 stimulus-present locations and 6 randomized blank catch trials. Every location is presented once at the configured starting intensity, producing a quick binary response map rather than a clinical threshold estimate. The left-eye phase stops at a manual checkpoint; the operator must press **Start right-eye test** to continue. The non-tested eye remains black. This intentionally simple strategy can be replaced independently.

The session stores separate left/right trials and thresholds, requested and measured presentation durations, phone timestamps, response timestamps, reaction-time estimates, settings, and optional orientation. JSON preserves the complete structure; CSV exports one row per trial.

Each field map and visual PDF includes a reading reference. Temporal means away from the nose; nasal means toward the nose. Superior is the upper field (+Y), inferior is the lower field (-Y), and the center cross is fixation at 0°, 0°. Tested scores are 100 when the stimulus was seen and 0 when it was not seen in this single-presentation protocol. Intermediate grayscale is interpolated visualization only and is not an additional measurement, clinical dB value, normative percentile, or diagnosis.

## Current research limitations

- Browser scheduling, display scan-out, WebSocket latency, and Bluetooth/keyboard latency are not instrument-grade timing.
- FOV values are estimates; lens distortion, eye relief, screen placement, pupil position, and device optics are not calibrated.
- RGB output is not luminance and no background/stimulus photometry is performed.
- There is no fixation monitoring, blind-spot localization testing, eye tracking, or clinical normative database. Blank catch trials provide prototype false-positive statistics but are not a clinically validated reliability model.
- Device orientation is observational only and is not used to compensate stimulus position.
