import { exportCombinedPdf } from '../reports/combinedReport';
import { exportSavedAudioPdf, type SavedAudioSession } from '../reports/savedAudioReport';
import { exportPdf as exportVisualPdf, renderMap } from '../desktop/results';
import {
  getLatestCompletedParticipantSessions, getParticipantHistory, getParticipantSessions, getStoredSession,
  type ParticipantHistorySummary, type SessionHistoryItem
} from '../../shared/persistence';
import type { SessionData } from '../../shared/types';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const ui = {
  search: $<HTMLInputElement>('search'), count: $('participantCount'), list: $('participantList'),
  empty: $('emptyState'), detail: $('participantDetail'), name: $('detailName'), meta: $('detailMeta'), notes: $('detailNotes'),
  sessions: $('sessionList'), combined: $<HTMLButtonElement>('combinedPdf'), status: $('status')
};
let participants: ParticipantHistorySummary[] = [];
let selected: ParticipantHistorySummary | null = null;

async function loadParticipants(): Promise<void> {
  try { participants = await getParticipantHistory(); renderParticipants(); }
  catch (error) { showError(error); }
}

function renderParticipants(): void {
  const query = ui.search.value.trim().toLocaleLowerCase();
  const filtered = participants.filter(item => !query || item.name.toLocaleLowerCase().includes(query) || item.participantId.toLocaleLowerCase().includes(query));
  ui.count.textContent = `${filtered.length} of ${participants.length} participant${participants.length === 1 ? '' : 's'}`;
  ui.list.replaceChildren(...filtered.map(item => {
    const button = document.createElement('button'); button.type = 'button'; button.className = `participant${selected?.participantId === item.participantId ? ' active' : ''}`;
    const name = document.createElement('strong'); name.textContent = item.name;
    const meta = document.createElement('span'); meta.textContent = `${item.participantId} · ${item.sessionCount} session${item.sessionCount === 1 ? '' : 's'}`;
    button.append(name, meta); button.addEventListener('click', () => void selectParticipant(item)); return button;
  }));
}

async function selectParticipant(item: ParticipantHistorySummary): Promise<void> {
  selected = item; renderParticipants(); ui.empty.hidden = true; ui.detail.hidden = false;
  ui.name.textContent = item.name; ui.meta.textContent = `${item.participantId} · ${item.age} years · ${item.gender}`;
  ui.notes.textContent = item.notes ? `Notes: ${item.notes}` : 'No participant notes.';
  ui.sessions.textContent = 'Loading sessions…'; ui.combined.disabled = true; ui.status.textContent = '';
  try {
    const [sessions, completed] = await Promise.all([getParticipantSessions(item.participantId), getLatestCompletedParticipantSessions(item.participantId)]);
    if (selected?.participantId !== item.participantId) return;
    renderSessions(sessions); ui.combined.disabled = !(completed.visual && completed.audio);
  } catch (error) { showError(error); }
}

function renderSessions(sessions: SessionHistoryItem[]): void {
  if (!sessions.length) { ui.sessions.textContent = 'No saved sessions.'; return; }
  ui.sessions.replaceChildren(...sessions.map(session => {
    const row = document.createElement('article'); row.className = 'session';
    const info = document.createElement('div'); const title = document.createElement('h3');
    title.textContent = `${session.testType} test`;
    const badge = document.createElement('span'); badge.className = `badge ${session.status}`; badge.textContent = session.status.replace('_', ' '); title.append(badge);
    const meta = document.createElement('p'); meta.textContent = `${new Date(session.startedAt).toLocaleString()} · ${session.sessionId}`; info.append(title, meta);
    const actions = document.createElement('div'); actions.className = 'session-actions';
    const pdf = actionButton('PDF report', () => void downloadSessionPdf(session));
    const json = actionButton('JSON data', () => void downloadSessionJson(session)); actions.append(pdf, json); row.append(info, actions); return row;
  }));
}

function actionButton(label: string, action: () => void): HTMLButtonElement {
  const button = document.createElement('button'); button.type = 'button'; button.textContent = label; button.addEventListener('click', action); return button;
}

async function downloadSessionPdf(item: SessionHistoryItem): Promise<void> {
  try {
    const stored = await getStoredSession(item.sessionId);
    if (stored.testType === 'audio') { exportSavedAudioPdf(stored.data as unknown as SavedAudioSession); return; }
    const visual = stored.data as unknown as SessionData;
    const left = document.createElement('div'), right = document.createElement('div');
    renderMap(left, visual.eyes.left.thresholds, 'left'); renderMap(right, visual.eyes.right.thresholds, 'right');
    exportVisualPdf(visual, left, right);
  } catch (error) { showError(error); }
}

async function downloadSessionJson(item: SessionHistoryItem): Promise<void> {
  try {
    const stored = await getStoredSession(item.sessionId); download(`${stored.sessionId}.json`, JSON.stringify(stored.data, null, 2));
  } catch (error) { showError(error); }
}

async function downloadCombined(): Promise<void> {
  if (!selected) return;
  try {
    const latest = await getLatestCompletedParticipantSessions(selected.participantId);
    if (!latest.visual || !latest.audio) return;
    exportCombinedPdf(latest.visual.data as unknown as SessionData, latest.audio.data as never);
  } catch (error) { showError(error); }
}

function download(name: string, value: string): void {
  const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([value], { type: 'application/json' }));
  link.download = name; link.click(); window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}
function showError(error: unknown): void { ui.status.textContent = error instanceof Error ? error.message : String(error); }

ui.search.addEventListener('input', renderParticipants);
ui.combined.addEventListener('click', () => void downloadCombined());
void loadParticipants();
