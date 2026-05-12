import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { ProxyServer } from '../../ProxyServer.js';

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

describe('ProxyServer host binding', () => {
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
    fs.writeFileSync(overlayScriptPath, '/* nova overlay script */');

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

  it('binds to 127.0.0.1 by default', async () => {
    await startTarget((_req, res) => {
      res.writeHead(200);
      res.end('ok');
    });

    // Start without passing host — should use the default 127.0.0.1
    await proxy.start(targetPort, proxyPort, overlayScriptPath);

    // Verify localhost access works
    const result = await new Promise<{ status: number }>((resolve, reject) => {
      http
        .get(`http://127.0.0.1:${proxyPort}/`, (res) => {
          let body = '';
          res.on('data', (chunk) => (body += chunk));
          res.on('end', () => resolve({ status: res.statusCode! }));
        })
        .on('error', reject);
    });
    expect(result.status).toBe(200);

    // Verify the server is actually bound to 127.0.0.1
    const httpServer = proxy.getHttpServer();
    expect(httpServer).not.toBeNull();
    const addr = httpServer!.address() as net.AddressInfo;
    expect(addr.address).toBe('127.0.0.1');
    expect(addr.port).toBe(proxyPort);
  });

  it('binds to 0.0.0.0 when host is set via setHost()', async () => {
    await startTarget((_req, res) => {
      res.writeHead(200);
      res.end('ok');
    });

    proxy.setHost('0.0.0.0');
    await proxy.start(targetPort, proxyPort, overlayScriptPath);

    // Verify localhost access works
    const result = await new Promise<{ status: number }>((resolve, reject) => {
      http
        .get(`http://127.0.0.1:${proxyPort}/`, (res) => {
          let body = '';
          res.on('data', (chunk) => (body += chunk));
          res.on('end', () => resolve({ status: res.statusCode! }));
        })
        .on('error', reject);
    });
    expect(result.status).toBe(200);

    // Verify the server is bound to 0.0.0.0 (wildcard)
    const httpServer = proxy.getHttpServer();
    expect(httpServer).not.toBeNull();
    const addr = httpServer!.address() as net.AddressInfo;
    expect(addr.address).toBe('0.0.0.0');
    expect(addr.port).toBe(proxyPort);
  });

  it('binds to 0.0.0.0 when host is passed as parameter to start()', async () => {
    await startTarget((_req, res) => {
      res.writeHead(200);
      res.end('ok');
    });

    await proxy.start(targetPort, proxyPort, overlayScriptPath, '0.0.0.0');

    // Verify the server is bound to 0.0.0.0 (wildcard)
    const httpServer = proxy.getHttpServer();
    expect(httpServer).not.toBeNull();
    const addr = httpServer!.address() as net.AddressInfo;
    expect(addr.address).toBe('0.0.0.0');
    expect(addr.port).toBe(proxyPort);
  });

  it('setHost() with 127.0.0.1 confirms loopback bind', async () => {
    await startTarget((_req, res) => {
      res.writeHead(200);
      res.end('ok');
    });

    proxy.setHost('127.0.0.1');
    await proxy.start(targetPort, proxyPort, overlayScriptPath);

    // Verify responds on 127.0.0.1
    const result = await new Promise<{ status: number }>((resolve, reject) => {
      http
        .get(`http://127.0.0.1:${proxyPort}/`, (res) => {
          let body = '';
          res.on('data', (chunk) => (body += chunk));
          res.on('end', () => resolve({ status: res.statusCode! }));
        })
        .on('error', reject);
    });
    expect(result.status).toBe(200);

    // Verify the bind address is 127.0.0.1
    const httpServer = proxy.getHttpServer();
    const addr = httpServer!.address() as net.AddressInfo;
    expect(addr.address).toBe('127.0.0.1');
  });

  it('start parameter overrides setHost()', async () => {
    await startTarget((_req, res) => {
      res.writeHead(200);
      res.end('ok');
    });

    // setHost to loopback, but pass 0.0.0.0 as parameter — parameter wins
    proxy.setHost('127.0.0.1');
    await proxy.start(targetPort, proxyPort, overlayScriptPath, '0.0.0.0');

    const httpServer = proxy.getHttpServer();
    const addr = httpServer!.address() as net.AddressInfo;
    expect(addr.address).toBe('0.0.0.0');
  });

  it('binds to ::1 when host is set to IPv6 loopback', async () => {
    await startTarget((_req, res) => {
      res.writeHead(200);
      res.end('ok');
    });

    proxy.setHost('::1');
    await proxy.start(targetPort, proxyPort, overlayScriptPath);

    // Verify responds on ::1
    const result = await new Promise<{ status: number }>((resolve, reject) => {
      http
        .get(`http://[::1]:${proxyPort}/`, { family: 6 }, (res) => {
          let body = '';
          res.on('data', (chunk) => (body += chunk));
          res.on('end', () => resolve({ status: res.statusCode! }));
        })
        .on('error', reject);
    });
    expect(result.status).toBe(200);

    // Verify bind address
    const httpServer = proxy.getHttpServer();
    const addr = httpServer!.address() as net.AddressInfo;
    expect(addr.address).toBe('::1');
  });

  it('rejects EADDRINUSE when port is in use', async () => {
    // Occupy the proxy port first
    const occupier = http.createServer((_req, res) => {
      res.writeHead(200);
      res.end('occupied');
    });
    await new Promise<void>((resolve) => occupier.listen(proxyPort, () => resolve()));

    await startTarget((_req, res) => {
      res.writeHead(200);
      res.end('ok');
    });

    await expect(proxy.start(targetPort, proxyPort, overlayScriptPath)).rejects.toThrow(
      `Port ${proxyPort} is already in use`,
    );

    await new Promise<void>((resolve) => occupier.close(() => resolve()));
  });

  it('getHttpServer() returns server with correct host and port', async () => {
    await startTarget((_req, res) => {
      res.writeHead(200);
      res.end('ok');
    });

    proxy.setHost('127.0.0.1');
    await proxy.start(targetPort, proxyPort, overlayScriptPath);

    const httpServer = proxy.getHttpServer();
    expect(httpServer).not.toBeNull();
    expect(httpServer!.listening).toBe(true);

    const addr = httpServer!.address() as net.AddressInfo;
    expect(addr.address).toBe('127.0.0.1');
    expect(addr.port).toBe(proxyPort);
  });

  it('server address reflects wildcard when host is 0.0.0.0', async () => {
    await startTarget((_req, res) => {
      res.writeHead(200);
      res.end('ok');
    });

    proxy.setHost('0.0.0.0');
    await proxy.start(targetPort, proxyPort, overlayScriptPath);

    const httpServer = proxy.getHttpServer();
    expect(httpServer).not.toBeNull();
    expect(httpServer!.listening).toBe(true);

    const addr = httpServer!.address() as net.AddressInfo;
    expect(addr.address).toBe('0.0.0.0');
    expect(addr.port).toBe(proxyPort);
  });
});
