import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';
import { SERVER_CONFIG } from '../shared/config';
import { handleApiRequest } from './api';
import { createDatabase } from './database';
import { attachWebSocketServer } from './websocket';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT || SERVER_CONFIG.defaultPort);
const certPath = path.join(root, 'certs', SERVER_CONFIG.pemCertificateFile);
const keyPath = path.join(root, 'certs', SERVER_CONFIG.pemPrivateKeyFile);
const pfxPath = path.join(root, 'certs', SERVER_CONFIG.windowsPfxFile);
const hasPemCertificate = fs.existsSync(certPath) && fs.existsSync(keyPath);
const hasWindowsCertificate = fs.existsSync(pfxPath);
const secure = hasPemCertificate || hasWindowsCertificate;
const database = await createDatabase(root);
const vite = await createViteServer({
  root: path.join(root, 'client'),
  // This application owns its WebSocket endpoint. HMR's separate socket can
  // conflict with it in middleware mode; a browser refresh is sufficient here.
  server: { middlewareMode: true, hmr: false },
  appType: 'spa'
});

const handler: http.RequestListener = (req, res) => {
  void (async () => {
    if (await handleApiRequest(req, res, database)) return;
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, secure, database: true }));
      return;
    }
    vite.middlewares(req, res, () => {
      res.writeHead(404);
      res.end('Not found');
    });
  })().catch(error => {
    console.error('Request failed', error);
    if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' });
    if (!res.writableEnded) res.end(JSON.stringify({ error: 'Internal server error.' }));
  });
};

const server = secure
  ? https.createServer(
      hasPemCertificate
        ? { cert: fs.readFileSync(certPath), key: fs.readFileSync(keyPath) }
        : { pfx: fs.readFileSync(pfxPath), passphrase: SERVER_CONFIG.pfxPassphrase },
      handler
    )
  : http.createServer(handler);

attachWebSocketServer(server);
server.listen(port, '0.0.0.0', () => {
  const protocol = secure ? 'https' : 'http';
  const addresses = Object.values(os.networkInterfaces()).flat().filter((address): address is os.NetworkInterfaceInfo => Boolean(address && address.family === 'IPv4' && !address.internal));
  console.log(`Desktop: ${protocol}://localhost:${port}/`);
  console.log(`Database: ${database.databasePath}`);
  for (const address of addresses) console.log(`Phone:   ${protocol}://${address.address}:${port}/phone/`);
  if (!secure) console.warn('HTTPS is disabled. Run npm run cert (macOS/Linux) or npm run cert:windows, trust the certificate, then restart.');
});
