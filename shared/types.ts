export type Eye = 'left' | 'right';

export type TestState =
  | 'IDLE' | 'CONNECTED' | 'CALIBRATION' | 'FIXATION' | 'PRE_STIMULUS'
  | 'STIMULUS' | 'RESPONSE_WINDOW' | 'INTER_TRIAL_INTERVAL' | 'BETWEEN_EYES' | 'PAUSED' | 'COMPLETE';

export interface CalibrationSettings {
  horizontalFovDeg: number;
  verticalFovDeg: number;
  screenWidth: number;
  screenHeight: number;
  pixelRatio: number;
  stimulusDiameterDeg: number;
  backgroundIntensity: number;
  maximumStimulusIntensity: number;
}

export interface TestSettings {
  stimulusDurationMs: number;
  responseWindowMs: number;
  preStimulusMinMs: number;
  preStimulusMaxMs: number;
  interTrialMinMs: number;
  interTrialMaxMs: number;
  targetReversals: number;
  maxTrialsPerPoint: number;
  calibration: CalibrationSettings;
}

export interface TrialCommand {
  type: 'trial';
  trialId: number;
  eye: Eye;
  xDeg: number;
  yDeg: number;
  intensity: number;
  durationMs: number;
  isCatch: boolean;
}

export interface TrialRecord {
  trialId: number;
  eye: Eye;
  xDeg: number;
  yDeg: number;
  intensity: number;
  isCatch: boolean;
  requestedDurationMs: number;
  trialStartedAt: string;
  desktopTrialStartMs: number;
  phoneShownAt: number | null;
  phoneHiddenAt: number | null;
  actualDurationMs: number | null;
  desktopStimulusShownReceivedMs: number | null;
  seen: boolean;
  desktopResponseAt: number | null;
  estimatedReactionTimeMs: number | null;
  orientation?: OrientationSample | null;
}

export interface OrientationSample { alpha: number | null; beta: number | null; gamma: number | null; }

export interface ThresholdResult {
  xDeg: number;
  yDeg: number;
  threshold: number;
  reversals: number;
  trials: number;
  /** Binary/aggregate response score used by quick one-presentation maps. */
  relativeSensitivity?: number;
}

export interface ParticipantInfo {
  participantId: string;
  name: string;
  age: number;
  gender: 'male' | 'female' | 'other';
  notes?: string;
  recordedAt: string;
}

export interface SessionData {
  sessionId: string;
  startedAt: string;
  completedAt?: string;
  participant: ParticipantInfo;
  device: Record<string, unknown>;
  settings: TestSettings;
  disclaimer: string;
  eyes: Record<Eye, { trials: TrialRecord[]; thresholds: ThresholdResult[] }>;
}
