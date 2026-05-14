import { WebSocketServer as WsServer, type WebSocket } from 'ws';
import crypto from 'node:crypto';
import type http from 'node:http';
import type { IWebSocketServer, Observation, NovaEvent } from '@novastorm-ai/core';

export class WebSocketServer implements IWebSocketServer {
  private wss: WsServer | null = null;
  private observationHandlers: Array<(observation: Observation, autoExecute?: boolean) => void> =
    [];
  private confirmHandlers: Array<() => void> = [];
  private confirmTasksHandlers: Array<(taskIds?: string[]) => void> = [];
  private cancelHandlers: Array<() => void> = [];
  private appendHandlers: Array<(text: string) => void> = [];
  private browserErrorHandlers: Array<(error: string) => void> = [];
  private secretsSubmitHandlers: Array<(secrets: Record<string, string>) => void> = [];
  private revertFileHandlers: Array<(filePath: string) => void> = [];
  private sessionToken: string | null = null;
  private proxyPort: number | null = null;

  /** Set the current session token for WS upgrade auth. */
  setSessionToken(token: string): void {
    this.sessionToken = token;
  }

  /** Set the proxy port for Origin header validation. */
  setProxyPort(port: number): void {
    this.proxyPort = port;
  }

  /**
   * Constant-time comparison of two strings to prevent timing attacks.
   * Both strings must be the same length.
   */
  private constantTimeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    return crypto.timingSafeEqual(bufA, bufB);
  }

  /**
   * Validate the Origin header against allowed origins.
   * Only allows localhost or 127.0.0.1 on the proxy port.
   */
  private isValidOrigin(origin: string | undefined): boolean {
    if (!origin) return false;
    if (this.proxyPort === null) return false;

    const allowedOrigins = [
      `http://localhost:${this.proxyPort}`,
      `http://127.0.0.1:${this.proxyPort}`,
    ];

    return allowedOrigins.includes(origin);
  }

  /**
   * Parse the token query parameter from a URL.
   * Returns null if no token is present.
   */
  private parseTokenFromUrl(url: string | undefined): string | null {
    if (!url) return null;
    try {
      // Use a simple regex to extract ?token=... from the URL
      const match = url.match(/[?&]token=([^&]*)/);
      return match ? decodeURIComponent(match[1]) : null;
    } catch {
      return null;
    }
  }

  start(httpServer: http.Server): void {
    this.wss = new WsServer({ noServer: true });

    const sessionToken = this.sessionToken;

    // Manually handle upgrade only for /nova-ws — let other WS paths
    // (e.g. Next.js HMR /_next/webpack-hmr) pass through to the proxy
    httpServer.on('upgrade', (req, socket, head) => {
      if (req.url === '/nova-ws' || req.url?.startsWith('/nova-ws?')) {
        // Require session token for WS auth
        if (sessionToken) {
          const token = this.parseTokenFromUrl(req.url);
          const origin = req.headers['origin'];

          // Validate token (constant-time compare)
          if (!token || !this.constantTimeEqual(token, sessionToken)) {
            socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
            socket.destroy();
            return;
          }

          // Validate Origin header
          if (!this.isValidOrigin(origin)) {
            socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
            socket.destroy();
            return;
          }
        }

        try {
          this.wss!.handleUpgrade(req, socket, head, (ws) => {
            this.wss!.emit('connection', ws, req);
          });
        } catch {
          socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
          socket.destroy();
        }
        return;
      }
      // Non-nova-ws upgrades are handled by ProxyServer's upgrade handler
    });

    this.wss.on('connection', (ws: WebSocket) => {
      ws.on('message', (data: Buffer | string) => {
        try {
          const raw = typeof data === 'string' ? data : data.toString('utf-8');
          const parsed = JSON.parse(raw);

          // Handle confirm/cancel messages from overlay
          if (parsed.type === 'confirm') {
            for (const handler of this.confirmHandlers) {
              handler();
            }
            return;
          }
          if (parsed.type === 'confirm_tasks') {
            const taskIds = parsed.data?.taskIds as string[] | undefined;
            for (const handler of this.confirmTasksHandlers) {
              handler(taskIds);
            }
            return;
          }
          if (parsed.type === 'cancel') {
            for (const handler of this.cancelHandlers) {
              handler();
            }
            return;
          }
          if (parsed.type === 'append') {
            const text = parsed.data?.text ?? '';
            for (const handler of this.appendHandlers) {
              handler(text);
            }
            return;
          }
          if (parsed.type === 'browser_error') {
            const error = parsed.data?.error ?? '';
            for (const handler of this.browserErrorHandlers) {
              handler(error);
            }
            return;
          }
          if (parsed.type === 'secrets_submit') {
            const secrets = parsed.data?.secrets ?? {};
            for (const handler of this.secretsSubmitHandlers) {
              handler(secrets as Record<string, string>);
            }
            return;
          }
          if (parsed.type === 'revert_file') {
            const filePath = (parsed as { path?: string }).path ?? '';
            for (const handler of this.revertFileHandlers) {
              handler(filePath);
            }
            return;
          }

          // Overlay sends { type: 'observation', data: BrowserObservation }
          const obsData = parsed.data ?? parsed;

          // Build proper Observation from BrowserObservation
          const observation: Observation = {
            screenshot: obsData.screenshotBase64
              ? Buffer.from(obsData.screenshotBase64, 'base64')
              : obsData.screenshot instanceof Buffer
                ? obsData.screenshot
                : Buffer.alloc(0),
            clickCoords: obsData.clickCoords,
            domSnapshot: obsData.domSnapshot,
            transcript: obsData.transcript,
            currentUrl: obsData.currentUrl ?? '',
            consoleErrors: obsData.consoleErrors,
            timestamp: obsData.timestamp ?? Date.now(),
            gestureContext: obsData.gestureContext,
          };

          const autoExecute = obsData.autoExecute === true;

          for (const handler of this.observationHandlers) {
            handler(observation, autoExecute);
          }
        } catch {
          // Ignore malformed messages
        }
      });
    });
  }

  onObservation(handler: (observation: Observation, autoExecute?: boolean) => void): void {
    this.observationHandlers.push(handler);
  }

  onConfirm(handler: () => void): void {
    this.confirmHandlers.push(handler);
  }

  onConfirmTasks(handler: (taskIds?: string[]) => void): void {
    this.confirmTasksHandlers.push(handler);
  }

  onCancel(handler: () => void): void {
    this.cancelHandlers.push(handler);
  }

  onAppend(handler: (text: string) => void): void {
    this.appendHandlers.push(handler);
  }

  onBrowserError(handler: (error: string) => void): void {
    this.browserErrorHandlers.push(handler);
  }

  onSecretsSubmit(handler: (secrets: Record<string, string>) => void): void {
    this.secretsSubmitHandlers.push(handler);
  }

  onRevertFile(handler: (filePath: string) => void): void {
    this.revertFileHandlers.push(handler);
  }

  private lastTs = 0;

  sendEvent(event: NovaEvent): void {
    if (!this.wss) return;

    // Monotonic timestamp: ensure each event gets a unique _ts even in same tick
    let ts = Date.now();
    if (ts <= this.lastTs) ts = this.lastTs + 1;
    this.lastTs = ts;

    const payload = JSON.stringify({ ...event, _ts: ts });
    for (const client of this.wss.clients) {
      if (client.readyState === 1 /* WebSocket.OPEN */) {
        client.send(payload);
      }
    }
  }

  getClientCount(): number {
    return this.wss?.clients.size ?? 0;
  }
}
