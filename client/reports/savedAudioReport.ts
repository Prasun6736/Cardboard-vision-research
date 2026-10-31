import { jsPDF } from 'jspdf';
import { AUDIO_TEST_CONFIG } from '../../shared/config';
import { calculateSignalDetection, SIGNAL_DETECTION_DEFINITIONS, signalDetectionFormulaLines, type SignalDetectionMetrics } from '../../shared/signalDetection';
import { allAudioReferenceSections, type ReportReferenceSection } from '../../shared/reportReference';

export interface SavedAudioTrial {
  trialId: number; frequencyHz: number | null; isCatch: boolean; responded: boolean; heard: boolean;
  falsePositive: boolean; reactionTimeMs: number | null; toneStartedAtMs: number | null;
}
export interface SavedAudioSession {
  sessionId: string; startedAt: string; completedAt?: string;
  participant: { participantId: string; name: string; age: number; gender: string; notes?: string };
  settings: { durationMs: number; responseWindowMs: number; gain: number; frequencyCount: number; catchCount: number };
  trials: SavedAudioTrial[]; falsePositiveEvents: unknown[];
}

export function exportSavedAudioPdf(session: SavedAudioSession): void {
  const completed = session.trials.filter(trial => trial.toneStartedAtMs !== null);
  const metrics = calculateSignalDetection(completed.map(trial => ({ signalPresent: !trial.isCatch, responded: trial.responded })));
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(18); pdf.text('Audio Audibility Research Report', 18, 18);
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8.5); pdf.setTextColor(85);
  pdf.text('Experimental prototype - not calibrated audiometry or a validated hearing assessment.', 18, 25);
  pdf.setTextColor(25); pdf.setFontSize(10);
  [`Participant: ${session.participant.name}`, `Participant ID: ${session.participant.participantId}`,
    `Age / gender: ${session.participant.age} / ${session.participant.gender}`, `Session: ${session.sessionId}`,
    `Started: ${new Date(session.startedAt).toLocaleString()}`]
    .forEach((line, index) => pdf.text(line, 18, 36 + index * 6));
  const chart = audioChart(completed);
  pdf.addImage(chart.toDataURL('image/png'), 'PNG', 18, 72, 174, 73);
  drawMatrix(pdf, 18, 159, metrics);
  const heard = completed.filter(trial => !trial.isCatch && trial.heard).map(trial => trial.frequencyHz!);
  const missed = completed.filter(trial => !trial.isCatch && !trial.heard).map(trial => trial.frequencyHz!);
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(10); pdf.text('Audio summary', 108, 159);
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8);
  pdf.text(`Heard / missed tones: ${heard.length} / ${missed.length}`, 108, 168);
  pdf.text(`Observed range: ${heard.length ? `${formatHz(Math.min(...heard))} - ${formatHz(Math.max(...heard))}` : 'none'}`, 108, 175);
  pdf.text(`Outside-window responses: ${session.falsePositiveEvents?.length ?? 0}`, 108, 182);
  pdf.text(`Tone / response: ${session.settings.durationMs} / ${session.settings.responseWindowMs} ms`, 108, 189);
  pdf.text(`Gain: ${session.settings.gain}   tones / catches: ${session.settings.frequencyCount} / ${session.settings.catchCount}`, 108, 196);
  pdf.text(`Result status: ${session.completedAt ? 'complete' : 'partial'}`, 108, 203);

  pdf.addPage(); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(15); pdf.text('Definitions and formula values', 18, 18);
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8.5);
  SIGNAL_DETECTION_DEFINITIONS.forEach((line, index) => pdf.text(line, 18, 31 + index * 7));
  pdf.setFont('courier', 'normal'); pdf.setFontSize(7.5);
  signalDetectionFormulaLines(metrics).forEach((line, index) => pdf.text(pdf.splitTextToSize(line, 174) as string[], 18, 67 + index * 20));

  addReferencePages(pdf, allAudioReferenceSections());
  addTrialPages(pdf, session.trials);
  pdf.save(`${session.sessionId}.pdf`);
}

function addReferencePages(pdf: jsPDF, sections: readonly ReportReferenceSection[]): void {
  pdf.addPage();
  let y = 18;
  pdf.setTextColor(25); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(15);
  pdf.text('Reference and interpretation guide', 18, y); y += 12;
  for (const section of sections) {
    const required = 8 + section.lines.reduce((height, line) => height + (pdf.splitTextToSize(line, 168) as string[]).length * 4.1 + 2, 0);
    if (y + required > 279) { pdf.addPage(); y = 18; }
    pdf.setTextColor(25); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(10); pdf.text(section.title, 18, y); y += 6;
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8); pdf.setTextColor(65);
    for (const line of section.lines) {
      const wrapped = pdf.splitTextToSize(`- ${line}`, 168) as string[];
      pdf.text(wrapped, 22, y); y += wrapped.length * 4.1 + 2;
    }
    y += 3;
  }
}

function audioChart(trials: SavedAudioTrial[]): HTMLCanvasElement {
  const canvas = document.createElement('canvas'); canvas.width = 1000; canvas.height = 420;
  const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#f7f7f4'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  const plot = { left: 70, top: 35, width: 880, height: 300 };
  const span = Math.log10(AUDIO_TEST_CONFIG.maximumFrequencyHz / AUDIO_TEST_CONFIG.minimumFrequencyHz);
  const x = (frequency: number) => plot.left + Math.log10(frequency / AUDIO_TEST_CONFIG.minimumFrequencyHz) / span * plot.width;
  ctx.strokeStyle = '#d4d8d5'; ctx.fillStyle = '#637077'; ctx.font = '12px sans-serif'; ctx.textAlign = 'center';
  for (const frequency of AUDIO_TEST_CONFIG.chartFrequencyTicksHz) {
    const px = x(frequency); ctx.beginPath(); ctx.moveTo(px, plot.top); ctx.lineTo(px, plot.top + plot.height); ctx.stroke();
    ctx.fillText(formatHz(frequency), px, plot.top + plot.height + 24);
  }
  for (const trial of trials.filter(item => !item.isCatch)) {
    ctx.fillStyle = trial.heard ? '#247354' : '#a9473e'; ctx.beginPath();
    ctx.arc(x(trial.frequencyHz!), trial.heard ? plot.top + 90 : plot.top + 225, 8, 0, Math.PI * 2); ctx.fill();
  }
  ctx.textAlign = 'left'; ctx.fillStyle = '#247354'; ctx.fillText('Heard', plot.left, plot.top + 94);
  ctx.fillStyle = '#a9473e'; ctx.fillText('Not heard', plot.left, plot.top + 229);
  return canvas;
}

function drawMatrix(pdf: jsPDF, x: number, y: number, metrics: SignalDetectionMetrics): void {
  pdf.setTextColor(25); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(10); pdf.text('Response matrix', x, y);
  const cells = [{ label: 'Hit', value: metrics.hits, good: true }, { label: 'False alarm', value: metrics.falseAlarms, good: false },
    { label: 'Miss', value: metrics.misses, good: false }, { label: 'Correct rejection', value: metrics.correctRejections, good: true }];
  cells.forEach((cell, index) => {
    const cx = x + index % 2 * 40, cy = y + 5 + Math.floor(index / 2) * 18;
    const color = cell.good ? [220, 233, 216] : [241, 222, 212];
    pdf.setFillColor(color[0], color[1], color[2]); pdf.rect(cx, cy, 40, 18, 'F');
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(6.5); pdf.text(cell.label, cx + 2, cy + 5);
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(11); pdf.text(String(cell.value), cx + 20, cy + 13, { align: 'center' });
  });
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(7.5);
  pdf.text(`Hit rate ${percent(metrics.hitRate)}   FA rate ${percent(metrics.falseAlarmRate)}`, x, y + 47);
  pdf.text(`d-prime ${stat(metrics.dPrime)}   bias ${stat(metrics.responseBias)}`, x, y + 53);
}

function addTrialPages(pdf: jsPDF, trials: SavedAudioTrial[]): void {
  trials.forEach((trial, index) => {
    if (index % 32 === 0) {
      pdf.addPage(); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(15); pdf.text('Audio trial record', 18, 18);
      pdf.setFontSize(8); pdf.text('Trial', 18, 28); pdf.text('Frequency', 38, 28); pdf.text('Type', 75, 28); pdf.text('Response', 108, 28); pdf.text('Reaction', 150, 28);
    }
    const y = 36 + index % 32 * 7.5; pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8);
    pdf.text(String(trial.trialId), 18, y); pdf.text(trial.isCatch ? '-' : formatHz(trial.frequencyHz!), 38, y);
    pdf.text(trial.isCatch ? 'Silent catch' : 'Tone', 75, y);
    pdf.text(trial.falsePositive ? 'False alarm' : trial.heard ? 'Hit' : trial.isCatch ? 'Correct reject' : 'Miss', 108, y);
    pdf.text(trial.reactionTimeMs === null ? '-' : `${trial.reactionTimeMs.toFixed(0)} ms`, 150, y);
  });
}

function formatHz(value: number): string { return value >= 1000 ? `${Number((value / 1000).toFixed(1))} kHz` : `${Math.round(value)} Hz`; }
function percent(value: number | null): string { return value === null ? 'N/A' : `${(value * 100).toFixed(1)}%`; }
function stat(value: number | null): string { return value === null ? 'N/A' : value.toFixed(2); }
