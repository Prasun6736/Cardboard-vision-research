import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import initSqlJs, { type Database, type SqlValue } from 'sql.js';
import { PARTICIPANT_CONFIG, SERVER_CONFIG } from '../shared/config';

export type StoredTestType = 'visual' | 'audio';
export interface StoredSession {
  sessionId: string; participantId: string; testType: StoredTestType; startedAt: string;
  completedAt: string | null; status: 'in_progress' | 'complete'; updatedAt: string; data: Record<string, unknown>;
}
export interface ParticipantSummary {
  participantId: string; name: string; age: number; gender: string; notes: string | null;
  createdAt: string; updatedAt: string; sessionCount: number; completedSessionCount: number; latestSessionAt: string | null;
}
type SessionPayload = Record<string, unknown> & {
  sessionId: string; startedAt: string; completedAt?: string;
  participant: { participantId: string; name: string; age: number; gender: string; notes?: string };
};

export async function createDatabase(projectRoot: string) {
  const directory = path.join(projectRoot, SERVER_CONFIG.dataDirectory);
  fs.mkdirSync(directory, { recursive: true });
  const databasePath = path.join(directory, SERVER_CONFIG.databaseFile);
  const backupPath = path.join(directory, SERVER_CONFIG.databaseBackupFile);
  const sqliteDistribution = fileURLToPath(new URL('../node_modules/sql.js/dist/', import.meta.url));
  const sqlite = await initSqlJs({ locateFile: file => path.join(sqliteDistribution, file) });
  const opened = openDatabase(sqlite, databasePath, backupPath);
  const { database, existed } = opened;
  let recoveredFromBackup = opened.recoveredFromBackup;
  database.run('PRAGMA foreign_keys = ON');
  database.run(`
    CREATE TABLE IF NOT EXISTS participants (
      participant_id TEXT PRIMARY KEY, name TEXT NOT NULL, age INTEGER NOT NULL, gender TEXT NOT NULL,
      notes TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS test_sessions (
      session_id TEXT PRIMARY KEY, participant_id TEXT NOT NULL REFERENCES participants(participant_id),
      test_type TEXT NOT NULL CHECK(test_type IN ('visual', 'audio')), started_at TEXT NOT NULL,
      completed_at TEXT, status TEXT NOT NULL CHECK(status IN ('in_progress', 'complete')),
      data_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_participant_type
      ON test_sessions(participant_id, test_type, updated_at DESC);
  `);

  function persist(): void {
    const temporaryPath = `${databasePath}.tmp`;
    fs.writeFileSync(temporaryPath, Buffer.from(database.export()));
    if (!recoveredFromBackup && fs.existsSync(databasePath) && fs.statSync(databasePath).size > 0) fs.copyFileSync(databasePath, backupPath);
    fs.renameSync(temporaryPath, databasePath);
    recoveredFromBackup = false;
  }
  if (!existed) persist();

  return {
    databasePath,
    saveSession(testType: StoredTestType, session: SessionPayload): void {
      validateSession(testType, session);
      const now = new Date().toISOString();
      database.run('BEGIN');
      try {
        database.run(`INSERT INTO participants (participant_id, name, age, gender, notes, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(participant_id) DO UPDATE SET name=excluded.name,
          age=excluded.age, gender=excluded.gender, notes=excluded.notes, updated_at=excluded.updated_at`,
        [session.participant.participantId, session.participant.name, session.participant.age,
          session.participant.gender, session.participant.notes ?? null, now, now]);
        database.run(`INSERT INTO test_sessions (session_id, participant_id, test_type, started_at, completed_at,
          status, data_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(session_id) DO UPDATE SET participant_id=excluded.participant_id,
          test_type=excluded.test_type, started_at=excluded.started_at, completed_at=excluded.completed_at,
          status=excluded.status, data_json=excluded.data_json, updated_at=excluded.updated_at`,
        [session.sessionId, session.participant.participantId, testType, session.startedAt,
          session.completedAt ?? null, session.completedAt ? 'complete' : 'in_progress', JSON.stringify(session), now, now]);
        database.run('COMMIT');
      } catch (error) { database.run('ROLLBACK'); throw error; }
      persist();
    },
    getSession(sessionId: string): StoredSession | null {
      return mapSession(queryOne(database, 'SELECT * FROM test_sessions WHERE session_id = ?', [sessionId]));
    },
    getLatestSessions(participantId: string) { return latestPair(database, participantId, false); },
    getLatestCompletedSessions(participantId: string) { return latestPair(database, participantId, true); },
    listParticipantSessions(participantId: string): Omit<StoredSession, 'data'>[] {
      return queryAll(database, `SELECT session_id, participant_id, test_type, started_at, completed_at, status, updated_at
        FROM test_sessions WHERE participant_id = ? ORDER BY updated_at DESC`, [participantId]).map(mapSessionMetadata);
    },
    listParticipants(): ParticipantSummary[] {
      return queryAll(database, `SELECT p.participant_id, p.name, p.age, p.gender, p.notes, p.created_at, p.updated_at,
        COUNT(s.session_id) AS session_count,
        SUM(CASE WHEN s.status = 'complete' THEN 1 ELSE 0 END) AS completed_session_count,
        MAX(s.updated_at) AS latest_session_at FROM participants p
        LEFT JOIN test_sessions s ON s.participant_id = p.participant_id GROUP BY p.participant_id
        ORDER BY COALESCE(MAX(s.updated_at), p.updated_at) DESC LIMIT ?`, [SERVER_CONFIG.maximumParticipantHistoryRows]).map(row => ({
        participantId: text(row.participant_id), name: text(row.name), age: numeric(row.age), gender: text(row.gender),
        notes: nullableText(row.notes), createdAt: text(row.created_at), updatedAt: text(row.updated_at),
        sessionCount: numeric(row.session_count), completedSessionCount: numeric(row.completed_session_count),
        latestSessionAt: nullableText(row.latest_session_at)
      }));
    }
  };
}

function openDatabase(sqlite: Awaited<ReturnType<typeof initSqlJs>>, databasePath: string, backupPath: string): { database: Database; existed: boolean; recoveredFromBackup: boolean } {
  const candidates = [databasePath, backupPath].filter(candidate => fs.existsSync(candidate) && fs.statSync(candidate).size > 0);
  for (const candidate of candidates) {
    let database: Database | null = null;
    try {
      database = new sqlite.Database(new Uint8Array(fs.readFileSync(candidate)));
      const check = database.exec('PRAGMA quick_check');
      if (check[0]?.values[0]?.[0] === 'ok') return { database, existed: true, recoveredFromBackup: candidate === backupPath };
    } catch { /* try the previous snapshot */ }
    database?.close();
  }
  if (candidates.length) throw new Error(`SQLite database and backup could not be opened. Files were preserved in ${path.dirname(databasePath)}.`);
  return { database: new sqlite.Database(), existed: false, recoveredFromBackup: false };
}

type Row = Record<string, SqlValue>;
function latestPair(database: Database, participantId: string, completedOnly: boolean) {
  const latest = (testType: StoredTestType) => mapSession(queryOne(database, `SELECT * FROM test_sessions
    WHERE participant_id = ? AND test_type = ? ${completedOnly ? "AND status = 'complete'" : ''}
    ORDER BY ${completedOnly ? 'completed_at' : 'COALESCE(completed_at, updated_at)'} DESC LIMIT 1`, [participantId, testType]));
  return { visual: latest('visual'), audio: latest('audio') };
}
function queryOne(database: Database, sql: string, parameters: SqlValue[]): Row | null { return queryAll(database, sql, parameters)[0] ?? null; }
function queryAll(database: Database, sql: string, parameters: SqlValue[]): Row[] {
  const statement = database.prepare(sql);
  try { statement.bind(parameters); const rows: Row[] = []; while (statement.step()) rows.push(statement.getAsObject()); return rows; }
  finally { statement.free(); }
}
function mapSession(row: Row | null): StoredSession | null {
  return row ? { ...mapSessionMetadata(row), data: JSON.parse(text(row.data_json)) as Record<string, unknown> } : null;
}
function mapSessionMetadata(row: Row): Omit<StoredSession, 'data'> {
  return { sessionId: text(row.session_id), participantId: text(row.participant_id), testType: text(row.test_type) as StoredTestType,
    startedAt: text(row.started_at), completedAt: nullableText(row.completed_at),
    status: text(row.status) as StoredSession['status'], updatedAt: text(row.updated_at) };
}
function text(value: SqlValue | undefined): string { return String(value ?? ''); }
function nullableText(value: SqlValue | undefined): string | null { return value === null || value === undefined ? null : String(value); }
function numeric(value: SqlValue | undefined): number { return Number(value ?? 0); }
function validateSession(testType: StoredTestType, session: SessionPayload): void {
  if (!['visual', 'audio'].includes(testType)) throw new Error('testType must be visual or audio.');
  if (typeof session?.sessionId !== 'string' || typeof session.startedAt !== 'string' || typeof session.participant?.participantId !== 'string') throw new Error('Session requires string sessionId, startedAt, and participant.participantId values.');
  if (typeof session.participant.name !== 'string' || !session.participant.name.trim() || !session.participant.participantId.trim()) throw new Error('Participant name and ID are required.');
  if (!Number.isInteger(session.participant.age) || session.participant.age < PARTICIPANT_CONFIG.minimumAge || session.participant.age > PARTICIPANT_CONFIG.maximumAge) throw new Error('Participant age is outside the configured range.');
  if (!['male', 'female', 'other'].includes(session.participant.gender)) throw new Error('Participant gender must be male, female, or other.');
  if (session.participant.notes !== undefined && typeof session.participant.notes !== 'string') throw new Error('Participant notes must be text.');
  if ((session.participant.notes?.length ?? 0) > PARTICIPANT_CONFIG.maximumNotesLength) throw new Error('Participant notes are too long.');
  if (Number.isNaN(Date.parse(session.startedAt)) || (session.completedAt && Number.isNaN(Date.parse(session.completedAt)))) throw new Error('Session timestamps must be valid ISO dates.');
}
