# Cardboard Visual-Field Research Prototype

An experimental visual-field testing system using a desktop controller and a smartphone-based VR/Cardboard display. The project also includes an audio audibility-response test and combined participant reports.

**Note:** This is a research prototype, not a clinically validated system. It does not reproduce calibrated Humphrey perimetry or audiometry and must not be used for medical diagnosis.

## Features

- **Visual-Field Testing:** Experimental visual stimulus presentation for left and right eye testing using a Cardboard headset.
- **Audio Audibility Testing:** Frequency-based tone testing from 20 Hz to 20 kHz, including silent catch trials.
- **Desktop–Phone Communication:** WebSocket-based communication between the desktop controller and phone renderer.
- **Participant History:** Stores participant details and completed or partial sessions using SQLite.
- **Reports and Exports:** Individual PDF reports, combined visual and audio PDF reports, and JSON/CSV exports.
- **Signal Detection Metrics:** Calculates hits, misses, false alarms, correct rejections, hit rate, false-alarm rate, d-prime, and response bias.

## Technologies Used

- TypeScript and JavaScript
- Node.js
- Yarn
- Vite
- WebSocket
- WebXR and Canvas
- SQLite (sql.js)
- HTML and CSS

## Getting Started

**Requirements:**
- Node.js 20.19+ or 22.12+
- Yarn 1.x
- Desktop and smartphone connected to the same Wi-Fi network
- Google Cardboard-compatible VR headset (for phone-based VR testing)

### 1. Clone the repository

```bash
git clone https://github.com/Prasun6736/Cardboard-vision-research.git
cd Cardboard-vision-research
```

### 2. Install dependencies

```bash
yarn install
```

### 3. Start the development server

```bash
yarn dev
```

The terminal displays the desktop and phone URLs.

- Open the desktop URL on your computer.
- Open `/phone/` on your smartphone.
- Enter fullscreen/WebXR mode before placing the phone inside the Cardboard headset.
- Use the Space key on the desktop to record participant responses.

### 4. Run the audio test

Open `/audio/` in the browser to access the audio audibility-response test.

### 5. Participant history

Open `/history/` to view saved participants, inspect test sessions, and download reports.

## Configuration and Build

All major study and runtime settings can be modified in:

```text
shared/config.ts
```

To build and type-check the project:

```bash
yarn build
```

For secure local development on Windows, generate certificates using:

```powershell
yarn cert:windows
```

Then restart the server:

```bash
yarn dev
```

## System Architecture

The system consists of three main components:

1. **Desktop Controller:** Manages test sessions, trial sequences, participant responses, results, and reports.
2. **Node.js Server:** Handles WebSocket communication, client registration, session APIs, and SQLite persistence.
3. **Phone Renderer:** Presents visual stimuli through WebXR or a side-by-side Canvas fallback and records presentation timestamps.

## Project Structure

```text
server/       Server, API, database and WebSocket
client/       Desktop and phone interfaces
  desktop/    Test controller and results
  phone/      VR rendering and stimulus presentation
shared/       Configuration, protocols and data types
scripts/      Certificate generation scripts
```

## Data Storage and Security

Participant and session data are stored locally in SQLite under `data/`. The database includes identifiable participant information and is not encrypted or protected by user authentication.

Keep participant data private and do not upload research records, private certificates, or sensitive information to GitHub.

## Research Limitations

- The system is not clinically validated.
- Display brightness, luminance, and headset optics are not calibrated.
- Browser scheduling and network latency are not instrument-grade.
- Eye tracking, fixation monitoring, and clinical normative databases are not implemented.
- Audio output is not calibrated to sound-pressure levels or dB HL.

The project is intended for experimental research and academic demonstration, not clinical use.