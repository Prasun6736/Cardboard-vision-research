import type { ServerMessage } from '../../shared/protocol';
import { NETWORK_CONFIG, VISUAL_TEST_CONFIG } from '../../shared/config';
import type { CalibrationSettings, Eye, OrientationSample, TrialCommand } from '../../shared/types';
import { StereoCanvasRenderer, type RenderStimulus } from './renderer';
import { ImmersivePresenter } from './vr';

const defaultCalibration: CalibrationSettings = {
  ...VISUAL_TEST_CONFIG.calibration,
  screenWidth: screen.width, screenHeight: screen.height, pixelRatio: devicePixelRatio
};
const canvas = document.getElementById('stereoCanvas') as HTMLCanvasElement;
const xrCanvas = document.getElementById('xrCanvas') as HTMLCanvasElement;
const overlay = document.getElementById('overlay')!;
const status = document.getElementById('status')!;
const badge = document.getElementById('eyeBadge')!;
const capability = document.getElementById('capability')!;
const enterButton = document.getElementById('enterDisplay') as HTMLButtonElement;
const renderer = new StereoCanvasRenderer(canvas, defaultCalibration);
const vr = new ImmersivePresenter(xrCanvas, defaultCalibration);

let socket: WebSocket;
let reconnectTimer = 0;
let activeEye: Eye | null = null;
let presentationToken = 0;
type WakeLockSentinelLike = { release(): Promise<void>; addEventListener(type: 'release', callback: () => void): void };
let wakeLock: WakeLockSentinelLike | null = null;
let latestOrientation: OrientationSample | null = null;
const handledTrials = new Set<number>();

function send(message: object): void {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function connect(): void {
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
  socket = new WebSocket(`${scheme}://${location.host}${NETWORK_CONFIG.websocketPath}`);
  socket.addEventListener('open', () => {
    status.textContent = 'Connected. Waiting for the desktop controller.';
    send({ type: 'hello', role: 'phone', clientId: getClientId(), device: {
      userAgent: navigator.userAgent, screenWidth: screen.width, screenHeight: screen.height, pixelRatio: devicePixelRatio
    }});
  });
  socket.addEventListener('message', event => {
    try { handleMessage(JSON.parse(event.data) as ServerMessage); }
    catch (error) { send({ type: 'error', code: 'PHONE_HANDLER', message: error instanceof Error ? error.message : 'Unknown phone error' }); }
  });
  socket.addEventListener('close', () => {
    status.textContent = 'Disconnected. Reconnecting…';
    clearTimeout(reconnectTimer); reconnectTimer = window.setTimeout(connect, NETWORK_CONFIG.clientReconnectDelayMs);
  });
}

function handleMessage(message: ServerMessage): void {
  if (message.type === 'connected') { status.textContent = message.peerConnected ? 'Desktop connected. Ready.' : 'Waiting for the desktop controller.'; return; }
  if (message.type === 'peerStatus' && message.role === 'desktop') { status.textContent = message.connected ? 'Desktop connected. Ready.' : 'Desktop disconnected. Waiting…'; return; }
  if (message.type === 'pong' || message.type === 'error') return;
  if (message.type === 'startTest') {
    if (message.eye === 'left') handledTrials.clear();
    configure(message.calibration); setEye(message.eye); overlay.classList.add('hidden');
    void requestWakeLock(); void document.documentElement.requestFullscreen?.().catch(() => undefined);
    return;
  }
  if (message.type === 'trial') { void presentTrial(message); return; }
  if (message.type === 'pauseTest') { cancelPresentation(); badge.textContent = 'PAUSED'; return; }
  if (message.type === 'resumeTest') { badge.textContent = `${activeEye?.toUpperCase() ?? ''} EYE`; drawFrame(); return; }
  if (message.type === 'stopTest' || message.type === 'resetTest' || message.type === 'testComplete') {
    cancelPresentation(); setEye(null); overlay.classList.remove('hidden'); badge.textContent = message.type === 'testComplete' ? 'COMPLETE' : 'IDLE';
    if (message.type === 'resetTest') handledTrials.clear();
  }
}

async function presentTrial(command: TrialCommand): Promise<void> {
  if (handledTrials.has(command.trialId)) {
    send({ type: 'trialReceived', trialId: command.trialId });
    send({ type: 'error', code: 'DUPLICATE_TRIAL', message: `Trial ${command.trialId} was already handled.`, trialId: command.trialId });
    return;
  }
  handledTrials.add(command.trialId);
  send({ type: 'trialReceived', trialId: command.trialId });
  if (command.eye !== activeEye) {
    send({ type: 'error', code: 'EYE_MISMATCH', message: `Active eye is ${activeEye}; trial requested ${command.eye}.`, trialId: command.trialId });
    return;
  }
  const token = ++presentationToken;
  const stimulus: RenderStimulus | null = command.isCatch
    ? null
    : { xDeg: command.xDeg, yDeg: command.yDeg, intensity: command.intensity };
  setStimulus(stimulus);
  requestDisplayFrame(shownAt => {
    if (token !== presentationToken) return;
    const orientation = latestOrientation;
    send({ type: 'stimulusShown', trialId: command.trialId, shownAt, orientation });
    window.setTimeout(() => {
      if (token !== presentationToken) return;
      setStimulus(null);
      requestDisplayFrame(hiddenAt => {
        if (token !== presentationToken) return;
        send({ type: 'stimulusHidden', trialId: command.trialId, hiddenAt });
        send({ type: 'stimulusResult', trialId: command.trialId, shownAt, hiddenAt, actualDurationMs: hiddenAt - shownAt, orientation });
      });
    }, command.durationMs);
  });
}

function configure(calibration: CalibrationSettings): void { renderer.configure(calibration); vr.configure(calibration); }
function setEye(eye: Eye | null): void {
  activeEye = eye; renderer.setActiveEye(eye); vr.setActiveEye(eye);
  badge.textContent = eye ? `${eye.toUpperCase()} EYE` : 'IDLE'; drawFrame();
}
function setStimulus(stimulus: RenderStimulus | null): void { renderer.setStimulus(stimulus); vr.setStimulus(stimulus); }
function cancelPresentation(): void { presentationToken++; setStimulus(null); drawFrame(); }
function drawFrame(): void { if (vr.isActive()) vr.requestFrame(() => undefined); else renderer.draw(); }
function requestDisplayFrame(callback: (timestamp: number) => void): void { vr.requestFrame(timestamp => { if (!vr.isActive()) renderer.draw(); callback(timestamp); }); }

async function enterDisplay(): Promise<void> {
  enterButton.disabled = true;
  try {
    if (await vr.enter()) {
      capability.textContent = 'WebXR immersive-vr session active.'; overlay.classList.add('hidden'); drawFrame();
    } else {
      await document.documentElement.requestFullscreen?.();
      capability.textContent = 'Fullscreen stereo Canvas fallback active.'; overlay.classList.add('hidden');
    }
    await requestWakeLock();
  } catch {
    capability.textContent = 'Immersive mode was declined; stereo Canvas remains active.';
  } finally { enterButton.disabled = false; }
}

async function requestWakeLock(): Promise<void> {
  const nav = navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<WakeLockSentinelLike> } };
  if (!nav.wakeLock || wakeLock) return;
  const sentinel = await nav.wakeLock.request('screen').catch(() => null);
  if (!sentinel) return;
  wakeLock = sentinel;
  sentinel.addEventListener('release', () => { if (wakeLock === sentinel) wakeLock = null; });
}

function getClientId(): string {
  const key = 'vf-phone-client-id'; let value = localStorage.getItem(key);
  if (!value) { value = crypto.randomUUID(); localStorage.setItem(key, value); }
  return value;
}

window.addEventListener('deviceorientation', event => {
  latestOrientation = { alpha: event.alpha, beta: event.beta, gamma: event.gamma };
});
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void requestWakeLock(); });
enterButton.addEventListener('click', () => void enterDisplay());
window.setInterval(() => send({ type: 'ping', at: Date.now() }), NETWORK_CONFIG.clientHeartbeatIntervalMs);

void vr.supported().then(supported => { capability.textContent = supported ? 'WebXR immersive-vr is available.' : 'WebXR unavailable; fullscreen stereo Canvas will be used.'; });
connect();
