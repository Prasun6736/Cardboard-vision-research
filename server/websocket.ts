import type { Server as HttpServer } from 'node:http';
import type { Server as HttpsServer } from 'node:https';
import { WebSocket, WebSocketServer } from 'ws';
import { isProtocolMessage, type Role } from '../shared/protocol';
import { NETWORK_CONFIG } from '../shared/config';

type Peer = WebSocket & { role?: Role; alive?: boolean };

function send(socket: WebSocket | undefined, message: unknown): void {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

export function attachWebSocketServer(server: HttpServer | HttpsServer): void {
  const wss = new WebSocketServer({ server, path: NETWORK_CONFIG.websocketPath });
  const peers = new Map<Role, Peer>();

  const broadcastStatus = (role: Role, connected: boolean) => {
    for (const peer of peers.values()) send(peer, { type: 'peerStatus', role, connected });
  };

  wss.on('connection', (socket: Peer) => {
    socket.alive = true;
    socket.on('pong', () => { socket.alive = true; });
    socket.on('message', raw => {
      let message: unknown;
      try { message = JSON.parse(raw.toString()); }
      catch { send(socket, { type: 'error', code: 'BAD_JSON', message: 'Message must be valid JSON.' }); return; }
      if (!isProtocolMessage(message)) { send(socket, { type: 'error', code: 'BAD_MESSAGE', message: 'Message has no valid type.' }); return; }

      if (message.type === 'hello') {
        if (socket.role && socket.role !== message.role && peers.get(socket.role) === socket) {
          peers.delete(socket.role);
          broadcastStatus(socket.role, false);
        }
        const old = peers.get(message.role);
        if (old && old !== socket) old.close(4001, 'Replaced by a newer client');
        socket.role = message.role;
        peers.set(message.role, socket);
        const otherRole: Role = message.role === 'desktop' ? 'phone' : 'desktop';
        send(socket, { type: 'connected', role: message.role, peerConnected: peers.get(otherRole)?.readyState === WebSocket.OPEN });
        broadcastStatus(message.role, true);
        return;
      }
      if (message.type === 'ping') { send(socket, { type: 'pong', at: message.at }); return; }
      if (!socket.role) { send(socket, { type: 'error', code: 'NOT_REGISTERED', message: 'Send hello first.' }); return; }
      const destination = peers.get(socket.role === 'desktop' ? 'phone' : 'desktop');
      if (!destination || destination.readyState !== WebSocket.OPEN) {
        send(socket, { type: 'error', code: 'PEER_OFFLINE', message: 'The other client is not connected.' });
        return;
      }
      send(destination, message);
    });
    socket.on('close', () => {
      if (socket.role && peers.get(socket.role) === socket) {
        peers.delete(socket.role);
        broadcastStatus(socket.role, false);
      }
    });
  });

  setInterval(() => {
    for (const socket of wss.clients as Set<Peer>) {
      if (socket.alive === false) { socket.terminate(); continue; }
      socket.alive = false;
      socket.ping();
    }
  }, NETWORK_CONFIG.serverHeartbeatIntervalMs).unref();
}
