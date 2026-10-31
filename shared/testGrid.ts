import { VISUAL_TEST_CONFIG } from './config';

export interface TestPoint { xDeg: number; yDeg: number; isCatch?: boolean; }

// Quick-test stimulus grid. Catch trials are added separately by the controller.
export const PROTOTYPE_GRID: TestPoint[] = VISUAL_TEST_CONFIG.gridYDegrees.flatMap(yDeg =>
  VISUAL_TEST_CONFIG.gridXDegrees.map(xDeg => ({ xDeg, yDeg }))
);

export function shuffledGrid(source: readonly TestPoint[] = PROTOTYPE_GRID): TestPoint[] {
  const copy = source.map(point => ({ ...point }));
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}
