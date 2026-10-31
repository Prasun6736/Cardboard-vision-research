import type { Eye } from './types';

export const FIELD_MAP_REFERENCE = {
  score: 'Location scores use a 0-100 response scale: 100 = stimulus seen; 0 = stimulus not seen.',
  interpolation: 'Values between 0 and 100 in the grayscale field are interpolated estimates between tested locations, not additional measurements.',
  shading: 'Lighter shading indicates a higher response score; darker shading indicates a lower response score.',
  fixation: 'The center cross is fixation at 0°, 0°. Horizontal and vertical coordinates are visual-field degrees from fixation.',
  horizontal: 'Negative X coordinates are on the left side of the map; positive X coordinates are on the right side.',
  vertical: 'Superior is the upper visual field (+Y); inferior is the lower visual field (-Y).',
  temporal: 'Temporal means the side of the visual field away from the nose.',
  nasal: 'Nasal means the side of the visual field toward the nose.',
  limitation: 'Scores are experimental relative responses, not calibrated decibels, normative percentiles, or diagnostic classifications.'
} as const;

export interface FieldMapGlossaryEntry {
  term: string;
  definition: string;
}

/** Plain-language labels shown beside the maps. */
export const FIELD_MAP_GLOSSARY: readonly FieldMapGlossaryEntry[] = [
  {
    term: 'Visual field',
    definition: 'The area visible to one eye while the participant keeps looking at the center fixation mark. The map represents where a stimulus was presented within that area.'
  },
  {
    term: 'Fixation (0°, 0°)',
    definition: 'The center cross that the participant should keep looking at. Every test-location coordinate is measured in degrees away from this center.'
  },
  {
    term: 'Temporal field',
    definition: 'The outer side of the visual field, away from the nose and toward the temple or ear.'
  },
  {
    term: 'Nasal field',
    definition: 'The inner side of the visual field, toward the nose.'
  },
  {
    term: 'Superior field (+Y)',
    definition: 'The part of the visual field above fixation. It is displayed at the top of the map.'
  },
  {
    term: 'Inferior field (-Y)',
    definition: 'The part of the visual field below fixation. It is displayed at the bottom of the map.'
  },
  {
    term: 'Horizontal coordinate (X)',
    definition: 'The first coordinate. Negative X is left of the displayed center; positive X is right of the displayed center.'
  },
  {
    term: 'Vertical coordinate (Y)',
    definition: 'The second coordinate. Positive Y is above the displayed center; negative Y is below it.'
  },
  {
    term: 'Coordinate example',
    definition: '(−15°, +9°) means 15 degrees left and 9 degrees above fixation on the displayed map. Eye laterality determines whether the horizontal position is nasal or temporal.'
  },
  {
    term: 'Tested-location circle',
    definition: 'A circle marks a location where a stimulus was actually presented. The number inside is that location’s response score.'
  },
  {
    term: 'Score 100',
    definition: 'The stimulus at that tested location was seen during its single presentation.'
  },
  {
    term: 'Score 0',
    definition: 'The stimulus at that tested location was not seen during its single presentation.'
  },
  {
    term: 'Grayscale shading',
    definition: 'Lighter areas represent higher estimated response scores; darker areas represent lower estimated response scores.'
  },
  {
    term: 'Interpolated area',
    definition: 'Shading between tested circles is a calculated visual estimate from nearby points. Values such as 25, 50, and 75 are not separately tested locations.'
  }
] as const;

export const EYE_ORIENTATION_GLOSSARY: readonly FieldMapGlossaryEntry[] = [
  { term: 'Left-eye map', definition: 'The left side is temporal and the right side is nasal.' },
  { term: 'Right-eye map', definition: 'The left side is nasal and the right side is temporal.' }
] as const;

export function eyeOrientationReference(eye: Eye): string {
  return eye === 'left'
    ? 'Left eye: temporal field is on the left side of the map; nasal field is on the right.'
    : 'Right eye: nasal field is on the left side of the map; temporal field is on the right.';
}

export function fieldMapReportLines(eye: Eye): string[] {
  return [
    eyeOrientationReference(eye),
    `${FIELD_MAP_REFERENCE.temporal} ${FIELD_MAP_REFERENCE.nasal}`,
    `${FIELD_MAP_REFERENCE.vertical} ${FIELD_MAP_REFERENCE.fixation}`,
    FIELD_MAP_REFERENCE.horizontal,
    FIELD_MAP_REFERENCE.score,
    FIELD_MAP_REFERENCE.interpolation,
    `${FIELD_MAP_REFERENCE.shading} ${FIELD_MAP_REFERENCE.limitation}`
  ];
}
