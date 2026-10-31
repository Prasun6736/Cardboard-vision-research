import { AUDIO_TEST_CONFIG, VISUAL_TEST_CONFIG } from './config';

export interface ReportReferenceSection {
  title: string;
  lines: readonly string[];
}

export const RESPONSE_REFERENCE_SECTIONS: readonly ReportReferenceSection[] = [
  {
    title: 'Response classification',
    lines: [
      'Hit: a stimulus or tone was present and the participant responded inside the response window.',
      'Miss: a stimulus or tone was present and no response was recorded inside the response window.',
      'False alarm: no stimulus or tone was presented during a catch trial, but the participant responded.',
      'Correct rejection: no stimulus or tone was presented during a catch trial and no response was recorded.',
      'Outside-window response: a response made before or after an active response window; reported separately as a stray false-positive event.'
    ]
  },
  {
    title: 'Rates and statistical measures',
    lines: [
      'Hit rate (H) = hits / (hits + misses). False-alarm rate (FA) = false alarms / (false alarms + correct rejections).',
      'Corrected rates use the log-linear 0.5 adjustment: Hc = (hits + 0.5) / (signal trials + 1), and FAc = (false alarms + 0.5) / (catch trials + 1).',
      'd-prime = z(Hc) - z(FAc). A larger value indicates stronger separation between present and absent trials within this session.',
      'Response bias = -[z(Hc) + z(FAc)] / 2. Positive values indicate a more conservative response tendency; negative values indicate a more liberal tendency; values near zero indicate a more balanced tendency.',
      'No validated normal/abnormal cutoff is assigned to d-prime, response bias, or response rates in this prototype.'
    ]
  },
  {
    title: 'Reliability and interpretation',
    lines: [
      'Catch trials estimate response reliability because no signal is presented. More false alarms or stray responses can reduce confidence in the observed pattern.',
      'A completed result means the configured trial sequence finished. A partial result means the test was stopped before all planned trials finished.',
      'Results describe responses recorded in this session only and must be interpreted with test conditions, participant understanding, fixation or listening behavior, and equipment limitations.'
    ]
  }
] as const;

export const VISUAL_REFERENCE_SECTIONS: readonly ReportReferenceSection[] = [
  {
    title: 'Visual protocol',
    lines: [
      `Each eye has ${VISUAL_TEST_CONFIG.gridXDegrees.length * VISUAL_TEST_CONFIG.gridYDegrees.length} stimulus-present locations and ${VISUAL_TEST_CONFIG.catchTrialsPerEye} blank catch trials (${VISUAL_TEST_CONFIG.gridXDegrees.length * VISUAL_TEST_CONFIG.gridYDegrees.length + VISUAL_TEST_CONFIG.catchTrialsPerEye} trials per eye).`,
      `Each stimulus is scheduled for ${VISUAL_TEST_CONFIG.stimulusDurationMs} ms with a ${VISUAL_TEST_CONFIG.responseWindowMs} ms response window unless the operator changes those settings.`,
      'The left eye and right eye are run as separate phases. The operator starts the right-eye phase manually, and the eye not being tested is shown a black screen.',
      'Each tested location is presented once. The output is therefore a binary response map, not a repeated staircase threshold estimate.'
    ]
  },
  {
    title: 'Field-map scale and orientation',
    lines: [
      'Visual field means the area visible to one eye while the participant keeps looking at the center fixation mark.',
      'Fixation is the center cross at 0 degrees horizontal and 0 degrees vertical. Every coordinate is measured in degrees away from fixation.',
      'Location score 100 means the stimulus was seen; score 0 means it was not seen.',
      'A tested-location circle marks a position where a stimulus was actually presented; the number inside the circle is that location’s response score.',
      'Lighter grayscale indicates a higher response score and darker grayscale indicates a lower response score. Values between tested locations are interpolated estimates, not additional observations.',
      'Temporal is the outer visual field away from the nose and toward the temple or ear. Nasal is the inner visual field toward the nose.',
      'Superior is above fixation and is shown at the top (+Y). Inferior is below fixation and is shown at the bottom (-Y).',
      'X is the horizontal coordinate: negative X is left of the displayed center and positive X is right. Y is the vertical coordinate: positive Y is above and negative Y is below.',
      'For example, (-15 degrees, +9 degrees) is 15 degrees left and 9 degrees above fixation on the displayed map.',
      'Left-eye map: temporal is left and nasal is right. Right-eye map: nasal is left and temporal is right.',
      'The 0-100 score is a relative response display. It is not a decibel threshold, normative percentile, probability of disease, or diagnostic category.'
    ]
  },
  {
    title: 'Visual limitations',
    lines: [
      'Display RGB intensity is not calibrated luminance, and headset optics, screen brightness, ambient light, viewing alignment, and fixation can change stimulus visibility.',
      'The prototype does not include gaze tracking, automated fixation-loss measurement, blind-spot localization, age-matched norms, probability plots, or defect classification.',
      'A missed location may reflect visibility, fixation, attention, response timing, device presentation, or test conditions; it does not by itself establish a diagnosis.'
    ]
  }
] as const;

export const AUDIO_REFERENCE_SECTIONS: readonly ReportReferenceSection[] = [
  {
    title: 'Audio protocol',
    lines: [
      `The configured sequence contains ${AUDIO_TEST_CONFIG.frequencyCount} tone trials from ${AUDIO_TEST_CONFIG.minimumFrequencyHz} Hz to ${AUDIO_TEST_CONFIG.maximumFrequencyHz / 1000} kHz plus ${AUDIO_TEST_CONFIG.silentCatchTrialCount} silent catch trials.`,
      `Frequencies are logarithmically spaced. Each tone is scheduled for ${AUDIO_TEST_CONFIG.toneDurationMs} ms with a ${AUDIO_TEST_CONFIG.responseWindowMs} ms response window unless the operator changes those settings.`,
      'A Space response during an active tone trial records heard; no response records not heard. A response to a silent catch trial is a false alarm.'
    ]
  },
  {
    title: 'Audio chart and summary',
    lines: [
      'The horizontal chart axis is logarithmic frequency in hertz (Hz); equal horizontal distances represent equal frequency ratios, not equal Hz increments.',
      'Observed range is the lowest through highest presented frequency with a recorded response. It does not imply that every frequency between those endpoints was heard.',
      'Missed frequencies are presented tones without an in-window response. A missed tone can reflect hearing, playback hardware, volume, ambient noise, attention, timing, or browser/device limitations.',
      'Digital gain is a browser amplitude setting. It is not calibrated sound-pressure level, dB SPL, or dB HL.'
    ]
  },
  {
    title: 'Audio limitations and safety',
    lines: [
      'Headphones, speakers, operating-system processing, browser behavior, device volume, and ambient noise strongly affect the result, especially near frequency extremes.',
      'The prototype does not measure ear-specific thresholds, calibrated intensity thresholds, bone conduction, masking, speech response, or middle-ear function.',
      'Use a quiet setting and a low, comfortable volume. Stop if sound is uncomfortable. Do not raise volume to force detection of extreme frequencies.',
      'This output is an experimental response record and does not establish hearing status or a diagnosis.'
    ]
  }
] as const;

export function allVisualReferenceSections(): readonly ReportReferenceSection[] {
  return [...VISUAL_REFERENCE_SECTIONS, ...RESPONSE_REFERENCE_SECTIONS];
}

export function allAudioReferenceSections(): readonly ReportReferenceSection[] {
  return [...AUDIO_REFERENCE_SECTIONS, ...RESPONSE_REFERENCE_SECTIONS];
}
