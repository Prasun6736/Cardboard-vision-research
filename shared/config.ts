/**
 * Central configuration for the research prototypes.
 *
 * Change study behavior here instead of editing the controller, phone renderer,
 * audio engine, or server modules. Values are intentionally grouped by system.
 * None of the visual intensity or audio gain values are instrument calibrated.
 */

export const APP_CONFIG = {
  visualDisclaimer: 'Experimental research prototype only. Not instrument validated and not a replacement for calibrated perimetry.',
  audioDisclaimer: 'Research prototype only; not calibrated audiometry or a validated hearing assessment.'
} as const;

export const PARTICIPANT_CONFIG = {
  idPrefix: 'P',
  minimumAge: 5,
  maximumAge: 120,
  maximumNotesLength: 500,
  randomIdMinimum: 1000,
  randomIdMaximum: 9999
} as const;

export const VISUAL_TEST_CONFIG = {
  // 24 stimulus locations. With 6 catch trials this is exactly 30 trials/eye.
  gridXDegrees: [-15, -9, -3, 3, 9, 15],
  gridYDegrees: [9, 3, -3, -9],

  // Trial timing in milliseconds.
  stimulusDurationMs: 200,
  responseWindowMs: 1200,
  inputLimits: {
    stimulusDurationMs: { min: 50, max: 1000, step: 1 },
    responseWindowMs: { min: 500, max: 3000, step: 1 },
    horizontalFovDeg: { min: 30, max: 140, step: 1 },
    verticalFovDeg: { min: 30, max: 140, step: 1 },
    screenWidth: { min: 320, max: 10000, step: 1 },
    screenHeight: { min: 320, max: 10000, step: 1 },
    pixelRatio: { min: 0.5, max: 5, step: 0.1 },
    stimulusDiameterDeg: { min: 0.05, max: 5, step: 0.05 },
    backgroundIntensity: { min: 0, max: 1, step: 0.01 },
    maximumStimulusIntensity: { min: 0, max: 1, step: 0.01 }
  },
  preStimulusDelayMs: { min: 500, max: 1200 },
  interTrialDelayMs: { min: 500, max: 1000 },
  eyePhaseStartDelayMs: 700,

  // Quick adaptive staircase. Fewer trials are faster but less reliable.
  staircase: {
    startingIntensity: 0.9,
    initialStep: 0.2,
    minimumStep: 0.025,
    targetReversals: 1,
    maximumTrialsPerPoint: 1
  },

  // Blank trials contain no stimulus and measure false-positive responses.
  catchTrialsPerEye: 6,

  // Approximate headset/display geometry. These are not instrument calibration.
  calibration: {
    horizontalFovDeg: 90,
    verticalFovDeg: 90,
    screenWidth: 1920,
    screenHeight: 1080,
    pixelRatio: 1,
    stimulusDiameterDeg: 1,
    backgroundIntensity: 0.88,
    maximumStimulusIntensity: 1
  },

  // Canvas/WebXR presentation appearance.
  rendering: {
    backgroundRedOffset: 0.03,
    backgroundGreenOffset: 0.015,
    backgroundBlueOffset: -0.025,
    fixationColor: '#49453e',
    xrFixationIntensity: 0.25,
    maximumCanvasPixelRatio: 3,
    minimumStimulusRadiusCssPx: 1.5
  },

  // Relative result-map display bounds, in visual degrees.
  resultMap: { xMinDeg: -18, xMaxDeg: 18, yMinDeg: -12, yMaxDeg: 12, gridStepDeg: 6 }
} as const;

export const AUDIO_TEST_CONFIG = {
  // Tone set is logarithmically spaced between these limits.
  minimumFrequencyHz: 20,
  maximumFrequencyHz: 20_000,
  frequencyCount: 60,
  silentCatchTrialCount: 6,

  // Digital playback parameters. Gain is not dB HL or calibrated SPL.
  toneDurationMs: 300,
  responseWindowMs: 1200,
  outputGain: 0.04,
  inputLimits: {
    toneDurationMs: { min: 100, max: 1000, step: 1 },
    responseWindowMs: { min: 500, max: 3000, step: 1 },
    outputGain: { min: 0.005, max: 0.15, step: 0.005 },
    frequencyCount: { min: 8, max: 100, step: 1 },
    silentCatchTrialCount: { min: 2, max: 20, step: 1 }
  },
  attackRampMs: 15,
  releaseRampMs: 20,

  // Randomized scheduling in milliseconds.
  initialDelayMs: 500,
  preToneDelayMs: { min: 600, max: 1400 },
  interTrialDelayMs: { min: 350, max: 800 },

  // Labels drawn on the logarithmic results chart.
  chartFrequencyTicksHz: [20, 50, 100, 200, 500, 1000, 2000, 5000, 10_000, 20_000]
} as const;

export const NETWORK_CONFIG = {
  clientReconnectDelayMs: 1500,
  clientHeartbeatIntervalMs: 10_000,
  serverHeartbeatIntervalMs: 15_000,
  // Abort and re-queue a visual trial if the phone never confirms presentation.
  trialDeliveryTimeoutMs: 3_000,
  websocketPath: '/ws'
} as const;

export const SERVER_CONFIG = {
  defaultPort: 8443,
  pemCertificateFile: 'localhost.pem',
  pemPrivateKeyFile: 'localhost-key.pem',
  windowsPfxFile: 'localhost.pfx',
  windowsPublicCertificateFile: 'localhost.cer',
  pfxPassphrase: 'visual-field-dev',

  // SQLite is created under this project-relative directory.
  dataDirectory: 'data',
  databaseFile: 'research-tests.sqlite',
  databaseBackupFile: 'research-tests.backup.sqlite',
  maximumApiBodyBytes: 20 * 1024 * 1024,
  maximumParticipantHistoryRows: 500,

  // Optional default for `npm run cert`; leave blank to require a CLI IP.
  unixCertificateLanIp: ''
} as const;
