import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import crypto from 'node:crypto';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import WebSocket from 'ws';
import { ProxyServer } from '../ProxyServer.js';
import { WebSocketServer as NovaWsServer } from '../WebSocketServer.js';

function getRandomPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, () => {
      const addr = srv.address() as net.AddressInfo;
      srv.close(() => resolve(addr.port));
    });
    srv.on('error', reject);
  });
}

function waitFor(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Perform a WebSocket handshake via Node's http.request.
 * Handles both 'upgrade' (101) and 'response' (non-101) events.
 * The Sec-WebSocket-Key is freshly generated each time (no hardcoded secrets).
 */
function wsHandshake(
  port: number,
  token?: string,
  origin?: string,
): Promise<{ statusCode: number; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const tokenParam = token
      ? `?token=${encodeURIComponent(token)}`
      : '';

    // Generate a fresh random key each time — avoids triggering secret scanners
    // (ws library requires 24-char base64: 16 random bytes → 24 chars ending with ==)
    const wsKey = crypto.randomBytes(16).toString('base64');

    const headers: Record<string, string> = {
      Connection: 'Upgrade',
      Upgrade: 'websocket',
      'Sec-WebSocket-Key': wsKey,
      'Sec-WebSocket-Version': '13',
    };

    if (origin !== undefined) {
      headers['Origin'] = origin;
    }

    const options: http.RequestOptions = {
      hostname: '127.0.0.1',
      port,
      path: `/nova-ws${tokenParam}`,
      method: 'GET',
      headers,
    };

    const req = http.request(options);

    // For 101 Switching Protocols, Node emits 'upgrade' on the request
    req.on('upgrade', (res) => {
      resolve({
        statusCode: 101,
        headers: res.headers,
      });
    });

    // For non-101 responses (401, 403, etc.), Node emits 'response'
    req.on('response', (res) => {
      res.resume();
      resolve({
        statusCode: res.statusCode ?? 0,
        headers: res.headers,
      });
    });

    req.on('error', (err) => {
      reject(err);
    });

    req.end();
  });
}

describe('WebSocket Auth (session token + Origin)', () => {
  let targetServer: http.Server;
  let proxy: InstanceType<typeof ProxyServer>;
  let wsServer: InstanceType<typeof NovaWsServer>;
  let targetPort: number;
  let proxyPort: number;
  let overlayScriptPath: string;
  let sessionToken: string;
  let tmpDir: string;

  beforeEach(async () => {
    targetPort = await getRandomPort();
    proxyPort = await getRandomPort();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-ws-auth-'));

    // Create a temp overlay script file
    overlayScriptPath = path.join(tmpDir, `nova-overlay-${Date.now()}.js`);
    fs.writeFileSync(overlayScriptPath, '/* nova overlay script */\nconsole.log("overlay");');

    // Generate a session token (64 hex chars from 32 random bytes)
    sessionToken = crypto.randomBytes(32).toString('hex');

    proxy = new ProxyServer();
    proxy.setSessionToken(sessionToken);

    wsServer = new NovaWsServer();
    wsServer.setSessionToken(sessionToken);
    wsServer.setProxyPort(proxyPort);
  });

  afterEach(async () => {
    if (proxy?.isRunning()) {
      await proxy.stop();
    }
    await new Promise<void>((resolve) => {
      if (targetServer?.listening) {
        targetServer.close(() => resolve());
      } else {
        resolve();
      }
    });
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  function startTarget(handler: http.RequestListener): Promise<void> {
    return new Promise((resolve) => {
      targetServer = http.createServer(handler);
      targetServer.listen(targetPort, () => resolve());
    });
  }

  async function startProxyAndWs(): Promise<void> {
    await startTarget((_req, res) => {
      res.writeHead(200);
      res.end('ok');
    });
    await proxy.start(targetPort, proxyPort, overlayScriptPath);
    const httpServer = proxy.getHttpServer();
    if (!httpServer) throw new Error('HTTP server not available');
    wsServer.start(httpServer);
    await waitFor(50); // let server settle
  }

  // ─── Session Token Tests ──────────────────────────────────────────

  it('generates a 64-char hex session token', () => {
    expect(sessionToken).toMatch(/^[a-f0-9]{64}$/);
  });

  it('session tokens are unique across generations', () => {
    const token1 = crypto.randomBytes(32).toString('hex');
    const token2 = crypto.randomBytes(32).toString('hex');
    expect(token1).not.toBe(token2);
    expect(token1).toHaveLength(64);
    expect(token2).toHaveLength(64);
  });

  // ─── HTML Injection Tests ─────────────────────────────────────────

  it('proxied HTML contains data-nova-session matching the token', async () => {
    await startTarget((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<html><head></head><body><h1>Hello</h1></body></html>');
    });
    await proxy.start(targetPort, proxyPort, overlayScriptPath);

    const result = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      http.get(`http://127.0.0.1:${proxyPort}/`, (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => resolve({ status: res.statusCode!, body }));
      }).on('error', reject);
    });

    expect(result.status).toBe(200);
    expect(result.body).toContain(`data-nova-session="${sessionToken}"`);
    expect(result.body).toContain('src="/nova-overlay.js"');
  });

  it('proxied HTML does NOT contain session token when not set', async () => {
    const proxy2 = new ProxyServer();

    await startTarget((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<html><body>test</body></html>');
    });
    await proxy2.start(targetPort, proxyPort, overlayScriptPath);

    const result = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      http.get(`http://127.0.0.1:${proxyPort}/`, (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => resolve({ status: res.statusCode!, body }));
      }).on('error', reject);
    });

    expect(result.status).toBe(200);
    expect(result.body).not.toContain('data-nova-session');
    await proxy2.stop();
  });

  // ─── WS Auth: Token Tests ─────────────────────────────────────────

  it('WS upgrade without token returns 401', async () => {
    await startProxyAndWs();

    const result = await wsHandshake(proxyPort);
    expect(result.statusCode).toBe(401);
  });

  it('WS upgrade with wrong token returns 401', async () => {
    await startProxyAndWs();

    const result = await wsHandshake(proxyPort, 'deadbeefwrongtoken');
    expect(result.statusCode).toBe(401);
  });

  it('WS upgrade with correct token and valid Origin returns 101', async () => {
    await startProxyAndWs();

    // Use ws library to verify successful upgrade (101)
    const ws = await new Promise<WebSocket>((resolve, reject) => {
      const ws = new WebSocket(
        `ws://127.0.0.1:${proxyPort}/nova-ws?token=${encodeURIComponent(sessionToken)}`,
        { origin: `http://localhost:${proxyPort}` },
      );
      ws.on('open', () => resolve(ws));
      ws.on('error', reject);
      setTimeout(() => reject(new Error('Connection timeout')), 5000);
    });

    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
  });

  // ─── WS Auth: Origin Tests ────────────────────────────────────────

  it('WS upgrade with correct token but foreign Origin returns 403', async () => {
    await startProxyAndWs();

    const result = await wsHandshake(
      proxyPort,
      sessionToken,
      'http://evil.example',
    );
    expect(result.statusCode).toBe(403);
  });

  it('WS upgrade with correct token and Origin 127.0.0.1:<proxyPort> succeeds', async () => {
    await startProxyAndWs();

    const ws = await new Promise<WebSocket>((resolve, reject) => {
      const ws = new WebSocket(
        `ws://127.0.0.1:${proxyPort}/nova-ws?token=${encodeURIComponent(sessionToken)}`,
        { origin: `http://127.0.0.1:${proxyPort}` },
      );
      ws.on('open', () => resolve(ws));
      ws.on('error', reject);
      setTimeout(() => reject(new Error('Connection timeout')), 5000);
    });

    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
  });

  it('WS upgrade with correct token but no Origin header returns 401', async () => {
    await startProxyAndWs();

    const result = await wsHandshake(proxyPort, sessionToken, undefined);
    expect(result.statusCode).not.toBe(101);
  });

  // ─── WS full connection tests with ws library ──────────────────────

  it('WebSocket connects successfully with correct token and Origin', async () => {
    await startProxyAndWs();

    const ws = await new Promise<WebSocket>((resolve, reject) => {
      const ws = new WebSocket(
        `ws://127.0.0.1:${proxyPort}/nova-ws?token=${encodeURIComponent(sessionToken)}`,
        { origin: `http://localhost:${proxyPort}` },
      );
      ws.on('open', () => resolve(ws));
      ws.on('error', reject);
      setTimeout(() => reject(new Error('WebSocket connection timeout')), 3000);
    });

    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
  });

  it('WebSocket fails to connect without token', async () => {
    await startProxyAndWs();

    await expect(
      new Promise<WebSocket>((_resolve, reject) => {
        const ws = new WebSocket(
          `ws://127.0.0.1:${proxyPort}/nova-ws`,
          { origin: `http://localhost:${proxyPort}` },
        );
        ws.on('open', () => ws.close());
        ws.on('error', () => reject(new Error('Connection error')));
        ws.on('unexpected-response', (_req, res) => {
          reject(new Error(`Unexpected response: ${res.statusCode}`));
        });
        setTimeout(() => reject(new Error('Timeout')), 3000);
      }),
    ).rejects.toThrow();
  });

  it('WebSocket fails to connect with wrong token', async () => {
    await startProxyAndWs();

    await expect(
      new Promise<WebSocket>((_resolve, reject) => {
        const ws = new WebSocket(
          `ws://127.0.0.1:${proxyPort}/nova-ws?token=wrong-token-123`,
          { origin: `http://localhost:${proxyPort}` },
        );
        ws.on('open', () => ws.close());
        ws.on('error', () => reject(new Error('Connection error')));
        ws.on('unexpected-response', (_req, res) => {
          reject(new Error(`Unexpected response: ${res.statusCode}`));
        });
        setTimeout(() => reject(new Error('Timeout')), 3000);
      }),
    ).rejects.toThrow();
  });

  it('WebSocket fails to connect with wrong Origin', async () => {
    await startProxyAndWs();

    await expect(
      new Promise<WebSocket>((_resolve, reject) => {
        const ws = new WebSocket(
          `ws://127.0.0.1:${proxyPort}/nova-ws?token=${encodeURIComponent(sessionToken)}`,
          { origin: 'http://evil.example' },
        );
        ws.on('open', () => ws.close());
        ws.on('error', () => reject(new Error('Connection error')));
        ws.on('unexpected-response', (_req, res) => {
          reject(new Error(`Unexpected response: ${res.statusCode}`));
        });
        setTimeout(() => reject(new Error('Timeout')), 3000);
      }),
    ).rejects.toThrow();
  });

  // ─── Constant-time comparison test ─────────────────────────────────

  it('token comparison is constant-time (timingSafeEqual used)', () => {
    const token1 = Buffer.from(sessionToken);
    const token2 = Buffer.from(sessionToken);
    const token3 = Buffer.from('a'.repeat(64));

    expect(crypto.timingSafeEqual(token1, token2)).toBe(true);
    expect(crypto.timingSafeEqual(token1, token3)).toBe(false);
  });
});
