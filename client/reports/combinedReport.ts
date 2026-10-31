import { jsPDF } from 'jspdf';
import { calculateSignalDetection, SIGNAL_DETECTION_DEFINITIONS, signalDetectionFormulaLines, type SignalDetectionMetrics } from '../../shared/signalDetection';
import type { Eye, SessionData } from '../../shared/types';
import { FIELD_MAP_REFERENCE, fieldMapReportLines } from '../../shared/fieldMapReference';
import { renderMap } from '../desktop/results';
import {
  allAudioReferenceSections, allVisualReferenceSections, type ReportReferenceSection
} from '../../shared/reportReference';

interface AudioTrialData {
  frequencyHz: number | null; isCatch: boolean; responded: boolean; heard: boolean;
  falsePositive: boolean; toneStartedAtMs: number | null;
}
interface AudioSessionData {
  sessionId: string; startedAt: string; completedAt?: string;
  participant: SessionData['participant']; trials: AudioTrialData[];
  falsePositiveEvents: unknown[];
  settings?: { durationMs: number; responseWindowMs: number; gain: number; frequencyCount: number; catchCount: number };
}

export function exportCombinedPdf(visual: SessionData, audio: AudioSessionData): void {
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
  const visualMetrics = (eye: Eye) => detection(visual.eyes[eye].trials.map(trial => ({ present: !trial.isCatch, response: trial.seen })));
  const completedAudio = audio.trials.filter(trial => trial.toneStartedAtMs !== null);
  const audioMetrics = detection(completedAudio.map(trial => ({ present: !trial.isCatch, response: trial.responded })));

  title(pdf, 'Combined Visual and Audio Research Report');
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(10); pdf.setTextColor(25);
  [
    `Participant: ${visual.participant.name}`,
    `Participant ID: ${visual.participant.participantId}`,
    `Age / gender: ${visual.participant.age} / ${visual.participant.gender}`,
    `Visual session: ${visual.sessionId}`,
    `Audio session: ${audio.sessionId}`,
    `Generated: ${new Date().toLocaleString()}`
  ].forEach((line, index) => pdf.text(line, 18, 38 + index * 7));
  pdf.setFontSize(8); pdf.setTextColor(90);
  pdf.text('Research prototype only. Visual output is not calibrated perimetry; audio output is not calibrated audiometry.', 18, 86, { maxWidth: 174 });

  drawMetrics(pdf, 18, 105, 'Left eye', visualMetrics('left'));
  drawMetrics(pdf, 108, 105, 'Right eye', visualMetrics('right'));
  drawMetrics(pdf, 18, 175, 'Audio', audioMetrics);
  const heard = completedAudio.filter(trial => !trial.isCatch && trial.heard).map(trial => trial.frequencyHz!);
  const missed = completedAudio.filter(trial => !trial.isCatch && !trial.heard).map(trial => trial.frequencyHz!);
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(10); pdf.setTextColor(25); pdf.text('Audio summary', 108, 175);
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8);
  pdf.text(`Heard tones: ${heard.length}`, 108, 185);
  pdf.text(`Missed tones: ${missed.length}`, 108, 192);
  pdf.text(`Observed range: ${heard.length ? `${formatHz(Math.min(...heard))} - ${formatHz(Math.max(...heard))}` : 'none'}`, 108, 199);
  pdf.text(`Outside-window responses: ${audio.falsePositiveEvents?.length ?? 0}`, 108, 206);
  pdf.text(`Visual: ${visual.completedAt ? 'complete' : 'partial'}; ${visual.settings.stimulusDurationMs} ms stimulus / ${visual.settings.responseWindowMs} ms response; 30 trials per eye planned`, 18, 248, { maxWidth: 174 });
  if (audio.settings) pdf.text(`Audio: ${audio.completedAt ? 'complete' : 'partial'}; ${audio.settings.durationMs} ms tone / ${audio.settings.responseWindowMs} ms response; gain ${audio.settings.gain}; ${audio.settings.frequencyCount} tones + ${audio.settings.catchCount} catches`, 18, 262, { maxWidth: 174 });

  for (const eye of ['left', 'right'] as Eye[]) {
    pdf.addPage(); title(pdf, `${eye === 'left' ? 'Left' : 'Right'} eye visual field`);
    const holder = document.createElement('div');
    renderMap(holder, visual.eyes[eye].thresholds, eye);
    const canvas = holder.querySelector('canvas');
    if (canvas) pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 18, 34, 174, 92);
    drawMapLegend(pdf, 18, 130);
    pdf.setTextColor(25); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(8); pdf.text('Field-map reference', 18, 148);
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(7.3);
    let referenceY = 154;
    for (const line of fieldMapReportLines(eye)) {
      const wrapped = pdf.splitTextToSize(line, 174) as string[];
      pdf.text(wrapped, 18, referenceY); referenceY += wrapped.length * 3.3 + 1.2;
    }
    drawMetrics(pdf, 18, referenceY + 5, `${eye} eye response analysis`, visualMetrics(eye));
  }

  pdf.addPage(); title(pdf, 'Definitions and formula values');
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8.5); pdf.setTextColor(25);
  SIGNAL_DETECTION_DEFINITIONS.forEach((line, index) => pdf.text(line, 18, 34 + index * 7));
  let y = 69;
  for (const [label, metrics] of [['LEFT EYE', visualMetrics('left')], ['RIGHT EYE', visualMetrics('right')], ['AUDIO', audioMetrics]] as const) {
    if (y + 78 > 280) { pdf.addPage(); title(pdf, 'Formula values continued'); y = 38; }
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(9); pdf.text(label, 18, y);
    pdf.setFont('courier', 'normal'); pdf.setFontSize(6.7);
    signalDetectionFormulaLines(metrics).forEach((line, index) => pdf.text(pdf.splitTextToSize(line, 172) as string[], 18, y + 7 + index * 10));
    y += 82;
  }
  addReferencePages(pdf, 'Visual reference and interpretation', allVisualReferenceSections());
  addReferencePages(pdf, 'Audio reference and interpretation', allAudioReferenceSections());
  pdf.save(`${visual.participant.participantId}-combined-report.pdf`);
}

function addReferencePages(pdf: jsPDF, heading: string, sections: readonly ReportReferenceSection[]): void {
  pdf.addPage();
  let y = 18;
  pdf.setTextColor(25); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(15); pdf.text(heading, 18, y); y += 12;
  for (const section of sections) {
    const required = 8 + section.lines.reduce((height, line) => height + (pdf.splitTextToSize(line, 168) as string[]).length * 4.1 + 2, 0);
    if (y + required > 279) { pdf.addPage(); title(pdf, `${heading} continued`); y = 38; }
    pdf.setTextColor(25); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(10); pdf.text(section.title, 18, y); y += 6;
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8); pdf.setTextColor(65);
    for (const line of section.lines) {
      const wrapped = pdf.splitTextToSize(`- ${line}`, 168) as string[];
      pdf.text(wrapped, 22, y); y += wrapped.length * 4.1 + 2;
    }
    y += 3;
  }
}

function drawMapLegend(pdf: jsPDF, x: number, y: number): void {
  const width = 80, segments = 40;
  for (let index = 0; index < segments; index++) {
    const shade = Math.round(28 + index / (segments - 1) * 227);
    pdf.setFillColor(shade, shade, shade); pdf.rect(x + index * width / segments, y, width / segments + 0.1, 5, 'F');
  }
  pdf.setDrawColor(150); pdf.rect(x, y, width, 5);
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(7); pdf.setTextColor(55);
  [0, 25, 50, 75, 100].forEach(value => pdf.text(String(value), x + width * value / 100, y + 10, { align: value === 0 ? 'left' : value === 100 ? 'right' : 'center' }));
  pdf.text(`Scale: 0 = not seen; 100 = seen. 25, 50, and 75 are interpolated shading. ${FIELD_MAP_REFERENCE.shading}`, x + width + 8, y + 4, { maxWidth: 85 });
}

function detection(items: { present: boolean; response: boolean }[]): SignalDetectionMetrics {
  return calculateSignalDetection(items.map(item => ({ signalPresent: item.present, responded: item.response })));
}

function title(pdf: jsPDF, text: string): void {
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(17); pdf.setTextColor(25); pdf.text(text, 18, 18);
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8); pdf.setTextColor(90); pdf.text('Experimental output - not for diagnosis or treatment decisions.', 18, 25);
}

function drawMetrics(pdf: jsPDF, x: number, y: number, label: string, metrics: SignalDetectionMetrics): void {
  pdf.setTextColor(25); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(10); pdf.text(label, x, y);
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(6.5); pdf.setTextColor(80);
  pdf.text('Stimulus present', x + 20, y + 6, { align: 'center' });
  pdf.text('Stimulus absent', x + 60, y + 6, { align: 'center' });
  const cells = [
    { name: 'Hit', value: metrics.hits, positive: true },
    { name: 'False alarm', value: metrics.falseAlarms, positive: false },
    { name: 'Miss', value: metrics.misses, positive: false },
    { name: 'Correct rejection', value: metrics.correctRejections, positive: true }
  ];
  cells.forEach((cell, index) => {
    const cellX = x + (index % 2) * 40;
    const cellY = y + 9 + Math.floor(index / 2) * 18;
    const color = cell.positive ? [220, 233, 216] : [241, 222, 212];
    pdf.setFillColor(color[0], color[1], color[2]);
    pdf.setDrawColor(190, 195, 190); pdf.rect(cellX, cellY, 40, 18, 'FD');
    pdf.setTextColor(40); pdf.setFont('helvetica', 'normal'); pdf.setFontSize(6.5);
    pdf.text(cell.name, cellX + 2, cellY + 5);
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(11);
    pdf.text(String(cell.value), cellX + 20, cellY + 13, { align: 'center' });
  });
  pdf.setTextColor(25); pdf.setFont('helvetica', 'normal'); pdf.setFontSize(7.5);
  pdf.text(`Hit rate ${percent(metrics.hitRate)}   FA rate ${percent(metrics.falseAlarmRate)}`, x, y + 50);
  pdf.text(`d-prime ${stat(metrics.dPrime)}   bias ${stat(metrics.responseBias)}`, x, y + 56);
}

function percent(value: number | null): string { return value === null ? 'N/A' : `${(value * 100).toFixed(1)}%`; }
function stat(value: number | null): string { return value === null ? 'N/A' : value.toFixed(2); }
function formatHz(value: number): string { return value >= 1000 ? `${Number((value / 1000).toFixed(1))} kHz` : `${Math.round(value)} Hz`; }
