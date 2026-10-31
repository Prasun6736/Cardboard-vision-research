import type { IncomingMessage, ServerResponse } from 'node:http';
import { SERVER_CONFIG } from '../shared/config';
import type { StoredTestType } from './database';

type DatabaseService = Awaited<ReturnType<typeof import('./database').createDatabase>>;

export async function handleApiRequest(
  request: IncomingMessage,
  response: ServerResponse,
  database: DatabaseService
): Promise<boolean> {
  const url = new URL(request.url ?? '/', 'http://localhost');
  if (!url.pathname.startsWith('/api/')) return false;

  try {
    if (request.method === 'GET' && url.pathname === '/api/participants') {
      return json(response, 200, { participants: database.listParticipants() });
    }

    if (request.method === 'POST' && url.pathname === '/api/sessions') {
      const body = await readJsonBody(request) as { testType?: StoredTestType; session?: Record<string, unknown> };
      if (!body.testType || !body.session) return json(response, 400, { error: 'testType and session are required.' });
      database.saveSession(body.testType, body.session as never);
      return json(response, 200, { ok: true, sessionId: body.session.sessionId });
    }

    const sessionMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)$/);
    if (request.method === 'GET' && sessionMatch) {
      const session = database.getSession(decodeURIComponent(sessionMatch[1]));
      return json(response, session ? 200 : 404, session ?? { error: 'Session not found.' });
    }

    const latestMatch = url.pathname.match(/^\/api\/participants\/([^/]+)\/latest$/);
    if (request.method === 'GET' && latestMatch) {
      return json(response, 200, database.getLatestSessions(decodeURIComponent(latestMatch[1])));
    }

    const completedMatch = url.pathname.match(/^\/api\/participants\/([^/]+)\/latest-completed$/);
    if (request.method === 'GET' && completedMatch) {
      return json(response, 200, database.getLatestCompletedSessions(decodeURIComponent(completedMatch[1])));
    }

    const listMatch = url.pathname.match(/^\/api\/participants\/([^/]+)\/sessions$/);
    if (request.method === 'GET' && listMatch) {
      return json(response, 200, { sessions: database.listParticipantSessions(decodeURIComponent(listMatch[1])) });
    }

    return json(response, 404, { error: 'API route not found.' });
  } catch (error) {
    return json(response, 400, { error: error instanceof Error ? error.message : 'Request failed.' });
  }
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > SERVER_CONFIG.maximumApiBodyBytes) throw new Error('Request body is too large.');
    chunks.push(buffer);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new Error('Request body must be valid JSON.'); }
}

function json(response: ServerResponse, status: number, value: unknown): true {
  response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  response.end(JSON.stringify(value));
  return true;
}
