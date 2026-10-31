import type { CalibrationSettings, Eye, OrientationSample, TrialCommand } from './types';

export type Role = 'desktop' | 'phone';

export type ClientMessage =
  | { type: 'hello'; role: Role; clientId: string; device?: Record<string, unknown> }
  | { type: 'ping'; at: number }
  | { type: 'startTest'; eye: Eye; calibration: CalibrationSettings }
  | { type: 'pauseTest' | 'resumeTest' | 'stopTest' | 'resetTest' | 'testComplete' }
  | TrialCommand
  | { type: 'trialReceived'; trialId: number }
  | { type: 'stimulusShown'; trialId: number; shownAt: number; orientation?: OrientationSample | null }
  | { type: 'stimulusHidden'; trialId: number; hiddenAt: number }
  | { type: 'stimulusResult'; trialId: number; shownAt: number; hiddenAt: number; actualDurationMs: number; orientation?: OrientationSample | null }
  | { type: 'error'; code: string; message: string; trialId?: number };

export type ServerMessage = ClientMessage
  | { type: 'connected'; role: Role; peerConnected: boolean }
  | { type: 'peerStatus'; role: Role; connected: boolean }
  | { type: 'pong'; at: number };

export function isProtocolMessage(value: unknown): value is ClientMessage {
  if (!isRecord(value) || typeof value.type !== 'string') return false;
  switch (value.type) {
    case 'hello': return isRole(value.role) && typeof value.clientId === 'string' && value.clientId.length > 0;
    case 'ping': return isFiniteNumber(value.at);
    case 'startTest': return isEye(value.eye) && isCalibration(value.calibration);
    case 'pauseTest': case 'resumeTest': case 'stopTest': case 'resetTest': case 'testComplete': return true;
    case 'trial':
      return isPositiveInteger(value.trialId) && isEye(value.eye)
        && isFiniteNumber(value.xDeg) && isFiniteNumber(value.yDeg)
        && isFiniteNumber(value.intensity) && value.intensity >= 0 && value.intensity <= 1
        && isFiniteNumber(value.durationMs) && value.durationMs > 0
        && typeof value.isCatch === 'boolean';
    case 'trialReceived': return isPositiveInteger(value.trialId);
    case 'stimulusShown':
      return isPositiveInteger(value.trialId) && isFiniteNumber(value.shownAt) && isOptionalOrientation(value.orientation);
    case 'stimulusHidden': return isPositiveInteger(value.trialId) && isFiniteNumber(value.hiddenAt);
    case 'stimulusResult':
      return isPositiveInteger(value.trialId) && isFiniteNumber(value.shownAt)
        && isFiniteNumber(value.hiddenAt) && isFiniteNumber(value.actualDurationMs)
        && value.actualDurationMs >= 0 && isOptionalOrientation(value.orientation);
    case 'error':
      return typeof value.code === 'string' && typeof value.message === 'string'
        && (value.trialId === undefined || isPositiveInteger(value.trialId));
    default: return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null; }
function isFiniteNumber(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value); }
function isPositiveInteger(value: unknown): value is number { return Number.isInteger(value) && Number(value) > 0; }
function isRole(value: unknown): value is Role { return value === 'desktop' || value === 'phone'; }
function isEye(value: unknown): value is Eye { return value === 'left' || value === 'right'; }
function isCalibration(value: unknown): value is CalibrationSettings {
  if (!isRecord(value)) return false;
  return ['horizontalFovDeg', 'verticalFovDeg', 'screenWidth', 'screenHeight', 'pixelRatio',
    'stimulusDiameterDeg', 'backgroundIntensity', 'maximumStimulusIntensity']
    .every(key => isFiniteNumber(value[key]));
}
function isOptionalOrientation(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (!isRecord(value)) return false;
  return ['alpha', 'beta', 'gamma'].every(key => value[key] === null || isFiniteNumber(value[key]));
}
