import { APP_CONFIG, AUDIO_TEST_CONFIG } from '../../shared/config';
import {
  calculateSignalDetection, SIGNAL_DETECTION_DEFINITIONS, signalDetectionFormulaLines,
  type SignalDetectionMetrics
} from '../../shared/signalDetection';
import { jsPDF } from 'jspdf';
import { getLatestCompletedParticipantSessions, saveTestSession } from '../../shared/persistence';
import type { SessionData } from '../../shared/types';
import { exportCombinedPdf } from '../reports/combinedReport';
import { allAudioReferenceSections, type ReportReferenceSection } from '../../shared/reportReference';

type AudioTestState = 'IDLE' | 'PRE_TONE' | 'RESPONSE_WINDOW' | 'INTER_TRIAL' | 'PAUSED' | 'COMPLETE';
interface TrialPlan { frequencyHz: number | null; isCatch: boolean; }
interface AudioTrial extends TrialPlan {
  trialId: number; startedAt: string; toneStartedAtMs: number | null; toneEndedAtMs: number | null;
  responded: boolean; heard: boolean; falsePositive: boolean; responseAtMs: number | null; reactionTimeMs: number | null;
}
interface FalsePositiveEvent { at: string; performanceTimeMs: number; state: AudioTestState; reason: 'outside_response_window'; }
interface AudioSession {
  sessionId: string; startedAt: string; completedAt?: string; settings: Settings; trials: AudioTrial[];
  falsePositiveEvents: FalsePositiveEvent[]; disclaimer: string; userAgent: string;
  participant: { participantId: string; name: string; age: number; gender: string; notes?: string };
}
interface Settings { durationMs: number; responseWindowMs: number; gain: number; frequencyCount: number; catchCount: number; }

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const ui = {
  state: $('state'), progress: $('progress'), responses: $('responses'), falsePositives: $('falsePositives'),
  progressBar: $('progressBar'), instruction: $('instruction'), ack: $('ack'), chart: $<HTMLCanvasElement>('chart'),
  range: $('range'), missed: $('missed'), fpRate: $('fpRate'), strays: $('strays'),
  participant: $('audioParticipant'),
  hits: $('audioHits'), misses: $('audioMisses'), falseAlarms: $('audioFalseAlarms'), correctRejections: $('audioCorrectRejections'),
  hitRate: $('audioHitRate'), falseAlarmRate: $('audioFalseAlarmRate'), dPrime: $('audioDPrime'), bias: $('audioBias'),
  definitions: $('audioDefinitions'), formulaLines: $('audioFormulaLines'),
  reportReference: $('audioReportReference'),
  start: $<HTMLButtonElement>('start'), pause: $<HTMLButtonElement>('pause'), resume: $<HTMLButtonElement>('resume'),
  stop: $<HTMLButtonElement>('stop'), reset: $<HTMLButtonElement>('reset'),
  pdf: $<HTMLButtonElement>('pdf'), combinedPdf: $<HTMLButtonElement>('combinedPdf'),
  json: $<HTMLButtonElement>('json'), csv: $<HTMLButtonElement>('csv')
};

let context: AudioContext | null = null;
let oscillator: OscillatorNode | null = null;
let state: AudioTestState = 'IDLE';
let session: AudioSession | null = null;
let queue: TrialPlan[] = [];
let current: AudioTrial | null = null;
let timerIds = new Set<number>();
let completed = 0;
let persistenceTimer = 0;
const participant = readParticipant();

function settings(): Settings {
  const read = (id: string) => Number($<HTMLInputElement>(id).value);
  return { durationMs: read('durationMs'), responseWindowMs: read('responseWindowMs'), gain: read('gain'), frequencyCount: read('frequencyCount'), catchCount: read('catchCount') };
}

function setState(next: AudioTestState, instruction?: string): void {
  state = next; ui.state.textContent = next.replaceAll('_', ' ');
  if (instruction) ui.instruction.textContent = instruction;
  ui.pause.disabled = !['PRE_TONE','RESPONSE_WINDOW','INTER_TRIAL'].includes(next);
  ui.resume.disabled = next !== 'PAUSED';
  ui.stop.disabled = ['IDLE','COMPLETE'].includes(next);
}

async function start(): Promise<void> {
  if (!participant) return;
  if (!audioSettingsAreValid()) return;
  ui.start.disabled = true;
  const config = settings();
  try {
    context ??= new AudioContext();
    await context.resume();
  } catch (error) {
    ui.start.disabled = false;
    ui.instruction.textContent = `Audio could not start: ${error instanceof Error ? error.message : String(error)}`;
    return;
  }
  session = {
    sessionId: `audio-${new Date().toISOString().replaceAll(/[:.]/g, '-')}`, startedAt: new Date().toISOString(), settings: config,
    trials: [], falsePositiveEvents: [], disclaimer: APP_CONFIG.audioDisclaimer,
    userAgent: navigator.userAgent, participant
  };
  const frequencies = logarithmicFrequencies(
    AUDIO_TEST_CONFIG.minimumFrequencyHz, AUDIO_TEST_CONFIG.maximumFrequencyHz, config.frequencyCount
  ).map(frequencyHz => ({ frequencyHz, isCatch: false }));
  const catches = Array.from({ length: config.catchCount }, () => ({ frequencyHz: null, isCatch: true }));
  queue = shuffle([...frequencies, ...catches]); completed = 0; current = null;
  ui.start.disabled = true; setSessionExportsEnabled(false);
  updateMetrics(); drawChart(); persistSession(true); scheduleTrial(AUDIO_TEST_CONFIG.initialDelayMs);
}

function scheduleTrial(delay = random(AUDIO_TEST_CONFIG.interTrialDelayMs.min, AUDIO_TEST_CONFIG.interTrialDelayMs.max)): void {
  if (!session || state === 'PAUSED') return;
  if (!queue.length) { complete(); return; }
  setState('INTER_TRIAL', 'Wait quietly for the next possible tone.');
  addTimer(() => prepareTrial(), delay);
}

function prepareTrial(): void {
  if (!session || state === 'PAUSED') return;
  const plan = queue.shift()!;
  current = {
    ...plan, trialId: session.trials.length + 1, startedAt: new Date().toISOString(), toneStartedAtMs: null, toneEndedAtMs: null,
    responded: false, heard: false, falsePositive: false, responseAtMs: null, reactionTimeMs: null
  };
  session.trials.push(current);
  setState('PRE_TONE', 'Keep listening. Press Space only after hearing a beep.');
  addTimer(() => beginResponseWindow(), random(AUDIO_TEST_CONFIG.preToneDelayMs.min, AUDIO_TEST_CONFIG.preToneDelayMs.max));
}

function beginResponseWindow(): void {
  if (!session || !current || state === 'PAUSED') return;
  const onset = performance.now(); current.toneStartedAtMs = onset;
  if (!current.isCatch) playTone(current.frequencyHz!, session.settings.durationMs, session.settings.gain, current);
  setState('RESPONSE_WINDOW', 'Response window active.');
  addTimer(() => finishTrial(), session.settings.responseWindowMs);
}

function playTone(frequency: number, durationMs: number, amplitude: number, trial: AudioTrial): void {
  if (!context) return;
  oscillator?.stop();
  const source = context.createOscillator(); const gain = context.createGain();
  source.type = 'sine'; source.frequency.setValueAtTime(frequency, context.currentTime);
  const now = context.currentTime; const duration = durationMs / 1000;
  const attackSeconds = AUDIO_TEST_CONFIG.attackRampMs / 1000;
  const releaseSeconds = AUDIO_TEST_CONFIG.releaseRampMs / 1000;
  gain.gain.setValueAtTime(0, now); gain.gain.linearRampToValueAtTime(amplitude, now + attackSeconds);
  gain.gain.setValueAtTime(amplitude, Math.max(now + attackSeconds, now + duration - releaseSeconds));
  gain.gain.linearRampToValueAtTime(0, now + duration);
  source.connect(gain).connect(context.destination); source.start(now); source.stop(now + duration + 0.01); oscillator = source;
  source.addEventListener('ended', () => {
    trial.toneEndedAtMs = performance.now();
    if (oscillator === source) oscillator = null;
    persistSession();
  });
}

function handleSpace(): void {
  if (!session || state === 'IDLE' || state === 'COMPLETE') return;
  if (state !== 'RESPONSE_WINDOW' || !current || current.responded) {
    session.falsePositiveEvents.push({ at: new Date().toISOString(), performanceTimeMs: performance.now(), state, reason: 'outside_response_window' });
    pulse('FALSE POSITIVE', false); updateMetrics(); persistSession(); return;
  }
  const now = performance.now(); current.responded = true; current.responseAtMs = now;
  current.reactionTimeMs = current.toneStartedAtMs === null ? null : now - current.toneStartedAtMs;
  current.falsePositive = current.isCatch; current.heard = !current.isCatch;
  pulse(current.isCatch ? 'FALSE POSITIVE' : 'HEARD', !current.isCatch);
  finishTrial();
}

function finishTrial(): void {
  if (!current || state === 'PAUSED') return;
  clearTimers(); completed++; current = null;
  updateMetrics(); drawChart(); persistSession(); setState('INTER_TRIAL'); scheduleTrial();
}

function pause(): void { if (!session) return; clearTimers(); stopTone(); setState('PAUSED', 'Paused. A Space press while paused is recorded as a false positive.'); discardCurrentAudioTrial(true); persistSession(true); }
function resume(): void { if (state !== 'PAUSED') return; setState('INTER_TRIAL', 'Resumed. Listen for the next tone.'); scheduleTrial(AUDIO_TEST_CONFIG.initialDelayMs); }
function stop(): void { clearTimers(); stopTone(); discardCurrentAudioTrial(false); queue = []; setState('COMPLETE', 'Test stopped. Partial results are available.'); drawChart(); updateMetrics(); ui.start.disabled = false; setSessionExportsEnabled(true); persistSession(true); }
function complete(): void { clearTimers(); stopTone(); if (session) session.completedAt = new Date().toISOString(); setState('COMPLETE', 'Audio test complete. Review missed frequencies and false positives.'); drawChart(); updateMetrics(); ui.start.disabled = false; setSessionExportsEnabled(true); persistSession(true); }
function reset(): void { clearTimers(); stopTone(); discardCurrentAudioTrial(false); persistSession(true); session = null; queue = []; current = null; completed = 0; setState('IDLE', 'Starting enables browser audio. Some frequencies may be inaudible because of playback hardware limitations.'); ui.start.disabled = false; setSessionExportsEnabled(false); ui.combinedPdf.disabled = true; updateMetrics(); drawChart(); }

function updateMetrics(): void {
  const total = session ? session.settings.frequencyCount + session.settings.catchCount : settings().frequencyCount + settings().catchCount;
  const trials = session?.trials ?? []; const realResponses = trials.filter(t => t.heard).length;
  const catchFalsePositives = trials.filter(t => t.falsePositive).length; const strays = session?.falsePositiveEvents.length ?? 0;
  ui.progress.textContent = `${completed} / ${total}`; ui.progressBar.style.width = `${total ? completed / total * 100 : 0}%`;
  ui.responses.textContent = String(realResponses); ui.falsePositives.textContent = String(catchFalsePositives + strays); ui.strays.textContent = String(strays);
  const real = trials.filter(t => !t.isCatch && (t.responded || t.toneStartedAtMs !== null));
  const heard = real.filter(t => t.heard).map(t => t.frequencyHz!); const missed = real.filter(t => !t.heard).map(t => t.frequencyHz!);
  ui.range.textContent = heard.length ? `${formatHz(Math.min(...heard))} – ${formatHz(Math.max(...heard))}` : '—';
  ui.missed.textContent = missed.length ? missed.map(formatHz).join(', ') : real.length ? 'None observed' : '—';
  const completedCatches = trials.filter(t => t.isCatch && t.toneStartedAtMs !== null);
  ui.fpRate.textContent = completedCatches.length ? `${catchFalsePositives} / ${completedCatches.length} (${Math.round(catchFalsePositives / completedCatches.length * 100)}%)` : '—';
  const detection = audioDetectionMetrics();
  ui.hits.textContent = String(detection.hits); ui.misses.textContent = String(detection.misses);
  ui.falseAlarms.textContent = String(detection.falseAlarms); ui.correctRejections.textContent = String(detection.correctRejections);
  ui.hitRate.textContent = formatPercent(detection.hitRate); ui.falseAlarmRate.textContent = formatPercent(detection.falseAlarmRate);
  ui.dPrime.textContent = formatStatistic(detection.dPrime); ui.bias.textContent = formatStatistic(detection.responseBias);
  ui.formulaLines.innerHTML = signalDetectionFormulaLines(detection).map(line => `<code>${line}</code>`).join('');
}

function drawChart(): void {
  const canvas = ui.chart, ctx = canvas.getContext('2d')!; ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.fillStyle = '#f7f7f4'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  const plot = { left: 70, top: 35, width: 880, height: 300 };
  const frequencySpan = Math.log10(AUDIO_TEST_CONFIG.maximumFrequencyHz / AUDIO_TEST_CONFIG.minimumFrequencyHz);
  const x = (frequency: number) => plot.left + Math.log10(frequency / AUDIO_TEST_CONFIG.minimumFrequencyHz) / frequencySpan * plot.width;
  ctx.strokeStyle = '#d4d8d5'; ctx.lineWidth = 1; ctx.fillStyle = '#637077'; ctx.font = '12px ui-monospace, monospace'; ctx.textAlign = 'center';
  for (const frequency of AUDIO_TEST_CONFIG.chartFrequencyTicksHz) { const px = x(frequency); ctx.beginPath(); ctx.moveTo(px, plot.top); ctx.lineTo(px, plot.top + plot.height); ctx.stroke(); ctx.fillText(formatHz(frequency), px, plot.top + plot.height + 24); }
  ctx.fillStyle = '#637077'; ctx.fillText('Logarithmic frequency (Hz)', canvas.width / 2, canvas.height - 22);
  const records = session?.trials.filter(t => !t.isCatch && t.toneStartedAtMs !== null && t !== current) ?? [];
  for (const trial of records) { const px = x(trial.frequencyHz!); const py = trial.heard ? plot.top + 90 : plot.top + 225; ctx.fillStyle = trial.heard ? '#247354' : '#a9473e'; ctx.beginPath(); ctx.arc(px, py, 8, 0, Math.PI * 2); ctx.fill(); }
  ctx.textAlign = 'left'; ctx.fillStyle = '#247354'; ctx.fillText('● Heard', plot.left, plot.top + 94); ctx.fillStyle = '#a9473e'; ctx.fillText('● Not heard', plot.left, plot.top + 229);
}

function exportData(kind: 'json' | 'csv'): void {
  if (!session) return; let content: string; let mime: string;
  if (kind === 'json') { content = JSON.stringify({ ...session, signalDetection: audioDetectionMetrics() }, null, 2); mime = 'application/json'; }
  else {
    const head = 'participantId,participantName,participantAge,participantGender,trialId,frequencyHz,isCatch,responded,heard,falsePositive,reactionTimeMs,startedAt';
    content = [head, ...session.trials.map(t => [participant?.participantId, JSON.stringify(participant?.name ?? ''), participant?.age, participant?.gender, t.trialId,t.frequencyHz ?? '',t.isCatch,t.responded,t.heard,t.falsePositive,t.reactionTimeMs ?? '',t.startedAt].join(','))].join('\n'); mime = 'text/csv';
  }
  const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([content], { type: mime })); link.download = `${session.sessionId}.${kind}`; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

function exportPdf(): void {
  if (!session || !participant) return;
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  const detection = audioDetectionMetrics();
  pdf.setProperties({ title: `${session.sessionId} audio report`, subject: 'Experimental audio audibility report' });
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(18); pdf.text('Audio Audibility Research Report', 18, 18);
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9); pdf.setTextColor(80);
  pdf.text('Experimental prototype - not calibrated audiometry or a validated hearing assessment.', 18, 25);
  pdf.setTextColor(25); pdf.setFontSize(10);
  [
    `Participant: ${participant.name}`,
    `Participant ID: ${participant.participantId}`,
    `Age / gender: ${participant.age} / ${participant.gender}`,
    `Session: ${session.sessionId}`,
    `Started: ${new Date(session.startedAt).toLocaleString()}`
  ].forEach((line, index) => pdf.text(line, 18, 36 + index * 6));
  if (participant.notes) pdf.text(`Notes: ${participant.notes}`, 18, 69, { maxWidth: 175 });
  pdf.addImage(ui.chart.toDataURL('image/png'), 'PNG', 18, 78, 174, 73);
  drawAudioPdfMatrix(pdf, 18, 163, detection);
  pdf.setFontSize(9); pdf.setTextColor(40);
  pdf.text(`Observed range: ${ui.range.textContent ?? 'N/A'}`, 108, 167);
  const missedFrequencies = session.trials.filter(trial => !trial.isCatch && trial.toneStartedAtMs !== null && !trial.heard).map(trial => trial.frequencyHz!);
  pdf.text(`Missed tones: ${missedFrequencies.length}`, 108, 174);
  pdf.text(`Examples: ${missedFrequencies.length ? missedFrequencies.slice(0, 8).map(formatHz).join(', ') : 'none'}`, 108, 181, { maxWidth: 82 });
  pdf.text(`Outside-window false positives: ${session.falsePositiveEvents.length}`, 108, 195);
  pdf.text(`Tone / response window: ${session.settings.durationMs} / ${session.settings.responseWindowMs} ms`, 108, 202);
  pdf.text(`Digital gain: ${session.settings.gain}   tones / catches: ${session.settings.frequencyCount} / ${session.settings.catchCount}`, 108, 209);
  pdf.text(`Result status: ${session.completedAt ? 'complete' : 'partial'}`, 108, 216);
  pdf.setFontSize(8); pdf.setTextColor(90);
  pdf.text('d-prime and response bias use log-linear correction. Silent catch trials contain no tone.', 18, 239);
  pdf.text('Playback hardware and ambient noise strongly affect this uncalibrated result.', 18, 245);

  addAudioFormulaPage(pdf, detection);
  addReferencePages(pdf, allAudioReferenceSections());
  pdf.addPage(); pdf.setTextColor(25); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(15); pdf.text('Trial record', 18, 18);
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8);
  pdf.text('Trial', 18, 27); pdf.text('Frequency', 36, 27); pdf.text('Type', 70, 27); pdf.text('Response', 100, 27); pdf.text('Reaction', 138, 27);
  session.trials.forEach((trial, index) => {
    if (index && index % 32 === 0) { pdf.addPage(); }
    const row = index % 32; const y = 34 + row * 7.5;
    pdf.text(String(trial.trialId), 18, y); pdf.text(trial.isCatch ? '-' : `${formatHz(trial.frequencyHz!)} Hz`, 36, y);
    pdf.text(trial.isCatch ? 'Silent catch' : 'Tone', 70, y);
    pdf.text(trial.falsePositive ? 'False alarm' : trial.heard ? 'Heard' : trial.isCatch ? 'Correct reject' : 'Miss', 100, y);
    pdf.text(trial.reactionTimeMs === null ? '-' : `${trial.reactionTimeMs.toFixed(0)} ms`, 138, y);
  });
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

function addAudioFormulaPage(pdf: jsPDF, metrics: SignalDetectionMetrics): void {
  pdf.addPage(); pdf.setTextColor(25); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(15);
  pdf.text('Response definitions and formula values', 18, 18);
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9);
  SIGNAL_DETECTION_DEFINITIONS.forEach((line, index) => pdf.text(line, 18, 31 + index * 8));
  pdf.setFont('courier', 'normal'); pdf.setFontSize(8);
  signalDetectionFormulaLines(metrics).forEach((line, index) => {
    const wrapped = pdf.splitTextToSize(line, 174) as string[];
    pdf.text(wrapped, 18, 72 + index * 22);
  });
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8); pdf.setTextColor(90);
  pdf.text('Hc and FAc are corrected rates. z() is the standard normal inverse cumulative distribution.', 18, 245);
  pdf.text('Positive response bias indicates a more conservative response tendency; negative indicates a more liberal tendency.', 18, 252);
}

function drawAudioPdfMatrix(pdf: jsPDF, x: number, y: number, metrics: SignalDetectionMetrics): void {
  pdf.setTextColor(25); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(10); pdf.text('Signal detection response matrix', x, y - 5);
  const cells = [
    { label: 'Hit', value: metrics.hits, positive: true }, { label: 'False alarm', value: metrics.falseAlarms, positive: false },
    { label: 'Miss', value: metrics.misses, positive: false }, { label: 'Correct reject', value: metrics.correctRejections, positive: true }
  ];
  cells.forEach((cell, index) => {
    const cellX = x + (index % 2) * 40; const cellY = y + Math.floor(index / 2) * 18;
    const color = cell.positive ? [220, 233, 216] : [241, 222, 212];
    pdf.setFillColor(color[0], color[1], color[2]); pdf.rect(cellX, cellY, 40, 18, 'F');
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(7); pdf.text(cell.label, cellX + 2, cellY + 5);
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(11); pdf.text(String(cell.value), cellX + 20, cellY + 13, { align: 'center' });
  });
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8);
  pdf.text(`Hit rate ${formatPercent(metrics.hitRate)}   FA rate ${formatPercent(metrics.falseAlarmRate)}`, x, y + 42);
  pdf.text(`d-prime ${formatStatistic(metrics.dPrime)}   bias ${formatStatistic(metrics.responseBias)}`, x, y + 48);
}

function audioDetectionMetrics(): SignalDetectionMetrics {
  const completedTrials = (session?.trials ?? []).filter(trial => trial.toneStartedAtMs !== null && trial !== current);
  return calculateSignalDetection(completedTrials.map(trial => ({ signalPresent: !trial.isCatch, responded: trial.responded })));
}

function logarithmicFrequencies(min: number, max: number, count: number): number[] { return Array.from({ length: count }, (_, i) => Math.round(min * (max / min) ** (i / (count - 1)))); }
function shuffle<T>(items: T[]): T[] { for (let i = items.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [items[i], items[j]] = [items[j], items[i]]; } return items; }
function random(min: number, max: number): number { return min + Math.random() * (max - min); }
function addTimer(callback: () => void, delay: number): void { const id = window.setTimeout(() => { timerIds.delete(id); callback(); }, delay); timerIds.add(id); }
function clearTimers(): void { for (const id of timerIds) clearTimeout(id); timerIds.clear(); }
function stopTone(): void { try { oscillator?.stop(); } catch { /* already stopped */ } oscillator = null; }
function formatHz(value: number): string { return value >= 1000 ? `${Number((value / 1000).toFixed(value >= 10_000 ? 0 : 1))}k` : String(Math.round(value)); }
function formatPercent(value: number | null): string { return value === null ? 'N/A' : `${(value * 100).toFixed(1)}%`; }
function formatStatistic(value: number | null): string { return value === null ? 'N/A' : value.toFixed(2); }
function pulse(text: string, positive: boolean): void { ui.ack.textContent = text; ui.ack.classList.toggle('active', positive); window.setTimeout(() => { ui.ack.textContent = 'READY'; ui.ack.classList.remove('active'); }, 450); }
function readParticipant(): AudioSession['participant'] | null {
  try {
    const value = sessionStorage.getItem('vf-participant');
    return value ? JSON.parse(value) as AudioSession['participant'] : null;
  } catch { return null; }
}

function audioSettingsAreValid(): boolean {
  const invalid = ['durationMs','responseWindowMs','gain','frequencyCount','catchCount']
    .map(id => $<HTMLInputElement>(id))
    .find(input => !input.checkValidity() || !Number.isFinite(input.valueAsNumber));
  if (!invalid) return true;
  invalid.reportValidity();
  ui.instruction.textContent = 'Correct the highlighted audio setting before starting.';
  return false;
}

function discardCurrentAudioTrial(requeue: boolean): void {
  if (!session || !current) return;
  if (requeue) queue.unshift({ frequencyHz: current.frequencyHz, isCatch: current.isCatch });
  const index = session.trials.findIndex(trial => trial.trialId === current?.trialId);
  if (index >= 0) session.trials.splice(index, 1);
  current = null;
}

function setSessionExportsEnabled(enabled: boolean): void {
  ui.pdf.disabled = !enabled;
  ui.json.disabled = !enabled;
  ui.csv.disabled = !enabled;
}

function isTypingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (
    target.matches('input, textarea, select, button') || target.isContentEditable
  );
}

function persistSession(immediate = false): void {
  if (!session) return;
  window.clearTimeout(persistenceTimer);
  const save = () => {
    if (!session) return;
    void saveTestSession('audio', { ...session, signalDetection: audioDetectionMetrics() })
      .then(() => { if (session?.completedAt) void refreshCombinedAvailability(); })
      .catch(error => { ui.instruction.textContent = `Database save failed: ${error instanceof Error ? error.message : String(error)}`; });
  };
  if (immediate) save(); else persistenceTimer = window.setTimeout(save, 250);
}

async function refreshCombinedAvailability(): Promise<void> {
  if (!participant) { ui.combinedPdf.disabled = true; return; }
  try {
    const latest = await getLatestCompletedParticipantSessions(participant.participantId);
    ui.combinedPdf.disabled = !(latest.visual?.status === 'complete' && latest.audio?.status === 'complete');
  } catch { ui.combinedPdf.disabled = true; }
}

async function downloadCombined(): Promise<void> {
  if (!participant) return;
  const latest = await getLatestCompletedParticipantSessions(participant.participantId);
  if (!latest.visual || !latest.audio || latest.visual.status !== 'complete' || latest.audio.status !== 'complete') return;
  exportCombinedPdf(latest.visual.data as unknown as SessionData, latest.audio.data as never);
}

ui.start.addEventListener('click', () => void start()); ui.pause.addEventListener('click', pause); ui.resume.addEventListener('click', resume); ui.stop.addEventListener('click', stop); ui.reset.addEventListener('click', reset);
ui.pdf.addEventListener('click', exportPdf); ui.json.addEventListener('click', () => exportData('json')); ui.csv.addEventListener('click', () => exportData('csv'));
ui.combinedPdf.addEventListener('click', () => void downloadCombined().catch(error => { ui.instruction.textContent = `Combined report failed: ${error instanceof Error ? error.message : String(error)}`; }));
window.addEventListener('keydown', event => {
  if (event.code !== 'Space' || isTypingTarget(event.target)) return;
  event.preventDefault();
  if (!event.repeat) handleSpace();
});
for (const id of ['frequencyCount','catchCount']) $<HTMLInputElement>(id).addEventListener('change', updateMetrics);
function applyAudioConfigDefaults(): void {
  const values: Record<string, number> = {
    durationMs: AUDIO_TEST_CONFIG.toneDurationMs,
    responseWindowMs: AUDIO_TEST_CONFIG.responseWindowMs,
    gain: AUDIO_TEST_CONFIG.outputGain,
    frequencyCount: AUDIO_TEST_CONFIG.frequencyCount,
    catchCount: AUDIO_TEST_CONFIG.silentCatchTrialCount
  };
  for (const [id, value] of Object.entries(values)) $<HTMLInputElement>(id).value = String(value);
  const limitsByInputId = {
    durationMs: AUDIO_TEST_CONFIG.inputLimits.toneDurationMs,
    responseWindowMs: AUDIO_TEST_CONFIG.inputLimits.responseWindowMs,
    gain: AUDIO_TEST_CONFIG.inputLimits.outputGain,
    frequencyCount: AUDIO_TEST_CONFIG.inputLimits.frequencyCount,
    catchCount: AUDIO_TEST_CONFIG.inputLimits.silentCatchTrialCount
  };
  for (const [id, limits] of Object.entries(limitsByInputId)) {
    const input = $<HTMLInputElement>(id);
    input.min = String(limits.min); input.max = String(limits.max); input.step = String(limits.step);
  }
}
applyAudioConfigDefaults();
ui.definitions.innerHTML = SIGNAL_DETECTION_DEFINITIONS.map(line => `<p>${line}</p>`).join('');
ui.reportReference.replaceChildren(...allAudioReferenceSections().map(section => {
  const article = document.createElement('section');
  const heading = document.createElement('h3'); heading.textContent = section.title;
  const list = document.createElement('ul');
  list.replaceChildren(...section.lines.map(line => {
    const item = document.createElement('li'); item.textContent = line; return item;
  }));
  article.append(heading, list); return article;
}));
if (!participant) {
  ui.start.disabled = true;
  ui.instruction.innerHTML = 'Participant details are required. <a href="/">Return to participant intake</a> before starting this test.';
} else {
  ui.participant.textContent = `${participant.name} · ${participant.age} years · ${participant.participantId}`;
  ui.instruction.textContent = `Participant: ${participant.name} (${participant.participantId}). Starting enables browser audio; playback hardware affects results.`;
  void refreshCombinedAvailability();
}
updateMetrics(); drawChart();
