import type { ServerMessage } from '../../shared/protocol';
import { APP_CONFIG, NETWORK_CONFIG, PARTICIPANT_CONFIG, VISUAL_TEST_CONFIG } from '../../shared/config';
import { PROTOTYPE_GRID, shuffledGrid, type TestPoint } from '../../shared/testGrid';
import { createStaircase, estimateThreshold, isThresholdComplete, updateStaircase, type StaircaseState } from '../../shared/thresholdAlgorithm';
import type { Eye, ParticipantInfo, SessionData, TestSettings, TestState, TrialCommand, TrialRecord } from '../../shared/types';
import { getLatestCompletedParticipantSessions, saveTestSession } from '../../shared/persistence';
import { EYE_ORIENTATION_GLOSSARY, FIELD_MAP_GLOSSARY } from '../../shared/fieldMapReference';
import { allVisualReferenceSections } from '../../shared/reportReference';
import { exportCombinedPdf } from '../reports/combinedReport';
import { exportCsv, exportJson, exportPdf, renderDetectionSummary, renderMap } from './results';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const ui = {
  state: $('state'), eye: $('eye'), progress: $('progress'), progressBar: $('progressBar'),
  connectionText: $('connectionText'), connectionDot: $('connectionDot').parentElement!,
  start: $<HTMLButtonElement>('start'), startRight: $<HTMLButtonElement>('startRight'),
  pause: $<HTMLButtonElement>('pause'), resume: $<HTMLButtonElement>('resume'),
  stop: $<HTMLButtonElement>('stop'), reset: $<HTMLButtonElement>('reset'), status: $('statusMessage'),
  pulse: $('responsePulse'), log: $('log'), leftMap: $('leftMap'), rightMap: $('rightMap'),
  leftDetection: $('leftDetection'), rightDetection: $('rightDetection'),
  exportPdf: $<HTMLButtonElement>('exportPdf'), exportCombined: $<HTMLButtonElement>('exportCombined'),
  exportJson: $<HTMLButtonElement>('exportJson'), exportCsv: $<HTMLButtonElement>('exportCsv')
};
const intake = {
  section: $('intake'), workspace: $('testWorkspace'), form: $<HTMLFormElement>('participantForm'),
  id: $<HTMLInputElement>('participantId'), name: $<HTMLInputElement>('participantName'), age: $<HTMLInputElement>('participantAge'),
  gender: $<HTMLSelectElement>('participantGender'), notes: $<HTMLTextAreaElement>('participantNotes'),
  summary: $('participantSummary'), edit: $<HTMLButtonElement>('editParticipant')
};

let socket: WebSocket;
let reconnectTimer = 0;
let peerConnected = false;
let state: TestState = 'IDLE';
let stateBeforePause: TestState = 'FIXATION';
let currentEye: Eye | null = null;
let session: SessionData | null = null;
let participant: ParticipantInfo | null = null;
let currentTrial: TrialRecord | null = null;
let currentPoint: TestPoint | null = null;
let trialId = 0;
let timers = new Set<number>();
let pointQueue: TestPoint[] = [];
let staircases = new Map<string, StaircaseState>();
let completedTrialCount = 0;
let persistenceTimer = 0;

function log(message: string): void {
  ui.log.textContent += `${new Date().toLocaleTimeString()}  ${message}\n`;
  ui.log.scrollTop = ui.log.scrollHeight;
}

function setState(next: TestState, message?: string): void {
  state = next;
  ui.state.textContent = next.replaceAll('_', ' ');
  if (message) ui.status.textContent = message;
  ui.pause.disabled = !['FIXATION','PRE_STIMULUS','STIMULUS','RESPONSE_WINDOW','INTER_TRIAL_INTERVAL'].includes(next);
  ui.resume.disabled = next !== 'PAUSED';
  ui.stop.disabled = ['IDLE','CONNECTED','BETWEEN_EYES','COMPLETE'].includes(next);
}

function send(message: object): boolean {
  if (socket?.readyState !== WebSocket.OPEN) { log('Cannot send: socket disconnected'); return false; }
  socket.send(JSON.stringify(message));
  return true;
}

function connect(): void {
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
  socket = new WebSocket(`${scheme}://${location.host}${NETWORK_CONFIG.websocketPath}`);
  socket.addEventListener('open', () => {
    send({ type: 'hello', role: 'desktop', clientId: crypto.randomUUID() });
    log('WebSocket connected');
  });
  socket.addEventListener('message', event => {
    let message: ServerMessage;
    try { message = JSON.parse(event.data) as ServerMessage; } catch { return; }
    handleMessage(message);
  });
  socket.addEventListener('close', () => {
    peerConnected = false;
    suspendForPhoneDisconnect();
    updateConnection();
    window.clearTimeout(reconnectTimer);
    reconnectTimer = window.setTimeout(connect, NETWORK_CONFIG.clientReconnectDelayMs);
  });
  socket.addEventListener('error', () => log('WebSocket error'));
}

function updateConnection(): void {
  ui.connectionText.textContent = peerConnected ? 'Phone connected' : 'Waiting for phone';
  ui.connectionDot.classList.toggle('connected', peerConnected);
  ui.start.disabled = !participant || !peerConnected || !['IDLE','CONNECTED','COMPLETE'].includes(state);
  ui.startRight.disabled = state !== 'BETWEEN_EYES' || !peerConnected;
  ui.resume.disabled = state !== 'PAUSED' || !peerConnected;
  if (peerConnected && state === 'IDLE') setState('CONNECTED', 'Phone connected. Keep fixation centered and start when ready.');
}

function suspendForPhoneDisconnect(): void {
  if (!['FIXATION','PRE_STIMULUS','STIMULUS','RESPONSE_WINDOW','INTER_TRIAL_INTERVAL'].includes(state)) return;
  clearTimers();
  discardCurrentTrial();
  setState('PAUSED', 'Phone disconnected. The uncertain trial was discarded and re-queued. Reconnect the phone, then resume.');
  log('Phone disconnected during testing; active trial discarded and re-queued.');
}

function handleMessage(message: ServerMessage): void {
  if (message.type === 'connected') { peerConnected = message.peerConnected; updateConnection(); return; }
  if (message.type === 'peerStatus' && message.role === 'phone') {
    peerConnected = message.connected;
    if (!message.connected) suspendForPhoneDisconnect();
    updateConnection(); return;
  }
  if (message.type === 'pong') return;
  if (message.type === 'error') { log(`ERROR ${message.code}: ${message.message}`); return; }
  if (message.type === 'stimulusResult') {
    const record = findTrial(message.trialId);
    if (record) applyStimulusResult(record, message);
    else log(`Unknown stimulus result for trial ${message.trialId}`);
    return;
  }
  if ('trialId' in message && currentTrial && message.trialId !== currentTrial.trialId) {
    log(`Late/foreign ${message.type} for trial ${message.trialId}`);
    return;
  }
  if (message.type === 'trialReceived') log(`Phone acknowledged trial ${message.trialId}`);
  if (message.type === 'stimulusShown' && currentTrial) {
    currentTrial.phoneShownAt = message.shownAt;
    currentTrial.desktopStimulusShownReceivedMs = performance.now();
    currentTrial.orientation = message.orientation;
    setState('STIMULUS', `Stimulus ${currentTrial.trialId} presented; response window open.`);
    const id = window.setTimeout(() => { if (currentTrial?.trialId === message.trialId) finishTrial(false); }, getSettings().responseWindowMs);
    timers.add(id);
    setState('RESPONSE_WINDOW');
  }
  if (message.type === 'stimulusHidden') log(`Trial ${message.trialId} hidden at phone t=${message.hiddenAt.toFixed(2)} ms`);
}

function applyStimulusResult(record: TrialRecord, result: Extract<ServerMessage, { type: 'stimulusResult' }>): void {
  record.phoneShownAt = result.shownAt;
  record.phoneHiddenAt = result.hiddenAt;
  record.actualDurationMs = result.actualDurationMs;
  record.orientation = result.orientation;
  log(`Trial ${record.trialId} actual duration ${result.actualDurationMs.toFixed(2)} ms`);
}

function getSettings(): TestSettings {
  const number = (id: string) => Number(($<HTMLInputElement>(id)).value);
  return {
    stimulusDurationMs: number('stimulusDurationMs'), responseWindowMs: number('responseWindowMs'),
    preStimulusMinMs: VISUAL_TEST_CONFIG.preStimulusDelayMs.min,
    preStimulusMaxMs: VISUAL_TEST_CONFIG.preStimulusDelayMs.max,
    interTrialMinMs: VISUAL_TEST_CONFIG.interTrialDelayMs.min,
    interTrialMaxMs: VISUAL_TEST_CONFIG.interTrialDelayMs.max,
    targetReversals: VISUAL_TEST_CONFIG.staircase.targetReversals,
    maxTrialsPerPoint: VISUAL_TEST_CONFIG.staircase.maximumTrialsPerPoint,
    calibration: {
      horizontalFovDeg: number('horizontalFovDeg'), verticalFovDeg: number('verticalFovDeg'),
      screenWidth: number('screenWidth'), screenHeight: number('screenHeight'), pixelRatio: number('pixelRatio'),
      stimulusDiameterDeg: number('stimulusDiameterDeg'), backgroundIntensity: number('backgroundIntensity'),
      maximumStimulusIntensity: number('maximumStimulusIntensity')
    }
  };
}

function startTest(): void {
  if (!peerConnected || !participant) return;
  if (!visualSettingsAreValid()) return;
  clearTimers();
  const settings = getSettings();
  session = {
    sessionId: `vf-${new Date().toISOString().replaceAll(/[:.]/g, '-')}`,
    startedAt: new Date().toISOString(),
    participant: { ...participant },
    device: {}, settings, disclaimer: APP_CONFIG.visualDisclaimer,
    eyes: { left: { trials: [], thresholds: [] }, right: { trials: [], thresholds: [] } }
  };
  trialId = 0; completedTrialCount = 0; staircases.clear();
  setSessionExportsEnabled(false); ui.start.disabled = true;
  renderMap(ui.leftMap, [], 'left'); renderMap(ui.rightMap, [], 'right');
  renderDetectionSummary(ui.leftDetection, []); renderDetectionSummary(ui.rightDetection, []);
  persistSession(true);
  beginEye('left');
}

function beginEye(eye: Eye): void {
  if (!session) return;
  currentEye = eye;
  setSessionExportsEnabled(false);
  ui.eye.textContent = eye.toUpperCase();
  const catchTrials: TestPoint[] = Array.from(
    { length: VISUAL_TEST_CONFIG.catchTrialsPerEye },
    () => ({ xDeg: 0, yDeg: 0, isCatch: true })
  );
  pointQueue = shuffledGrid([...PROTOTYPE_GRID, ...catchTrials]);
  send({ type: 'startTest', eye, calibration: session.settings.calibration });
  setState('FIXATION', `${eye === 'left' ? 'Left' : 'Right'} eye phase. Maintain central fixation.`);
  scheduleNextTrial(VISUAL_TEST_CONFIG.eyePhaseStartDelayMs);
}

function scheduleNextTrial(delay?: number): void {
  if (!session || !currentEye || state === 'PAUSED') return;
  if (!pointQueue.length) {
    if (currentEye === 'left') waitForRightEye(); else completeTest();
    return;
  }
  setState('FIXATION');
  const wait = delay ?? randomBetween(session.settings.interTrialMinMs, session.settings.interTrialMaxMs);
  const id = window.setTimeout(() => prepareTrial(), wait);
  timers.add(id);
}

function prepareTrial(): void {
  if (!session || !currentEye || state === 'PAUSED') return;
  currentPoint = pointQueue.shift()!;
  setState('PRE_STIMULUS', 'Randomized pre-stimulus interval…');
  const delay = randomBetween(session.settings.preStimulusMinMs, session.settings.preStimulusMaxMs);
  const id = window.setTimeout(() => dispatchTrial(), delay);
  timers.add(id);
}

function dispatchTrial(): void {
  if (!session || !currentEye || !currentPoint || state === 'PAUSED') return;
  const isCatch = Boolean(currentPoint.isCatch);
  const key = pointKey(currentEye, currentPoint);
  const staircase = isCatch ? null : (staircases.get(key) ?? createStaircase());
  if (staircase) staircases.set(key, staircase);
  const command: TrialCommand = {
    type: 'trial', trialId: ++trialId, eye: currentEye, xDeg: currentPoint.xDeg, yDeg: currentPoint.yDeg,
    intensity: staircase?.intensity ?? 0, durationMs: session.settings.stimulusDurationMs, isCatch
  };
  currentTrial = {
    trialId: command.trialId, eye: command.eye, xDeg: command.xDeg, yDeg: command.yDeg, intensity: command.intensity,
    isCatch: command.isCatch,
    requestedDurationMs: command.durationMs, trialStartedAt: new Date().toISOString(), desktopTrialStartMs: performance.now(),
    phoneShownAt: null, phoneHiddenAt: null, actualDurationMs: null, desktopStimulusShownReceivedMs: null,
    seen: false, desktopResponseAt: null, estimatedReactionTimeMs: null
  };
  session.eyes[currentEye].trials.push(currentTrial);
  setState('STIMULUS', `Sending trial ${command.trialId}…`);
  if (!send(command)) { suspendForPhoneDisconnect(); return; }
  const deliveryTimer = window.setTimeout(() => {
    if (currentTrial?.trialId !== command.trialId || currentTrial.phoneShownAt !== null) return;
    clearTimers(); discardCurrentTrial(); send({ type: 'pauseTest' });
    setState('PAUSED', 'Phone did not confirm presentation. The trial was discarded and re-queued; check the connection, then resume.');
    log(`Trial ${command.trialId} timed out before phone presentation confirmation.`);
  }, NETWORK_CONFIG.trialDeliveryTimeoutMs);
  timers.add(deliveryTimer);
}

function respond(): void {
  if (!currentTrial || state !== 'RESPONSE_WINDOW' || currentTrial.seen || currentTrial.desktopStimulusShownReceivedMs === null) return;
  const now = performance.now();
  const reaction = now - currentTrial.desktopStimulusShownReceivedMs;
  if (!session || reaction < 0 || reaction > session.settings.responseWindowMs) return;
  currentTrial.seen = true;
  currentTrial.desktopResponseAt = now;
  currentTrial.estimatedReactionTimeMs = reaction;
  ui.pulse.textContent = 'SEEN'; ui.pulse.classList.add('active');
  window.setTimeout(() => { ui.pulse.textContent = 'READY'; ui.pulse.classList.remove('active'); }, 300);
  finishTrial(true);
}

function finishTrial(seen: boolean): void {
  if (!session || !currentTrial || !currentPoint || !currentEye) return;
  const record = currentTrial;
  record.seen = seen;
  if (!currentPoint.isCatch) {
    const key = pointKey(currentEye, currentPoint);
    const next = updateStaircase(staircases.get(key)!, seen);
    staircases.set(key, next);
    if (isThresholdComplete(next, session.settings.targetReversals, session.settings.maxTrialsPerPoint)) {
      session.eyes[currentEye].thresholds.push({
        xDeg: currentPoint.xDeg, yDeg: currentPoint.yDeg,
        threshold: estimateThreshold(next), reversals: next.reversals, trials: next.trialCount,
        relativeSensitivity: seen ? 1 : 0
      });
      renderResults();
    } else {
      pointQueue.push(currentPoint);
    }
  }
  completedTrialCount++;
  log(record.isCatch
    ? `Trial ${record.trialId}: blank catch — ${seen ? 'false alarm' : 'correct rejection'}`
    : `Trial ${record.trialId}: ${seen ? 'seen' : 'not seen'} at ${record.xDeg}°, ${record.yDeg}° intensity ${record.intensity.toFixed(2)}`);
  renderDetectionSummary(
    currentEye === 'left' ? ui.leftDetection : ui.rightDetection,
    session.eyes[currentEye].trials
  );
  currentTrial = null; currentPoint = null;
  updateProgress();
  persistSession();
  if (state !== 'PAUSED') { setState('INTER_TRIAL_INTERVAL'); scheduleNextTrial(); }
}

function pauseTest(): void {
  if (['IDLE','CONNECTED','PAUSED','COMPLETE'].includes(state)) return;
  stateBeforePause = state; clearTimers(); setState('PAUSED', 'Paused. Any trial not yet presented was discarded and re-queued.');
  send({ type: 'pauseTest' });
  if (currentTrial?.phoneShownAt === null) discardCurrentTrial();
  else if (currentTrial) finishTrial(false);
  else if (currentPoint) { pointQueue.unshift(currentPoint); currentPoint = null; }
  persistSession(true);
}

function resumeTest(): void {
  if (state !== 'PAUSED') return;
  if (!peerConnected) { ui.status.textContent = 'Reconnect the phone before resuming.'; return; }
  send({ type: 'resumeTest' });
  setState(stateBeforePause === 'PAUSED' ? 'FIXATION' : 'FIXATION', 'Resumed. Re-establish central fixation.');
  scheduleNextTrial(VISUAL_TEST_CONFIG.eyePhaseStartDelayMs);
}

function stopTest(): void {
  clearTimers(); send({ type: 'stopTest' });
  discardCurrentTrial(); currentEye = null;
  setState('COMPLETE', 'Test stopped. Partial data can be exported.');
  setSessionExportsEnabled(true);
  ui.startRight.disabled = true;
  ui.eye.textContent = '—'; ui.start.disabled = !peerConnected;
  persistSession(true);
}

function waitForRightEye(): void {
  currentEye = null;
  send({ type: 'stopTest' });
  setState('BETWEEN_EYES', 'Left eye complete. Reposition the headset if needed, then start the right-eye test manually.');
  ui.eye.textContent = 'LEFT COMPLETE';
  ui.startRight.disabled = false;
  setSessionExportsEnabled(true);
  persistSession(true);
}

function startRightEye(): void {
  if (!session || state !== 'BETWEEN_EYES' || !peerConnected) return;
  ui.startRight.disabled = true;
  beginEye('right');
}

function completeTest(): void {
  if (!session) return;
  session.completedAt = new Date().toISOString();
  currentEye = null; send({ type: 'testComplete' });
  setState('COMPLETE', 'Both-eye test complete. Review and export the session data.');
  ui.startRight.disabled = true;
  ui.eye.textContent = 'BOTH COMPLETE'; ui.start.disabled = !peerConnected;
  setSessionExportsEnabled(true);
  renderResults();
  persistSession(true);
}

function resetTest(): void {
  clearTimers(); send({ type: 'resetTest' }); discardCurrentTrial(); persistSession(true);
  session = null; currentTrial = null; currentPoint = null; currentEye = null; trialId = 0; completedTrialCount = 0; staircases.clear();
  ui.eye.textContent = '—'; ui.progress.textContent = `0 / ${(PROTOTYPE_GRID.length + VISUAL_TEST_CONFIG.catchTrialsPerEye) * 2}`; ui.progressBar.style.width = '0%';
  ui.exportPdf.disabled = true; ui.exportJson.disabled = true; ui.exportCsv.disabled = true;
  ui.exportCombined.disabled = true;
  ui.startRight.disabled = true;
  renderMap(ui.leftMap, [], 'left'); renderMap(ui.rightMap, [], 'right');
  renderDetectionSummary(ui.leftDetection, []); renderDetectionSummary(ui.rightDetection, []);
  setState(peerConnected ? 'CONNECTED' : 'IDLE', 'Session reset.'); updateConnection();
}

function saveParticipant(event: SubmitEvent): void {
  event.preventDefault();
  intake.name.setCustomValidity(intake.name.value.trim() ? '' : 'Enter the participant full name.');
  intake.id.setCustomValidity(intake.id.value.trim() ? '' : 'Enter a participant ID.');
  if (!intake.form.reportValidity()) return;
  participant = {
    participantId: intake.id.value.trim(), name: intake.name.value.trim(), age: Number(intake.age.value),
    gender: intake.gender.value as ParticipantInfo['gender'], notes: intake.notes.value.trim() || undefined,
    recordedAt: new Date().toISOString()
  };
  sessionStorage.setItem('vf-participant', JSON.stringify(participant));
  intake.summary.textContent = `${participant.name} · ${participant.age} years · ${participant.participantId}`;
  intake.section.classList.add('hidden'); intake.workspace.classList.remove('hidden');
  void refreshCombinedAvailability();
  updateConnection();
}

function editParticipant(): void {
  if (!['IDLE','CONNECTED','COMPLETE'].includes(state)) {
    ui.status.textContent = 'Stop the active test before editing participant details.';
    return;
  }
  intake.workspace.classList.add('hidden'); intake.section.classList.remove('hidden');
  intake.name.focus();
}

function renderResults(): void {
  if (!session) return;
  renderMap(ui.leftMap, session.eyes.left.thresholds, 'left');
  renderMap(ui.rightMap, session.eyes.right.thresholds, 'right');
  renderDetectionSummary(ui.leftDetection, session.eyes.left.trials);
  renderDetectionSummary(ui.rightDetection, session.eyes.right.trials);
}

function updateProgress(): void {
  const total = (PROTOTYPE_GRID.length + VISUAL_TEST_CONFIG.catchTrialsPerEye) * 2;
  ui.progress.textContent = `${completedTrialCount} / ${total}`;
  ui.progressBar.style.width = `${completedTrialCount / total * 100}%`;
}

function clearTimers(): void { for (const id of timers) window.clearTimeout(id); timers.clear(); }
function randomBetween(min: number, max: number): number { return min + Math.random() * (max - min); }
function pointKey(eye: Eye, point: TestPoint): string { return `${eye}:${point.xDeg}:${point.yDeg}`; }
function findTrial(id: number): TrialRecord | undefined { return session ? [...session.eyes.left.trials, ...session.eyes.right.trials].find(t => t.trialId === id) : undefined; }
function isTypingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (
    target.matches('input, textarea, select, button') || target.isContentEditable
  );
}

function visualSettingsAreValid(): boolean {
  const ids = ['stimulusDurationMs','responseWindowMs','horizontalFovDeg','verticalFovDeg','screenWidth','screenHeight','pixelRatio','stimulusDiameterDeg','backgroundIntensity','maximumStimulusIntensity'];
  const invalid = ids.map(id => $<HTMLInputElement>(id)).find(input => !input.checkValidity() || !Number.isFinite(input.valueAsNumber));
  if (!invalid) return true;
  invalid.reportValidity();
  ui.status.textContent = 'Correct the highlighted test setting before starting.';
  return false;
}

function discardCurrentTrial(): void {
  if (!session || !currentEye) { currentTrial = null; currentPoint = null; return; }
  if (currentPoint) pointQueue.unshift(currentPoint);
  if (currentTrial) {
    const trials = session.eyes[currentEye].trials;
    const index = trials.findIndex(trial => trial.trialId === currentTrial?.trialId);
    if (index >= 0) trials.splice(index, 1);
  }
  currentTrial = null; currentPoint = null;
}

function setSessionExportsEnabled(enabled: boolean): void {
  ui.exportPdf.disabled = !enabled;
  ui.exportJson.disabled = !enabled;
  ui.exportCsv.disabled = !enabled;
}

function persistSession(immediate = false): void {
  if (!session) return;
  window.clearTimeout(persistenceTimer);
  const save = () => {
    if (!session) return;
    void saveTestSession('visual', session).then(() => {
      if (session?.completedAt) void refreshCombinedAvailability();
    }).catch(error => log(`Database save failed: ${error instanceof Error ? error.message : String(error)}`));
  };
  if (immediate) save(); else persistenceTimer = window.setTimeout(save, 250);
}

async function refreshCombinedAvailability(): Promise<void> {
  if (!participant) { ui.exportCombined.disabled = true; return; }
  try {
    const latest = await getLatestCompletedParticipantSessions(participant.participantId);
    ui.exportCombined.disabled = !(latest.visual?.status === 'complete' && latest.audio?.status === 'complete');
  } catch (error) {
    ui.exportCombined.disabled = true;
    log(`Could not check combined report: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function downloadCombined(): Promise<void> {
  if (!participant) return;
  const latest = await getLatestCompletedParticipantSessions(participant.participantId);
  if (!latest.visual || !latest.audio || latest.visual.status !== 'complete' || latest.audio.status !== 'complete') return;
  exportCombinedPdf(latest.visual.data as unknown as SessionData, latest.audio.data as never);
}

ui.start.addEventListener('click', startTest);
ui.startRight.addEventListener('click', startRightEye);
ui.pause.addEventListener('click', pauseTest);
ui.resume.addEventListener('click', resumeTest);
ui.stop.addEventListener('click', stopTest);
ui.reset.addEventListener('click', resetTest);
ui.exportPdf.addEventListener('click', () => session && exportPdf(session, ui.leftMap, ui.rightMap));
ui.exportCombined.addEventListener('click', () => void downloadCombined().catch(error => log(`Combined report failed: ${error instanceof Error ? error.message : String(error)}`)));
ui.exportJson.addEventListener('click', () => session && exportJson(session));
ui.exportCsv.addEventListener('click', () => session && exportCsv(session));
intake.form.addEventListener('submit', saveParticipant);
intake.edit.addEventListener('click', editParticipant);
$('clearLog').addEventListener('click', () => { ui.log.textContent = ''; });
window.addEventListener('keydown', event => {
  if (event.code !== 'Space' || isTypingTarget(event.target)) return;
  event.preventDefault();
  if (!event.repeat) respond();
});
window.setInterval(() => send({ type: 'ping', at: Date.now() }), NETWORK_CONFIG.clientHeartbeatIntervalMs);

function applyVisualConfigDefaults(): void {
  const values: Record<string, number> = {
    stimulusDurationMs: VISUAL_TEST_CONFIG.stimulusDurationMs,
    responseWindowMs: VISUAL_TEST_CONFIG.responseWindowMs,
    ...VISUAL_TEST_CONFIG.calibration
  };
  for (const [id, value] of Object.entries(values)) $<HTMLInputElement>(id).value = String(value);
  for (const [id, limits] of Object.entries(VISUAL_TEST_CONFIG.inputLimits)) {
    const input = $<HTMLInputElement>(id);
    input.min = String(limits.min); input.max = String(limits.max); input.step = String(limits.step);
  }
  intake.age.min = String(PARTICIPANT_CONFIG.minimumAge);
  intake.age.max = String(PARTICIPANT_CONFIG.maximumAge);
  intake.notes.maxLength = PARTICIPANT_CONFIG.maximumNotesLength;
}

function renderFieldMapReference(): void {
  const reference = $('fieldMapReference');
  reference.replaceChildren(...[...FIELD_MAP_GLOSSARY, ...EYE_ORIENTATION_GLOSSARY].map(entry => {
    const item = document.createElement('div');
    const term = document.createElement('strong'); term.textContent = entry.term;
    const definition = document.createElement('p'); definition.textContent = entry.definition;
    item.append(term, definition); return item;
  }));
}

function renderReportReference(): void {
  const target = $('visualReportReference');
  target.replaceChildren(...allVisualReferenceSections().map(section => {
    const article = document.createElement('section');
    const heading = document.createElement('h4'); heading.textContent = section.title;
    const list = document.createElement('ul');
    list.replaceChildren(...section.lines.map(line => {
      const item = document.createElement('li'); item.textContent = line; return item;
    }));
    article.append(heading, list); return article;
  }));
}

applyVisualConfigDefaults();
renderFieldMapReference();
renderReportReference();
const participantRandomId = Math.floor(
  PARTICIPANT_CONFIG.randomIdMinimum
  + Math.random() * (PARTICIPANT_CONFIG.randomIdMaximum - PARTICIPANT_CONFIG.randomIdMinimum + 1)
);
intake.id.value = `${PARTICIPANT_CONFIG.idPrefix}-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${participantRandomId}`;
updateProgress(); updateConnection(); connect();
