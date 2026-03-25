import http from 'node:http';
import path from 'node:path';
import zlib from 'node:zlib';
import { pipeline } from 'node:stream';
import fs from 'node:fs';
import httpProxy from 'http-proxy';
import type { IProxyServer } from '@novastorm-ai/core';

const SCRIPT_TAG = '<script src="/nova-overlay.js"></script>';

export class ProxyServer implements IProxyServer {
  private server: http.Server | null = null;
  private proxy: httpProxy | null = null;
  private running = false;
  private projectMapApi: { handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<boolean> } | null = null;

  /** Returns the underlying http.Server (used by WebSocketServer). */
  getHttpServer(): http.Server | null {
    return this.server;
  }

  setProjectMapApi(api: { handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<boolean> }): void {
    this.projectMapApi = api;
  }

  async start(
    targetPort: number,
    proxyPort: number,
    overlayScriptPath: string,
  ): Promise<void> {
    if (this.running) {
      return;
    }

    this.proxy = httpProxy.createProxyServer({
      target: `http://127.0.0.1:${targetPort}`,
      selfHandleResponse: true,
    });

    this.proxy.on('proxyRes', (proxyRes, req, res) => {
      // Strip CSP headers for dev mode
      const headers = { ...proxyRes.headers };
      delete headers['content-security-policy'];
      delete headers['content-security-policy-report-only'];

      const contentType = proxyRes.headers['content-type'] ?? '';
      const isHtml = contentType.includes('text/html');

      if (!isHtml) {
        // Non-HTML: pipe through unchanged, but remove CSP from response
        for (const [key, value] of Object.entries(headers)) {
          if (value !== undefined) {
            res.setHeader(key, value);
          }
        }
        res.writeHead(proxyRes.statusCode ?? 200);
        proxyRes.pipe(res);
        return;
      }

      // HTML: decompress if needed, inject script, send uncompressed
      const encoding = proxyRes.headers['content-encoding'];
      let stream: NodeJS.ReadableStream = proxyRes;

      if (encoding === 'gzip') {
        stream = proxyRes.pipe(zlib.createGunzip());
      } else if (encoding === 'br') {
        stream = proxyRes.pipe(zlib.createBrotliDecompress());
      } else if (encoding === 'deflate') {
        stream = proxyRes.pipe(zlib.createInflate());
      }

      const chunks: Buffer[] = [];
      stream.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
      });

      stream.on('error', () => {
        // If decompression fails, send 502
        if (!res.headersSent) {
          res.writeHead(502, { 'Content-Type': 'text/plain' });
          res.end('Nova Proxy: failed to decompress response');
        }
      });

      stream.on('end', () => {
        let body = Buffer.concat(chunks).toString('utf-8');

        if (body.includes('</body>')) {
          body = body.replace('</body>', `${SCRIPT_TAG}</body>`);
        } else if (body.includes('</html>')) {
          body = body.replace('</html>', `${SCRIPT_TAG}</html>`);
        } else {
          body += SCRIPT_TAG;
        }

        // Remove content-length and content-encoding since we modified + decompressed
        delete headers['content-length'];
        delete headers['content-encoding'];
        delete headers['transfer-encoding'];

        for (const [key, value] of Object.entries(headers)) {
          if (value !== undefined) {
            res.setHeader(key, value);
          }
        }
        res.writeHead(proxyRes.statusCode ?? 200);
        res.end(body);
      });
    });

    const proxyRef = this.proxy;
    this.proxy.on('error', (err, req, res) => {
      // Retry with IPv6 loopback if IPv4 fails
      if (res instanceof http.ServerResponse && !res.headersSent) {
        proxyRef.web(req, res, { target: `http://[::1]:${targetPort}` }, (retryErr) => {
          if (res instanceof http.ServerResponse && !res.headersSent) {
            res.writeHead(502, { 'Content-Type': 'text/html' });
            res.end(`
              <html><body style="font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
                <div style="text-align:center">
                  <h2>Nova Proxy</h2>
                  <p>Waiting for dev server on port ${targetPort}...</p>
                  <p style="color:#888">This page will auto-refresh.</p>
                  <script>setTimeout(() => location.reload(), 2000)</script>
                </div>
              </body></html>
            `);
          }
        });
      }
    });

    this.server = http.createServer((req, res) => {
      // Serve project map page
      if (req.url === '/nova-project-map') {
        const mapPath = path.join(import.meta.dirname, '..', 'static', 'project-map.html');
        fs.readFile(mapPath, (err, data) => {
          if (err) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('project-map.html not found');
            return;
          }
          res.writeHead(200, {
            'Content-Type': 'text/html',
            'Cache-Control': 'no-cache',
          });
          res.end(data);
        });
        return;
      }

      // Project map API
      if (req.url?.startsWith('/nova-api/') && this.projectMapApi) {
        this.projectMapApi.handleRequest(req, res).catch(() => {
          if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Internal server error' }));
          }
        });
        return;
      }

      // Serve overlay script
      if (req.url === '/nova-overlay.js') {
        fs.readFile(overlayScriptPath, (err, data) => {
          if (err) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('nova-overlay.js not found');
            return;
          }
          res.writeHead(200, {
            'Content-Type': 'application/javascript',
            'Cache-Control': 'no-cache',
          });
          res.end(data);
        });
        return;
      }

      // Proxy everything else
      this.proxy!.web(req, res);
    });

    // Proxy WebSocket upgrades (HMR, dev server WS) — skip Nova's own /nova-ws
    this.server.on('upgrade', (req, socket, head) => {
      if (req.url === '/nova-ws') return; // Let Nova's WS server handle this
      this.proxy!.ws(req, socket, head);
    });

    await new Promise<void>((resolve, reject) => {
      this.server!.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
          reject(new Error(`Port ${proxyPort} is already in use`));
        } else {
          reject(err);
        }
      });

      this.server!.listen(proxyPort, () => {
        this.running = true;
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      this.proxy?.close();
      this.server?.close((err) => {
        this.running = false;
        this.server = null;
        this.proxy = null;
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  isRunning(): boolean {
    return this.running;
  }
}
