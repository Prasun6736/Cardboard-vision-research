export type PersistedTestType = 'visual' | 'audio';

export interface StoredSession<T = Record<string, unknown>> {
  sessionId: string;
  participantId: string;
  testType: PersistedTestType;
  startedAt: string;
  completedAt: string | null;
  status: 'in_progress' | 'complete';
  updatedAt: string;
  data: T;
}

export interface LatestParticipantSessions {
  visual: StoredSession | null;
  audio: StoredSession | null;
}

export interface ParticipantHistorySummary {
  participantId: string; name: string; age: number; gender: string; notes: string | null;
  createdAt: string; updatedAt: string; sessionCount: number; completedSessionCount: number;
  latestSessionAt: string | null;
}

export type SessionHistoryItem = Omit<StoredSession, 'data'>;

let sessionSaveQueue: Promise<void> = Promise.resolve();

export async function saveTestSession(testType: PersistedTestType, session: object): Promise<void> {
  const body = JSON.stringify({ testType, session });
  const save = async () => {
    const response = await fetch('/api/sessions', { method: 'POST', headers: { 'content-type': 'application/json' }, body });
    if (!response.ok) throw new Error(await apiError(response));
  };
  const result = sessionSaveQueue.then(save, save);
  sessionSaveQueue = result.catch(() => undefined);
  return result;
}

export async function getLatestParticipantSessions(participantId: string): Promise<LatestParticipantSessions> {
  const response = await fetch(`/api/participants/${encodeURIComponent(participantId)}/latest`);
  if (!response.ok) throw new Error(await apiError(response));
  return response.json() as Promise<LatestParticipantSessions>;
}

export async function getLatestCompletedParticipantSessions(participantId: string): Promise<LatestParticipantSessions> {
  const response = await fetch(`/api/participants/${encodeURIComponent(participantId)}/latest-completed`);
  if (!response.ok) throw new Error(await apiError(response));
  return response.json() as Promise<LatestParticipantSessions>;
}

export async function getParticipantHistory(): Promise<ParticipantHistorySummary[]> {
  const response = await fetch('/api/participants');
  if (!response.ok) throw new Error(await apiError(response));
  return ((await response.json()) as { participants: ParticipantHistorySummary[] }).participants;
}

export async function getParticipantSessions(participantId: string): Promise<SessionHistoryItem[]> {
  const response = await fetch(`/api/participants/${encodeURIComponent(participantId)}/sessions`);
  if (!response.ok) throw new Error(await apiError(response));
  return ((await response.json()) as { sessions: SessionHistoryItem[] }).sessions;
}

export async function getStoredSession(sessionId: string): Promise<StoredSession> {
  const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`);
  if (!response.ok) throw new Error(await apiError(response));
  return response.json() as Promise<StoredSession>;
}

async function apiError(response: Response): Promise<string> {
  try { return ((await response.json()) as { error?: string }).error ?? `Request failed (${response.status})`; }
  catch { return `Request failed (${response.status})`; }
}
