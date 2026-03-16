import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { ProxyServer } from '../ProxyServer.js';

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

function fetch(url: string): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, body }));
    }).on('error', reject);
  });
}

describe('ProxyServer', () => {
  let targetServer: http.Server;
  let proxy: InstanceType<typeof ProxyServer>;
  let targetPort: number;
  let proxyPort: number;
  let overlayScriptPath: string;

  beforeEach(async () => {
    targetPort = await getRandomPort();
    proxyPort = await getRandomPort();

    // Create a temp overlay script file
    const tmpDir = os.tmpdir();
    overlayScriptPath = path.join(tmpDir, `nova-overlay-${Date.now()}.js`);
    fs.writeFileSync(overlayScriptPath, '/* nova overlay script */\nconsole.log("overlay");');

    proxy = new ProxyServer();
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

  function startTarget(handler: http.RequestListener): Promise<void> {
    return new Promise((resolve) => {
      targetServer = http.createServer(handler);
      targetServer.listen(targetPort, () => resolve());
    });
  }

  it('start() listens on proxyPort', async () => {
    await startTarget((_req, res) => {
      res.writeHead(200);
      res.end('ok');
    });

    await proxy.start(targetPort, proxyPort, overlayScriptPath);

    const result = await fetch(`http://localhost:${proxyPort}/`);
    expect(result.status).toBe(200);
  });

  it('HTTP GET through proxy proxies to target and returns same body', async () => {
    const expectedBody = '{"items":[1,2,3]}';
    await startTarget((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(expectedBody);
    });

    await proxy.start(targetPort, proxyPort, overlayScriptPath);

    const result = await fetch(`http://localhost:${proxyPort}/api/data`);
    expect(result.body).toBe(expectedBody);
  });

  it('HTML response contains injected <script src="/nova-overlay.js">', async () => {
    const html = '<html><head></head><body><h1>Hello</h1></body></html>';
    await startTarget((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
    });

    await proxy.start(targetPort, proxyPort, overlayScriptPath);

    const result = await fetch(`http://localhost:${proxyPort}/`);
    expect(result.body).toContain('<script src="/nova-overlay.js"></script>');
    expect(result.body).toContain('<h1>Hello</h1>');
  });

  it('JSON response is NOT modified (no script tag)', async () => {
    const json = '{"key":"value"}';
    await startTarget((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(json);
    });

    await proxy.start(targetPort, proxyPort, overlayScriptPath);

    const result = await fetch(`http://localhost:${proxyPort}/api/data`);
    expect(result.body).toBe(json);
    expect(result.body).not.toContain('<script');
  });

  it('CSS response is NOT modified', async () => {
    const css = 'body { color: red; }';
    await startTarget((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/css' });
      res.end(css);
    });

    await proxy.start(targetPort, proxyPort, overlayScriptPath);

    const result = await fetch(`http://localhost:${proxyPort}/styles.css`);
    expect(result.body).toBe(css);
    expect(result.body).not.toContain('<script');
  });

  it('GET /nova-overlay.js returns file from overlayScriptPath', async () => {
    await startTarget((_req, res) => {
      res.writeHead(200);
      res.end('should not reach target');
    });

    await proxy.start(targetPort, proxyPort, overlayScriptPath);

    const result = await fetch(`http://localhost:${proxyPort}/nova-overlay.js`);
    const expectedContent = fs.readFileSync(overlayScriptPath, 'utf-8');
    expect(result.body).toBe(expectedContent);
  });

  it('CSP headers are stripped from responses', async () => {
    await startTarget((_req, res) => {
      res.writeHead(200, {
        'Content-Type': 'text/html',
        'Content-Security-Policy': "default-src 'self'",
        'content-security-policy-report-only': "default-src 'none'",
      });
      res.end('<html><body>test</body></html>');
    });

    await proxy.start(targetPort, proxyPort, overlayScriptPath);

    const result = await fetch(`http://localhost:${proxyPort}/`);
    expect(result.headers['content-security-policy']).toBeUndefined();
    expect(result.headers['content-security-policy-report-only']).toBeUndefined();
  });

  it('stop() frees the port', async () => {
    await startTarget((_req, res) => {
      res.writeHead(200);
      res.end('ok');
    });

    await proxy.start(targetPort, proxyPort, overlayScriptPath);
    expect(proxy.isRunning()).toBe(true);

    await proxy.stop();

    // Port should be free: we can bind to it
    const canBind = await new Promise<boolean>((resolve) => {
      const srv = net.createServer();
      srv.listen(proxyPort, () => {
        srv.close(() => resolve(true));
      });
      srv.on('error', () => resolve(false));
    });
    expect(canBind).toBe(true);
  });

  it('isRunning() returns true when started, false when stopped', async () => {
    await startTarget((_req, res) => {
      res.writeHead(200);
      res.end('ok');
    });

    expect(proxy.isRunning()).toBe(false);

    await proxy.start(targetPort, proxyPort, overlayScriptPath);
    expect(proxy.isRunning()).toBe(true);

    await proxy.stop();
    expect(proxy.isRunning()).toBe(false);
  });
});
