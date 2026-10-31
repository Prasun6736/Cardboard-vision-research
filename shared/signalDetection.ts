/** A single signal-detection observation. */
export interface DetectionObservation {
  signalPresent: boolean;
  responded: boolean;
}

export interface SignalDetectionMetrics {
  hits: number;
  misses: number;
  falseAlarms: number;
  correctRejections: number;
  signalTrials: number;
  catchTrials: number;
  hitRate: number | null;
  falseAlarmRate: number | null;
  correctedHitRate: number | null;
  correctedFalseAlarmRate: number | null;
  hitZ: number | null;
  falseAlarmZ: number | null;
  dPrime: number | null;
  responseBias: number | null;
}

/**
 * Calculate the 2x2 response matrix and signal-detection measures.
 * A log-linear 0.5 correction prevents infinite z-scores at rates of 0 or 1.
 */
export function calculateSignalDetection(observations: DetectionObservation[]): SignalDetectionMetrics {
  const hits = observations.filter(item => item.signalPresent && item.responded).length;
  const misses = observations.filter(item => item.signalPresent && !item.responded).length;
  const falseAlarms = observations.filter(item => !item.signalPresent && item.responded).length;
  const correctRejections = observations.filter(item => !item.signalPresent && !item.responded).length;
  const signalTrials = hits + misses;
  const catchTrials = falseAlarms + correctRejections;
  const hitRate = signalTrials ? hits / signalTrials : null;
  const falseAlarmRate = catchTrials ? falseAlarms / catchTrials : null;
  const correctedHitRate = signalTrials ? (hits + 0.5) / (signalTrials + 1) : null;
  const correctedFalseAlarmRate = catchTrials ? (falseAlarms + 0.5) / (catchTrials + 1) : null;
  const hitZ = correctedHitRate === null ? null : inverseNormalCdf(correctedHitRate);
  const falseAlarmZ = correctedFalseAlarmRate === null ? null : inverseNormalCdf(correctedFalseAlarmRate);
  return {
    hits, misses, falseAlarms, correctRejections, signalTrials, catchTrials,
    hitRate, falseAlarmRate, correctedHitRate, correctedFalseAlarmRate, hitZ, falseAlarmZ,
    dPrime: hitZ === null || falseAlarmZ === null ? null : hitZ - falseAlarmZ,
    responseBias: hitZ === null || falseAlarmZ === null ? null : -0.5 * (hitZ + falseAlarmZ)
  };
}

export const SIGNAL_DETECTION_DEFINITIONS = [
  'Hit: stimulus was present and the participant responded.',
  'Miss: stimulus was present and the participant did not respond.',
  'False alarm: stimulus was absent during a catch trial, but the participant responded.',
  'Correct rejection: stimulus was absent during a catch trial and the participant did not respond.'
] as const;

/** Human-readable equations with the session values substituted. */
export function signalDetectionFormulaLines(metrics: SignalDetectionMetrics): string[] {
  const decimal = (value: number | null) => value === null ? 'N/A' : value.toFixed(4);
  return [
    `H = hits / (hits + misses) = ${metrics.hits} / (${metrics.hits} + ${metrics.misses}) = ${decimal(metrics.hitRate)}`,
    `FA = false alarms / (false alarms + correct rejections) = ${metrics.falseAlarms} / (${metrics.falseAlarms} + ${metrics.correctRejections}) = ${decimal(metrics.falseAlarmRate)}`,
    `Hc = (hits + 0.5) / (signal trials + 1) = (${metrics.hits} + 0.5) / (${metrics.signalTrials} + 1) = ${decimal(metrics.correctedHitRate)}`,
    `FAc = (false alarms + 0.5) / (catch trials + 1) = (${metrics.falseAlarms} + 0.5) / (${metrics.catchTrials} + 1) = ${decimal(metrics.correctedFalseAlarmRate)}`,
    `z(Hc) = ${decimal(metrics.hitZ)}; z(FAc) = ${decimal(metrics.falseAlarmZ)}`,
    `d-prime = z(Hc) - z(FAc) = ${decimal(metrics.hitZ)} - ${decimal(metrics.falseAlarmZ)} = ${decimal(metrics.dPrime)}`,
    `response bias = -[z(Hc) + z(FAc)] / 2 = -[${decimal(metrics.hitZ)} + ${decimal(metrics.falseAlarmZ)}] / 2 = ${decimal(metrics.responseBias)}`
  ];
}

// Peter J. Acklam's inverse-normal approximation, accurate for report metrics.
function inverseNormalCdf(probability: number): number {
  const p = Math.min(1 - 1e-12, Math.max(1e-12, probability));
  const a = [-39.6968302866538, 220.946098424521, -275.928510446969, 138.357751867269, -30.6647980661472, 2.50662827745924];
  const b = [-54.4760987982241, 161.585836858041, -155.698979859887, 66.8013118877197, -13.2806815528857];
  const c = [-0.00778489400243029, -0.322396458041136, -2.40075827716184, -2.54973253934373, 4.37466414146497, 2.93816398269878];
  const d = [0.00778469570904146, 0.32246712907004, 2.445134137143, 3.75440866190742];
  const low = 0.02425;
  const high = 1 - low;
  if (p < low) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5])
      / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > high) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5])
      / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  const q = p - 0.5;
  const r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q
    / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}
