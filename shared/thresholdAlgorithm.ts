export interface StaircaseState {
  intensity: number;
  step: number;
  lastDirection: -1 | 0 | 1;
  reversals: number;
  trialCount: number;
  reversalIntensities: number[];
  testedIntensities: number[];
}

export function createStaircase(): StaircaseState {
  return {
    intensity: VISUAL_TEST_CONFIG.staircase.startingIntensity,
    step: VISUAL_TEST_CONFIG.staircase.initialStep,
    lastDirection: 0, reversals: 0, trialCount: 0, reversalIntensities: [], testedIntensities: []
  };
}

export function updateStaircase(state: StaircaseState, seen: boolean): StaircaseState {
  const direction: -1 | 1 = seen ? -1 : 1;
  const reversed = state.lastDirection !== 0 && direction !== state.lastDirection;
  const reversals = state.reversals + (reversed ? 1 : 0);
  const step = reversed ? Math.max(VISUAL_TEST_CONFIG.staircase.minimumStep, state.step / 2) : state.step;
  return {
    intensity: Math.min(1, Math.max(0, state.intensity + direction * step)),
    step,
    lastDirection: direction,
    reversals,
    trialCount: state.trialCount + 1,
    reversalIntensities: reversed ? [...state.reversalIntensities, state.intensity] : state.reversalIntensities,
    testedIntensities: [...state.testedIntensities, state.intensity]
  };
}

export function isThresholdComplete(state: StaircaseState, targetReversals: number, maxTrials: number): boolean {
  return state.reversals >= targetReversals || state.trialCount >= maxTrials;
}

export function estimateThreshold(state: StaircaseState): number {
  const values = state.reversalIntensities.length
    ? state.reversalIntensities
    : [state.testedIntensities.at(-1) ?? state.intensity];
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
import { VISUAL_TEST_CONFIG } from './config';
