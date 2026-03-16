import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import WebSocket from 'ws';
import type { Observation, NovaEvent } from '../../packages/core/src/models/types.js';
import type { NovaEvent as NovaEventFromEvents } from '../../packages/core/src/models/events.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function httpGet(url: string): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, body }));
    }).on('error', reject);
  });
}

function waitFor(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Proxy + overlay integration tests
// ---------------------------------------------------------------------------

describe('Proxy + overlay integration', () => {
  let targetServer: http.Server;
  let targetPort: number;
  let proxyPort: number;
  let overlayScriptPath: string;
  let proxy: InstanceType<typeof import('../../packages/proxy/src/ProxyServer.js').ProxyServer>;
  let wsServer: InstanceType<typeof import('../../packages/proxy/src/WebSocketServer.js').WebSocketServer>;

  beforeEach(async () => {
    targetPort = await getRandomPort();
    proxyPort = await getRandomPort();

    // Create a temp overlay script file
    const tmpDir = os.tmpdir();
    overlayScriptPath = path.join(tmpDir, `nova-overlay-e2e-${Date.now()}.js`);
    fs.writeFileSync(overlayScriptPath, '/* nova overlay e2e */\nconsole.log("overlay loaded");');
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
      fs.unlinkSync(overlayScriptPath);
    } catch {
      // ignore
    }
  });

  function startTarget(html: string): Promise<void> {
    return new Promise((resolve) => {
      targetServer = http.createServer((_req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(html);
      });
      targetServer.listen(targetPort, () => resolve());
    });
  }

  // ── 1. Proxy injects overlay script tag ─────────────────────

  it('proxy injects <script src="/nova-overlay.js"> into HTML response', async () => {
    const { ProxyServer } = await import(
      '../../packages/proxy/src/ProxyServer.js'
    );

    const html = '<html><body><h1>Test</h1></body></html>';
    await startTarget(html);

    proxy = new ProxyServer();
    await proxy.start(targetPort, proxyPort, overlayScriptPath);

    const result = await httpGet(`http://localhost:${proxyPort}/`);

    expect(result.status).toBe(200);
    expect(result.body).toContain('<script src="/nova-overlay.js">');
    expect(result.body).toContain('<h1>Test</h1>');
  });

  // ── 2. /nova-overlay.js is served ──────────────────────────

  it('/nova-overlay.js serves the overlay script file', async () => {
    const { ProxyServer } = await import(
      '../../packages/proxy/src/ProxyServer.js'
    );

    await startTarget('<html><body>hi</body></html>');

    proxy = new ProxyServer();
    await proxy.start(targetPort, proxyPort, overlayScriptPath);

    const result = await httpGet(`http://localhost:${proxyPort}/nova-overlay.js`);

    expect(result.status).toBe(200);
    expect(result.body).toContain('nova overlay e2e');
  });

  // ── 3. WebSocket observation + event roundtrip ──────────────

  it('WebSocket receives observation and sends events back', async () => {
    const { ProxyServer } = await import(
      '../../packages/proxy/src/ProxyServer.js'
    );
    const { WebSocketServer: NovaWsServer } = await import(
      '../../packages/proxy/src/WebSocketServer.js'
    );

    await startTarget('<html><body>ws test</body></html>');

    proxy = new ProxyServer();
    await proxy.start(targetPort, proxyPort, overlayScriptPath);

    const httpServer = proxy.getHttpServer()!;
    wsServer = new NovaWsServer();
    wsServer.start(httpServer);

    // Set up observation handler
    const observationHandler = vi.fn();
    wsServer.onObservation(observationHandler);

    // Connect a WS client
    const ws = await new Promise<WebSocket>((resolve, reject) => {
      const client = new WebSocket(`ws://localhost:${proxyPort}/nova-ws`);
      client.on('open', () => resolve(client));
      client.on('error', reject);
    });

    try {
      // Send an observation from the client
      const observation: Observation = {
        screenshot: Buffer.from('fake-screenshot'),
        currentUrl: 'http://localhost:3000/',
        transcript: 'add a search input',
        timestamp: Date.now(),
      };

      ws.send(JSON.stringify(observation));
      await waitFor(150);

      expect(observationHandler).toHaveBeenCalledOnce();
      const received = observationHandler.mock.calls[0][0];
      expect(received.currentUrl).toBe(observation.currentUrl);
      expect(received.transcript).toBe(observation.transcript);

      // Send an event back from server to client
      const receivedEvents: NovaEventFromEvents[] = [];
      ws.on('message', (data) => {
        receivedEvents.push(JSON.parse(data.toString()));
      });

      const event: NovaEventFromEvents = {
        type: 'status',
        data: { message: 'processing' },
      };
      wsServer.sendEvent(event);

      await waitFor(150);

      expect(receivedEvents).toHaveLength(1);
      expect(receivedEvents[0]).toEqual(event);
    } finally {
      ws.close();
    }
  });

  // ── 4. Cleanup: proxy stops cleanly ─────────────────────────

  it('proxy stop releases the port', async () => {
    const { ProxyServer } = await import(
      '../../packages/proxy/src/ProxyServer.js'
    );

    await startTarget('<html><body>cleanup test</body></html>');

    proxy = new ProxyServer();
    await proxy.start(targetPort, proxyPort, overlayScriptPath);
    expect(proxy.isRunning()).toBe(true);

    await proxy.stop();
    expect(proxy.isRunning()).toBe(false);

    // Verify port is free
    const canBind = await new Promise<boolean>((resolve) => {
      const srv = net.createServer();
      srv.listen(proxyPort, () => {
        srv.close(() => resolve(true));
      });
      srv.on('error', () => resolve(false));
    });
    expect(canBind).toBe(true);
  });
});
