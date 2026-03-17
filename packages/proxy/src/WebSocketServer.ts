import { WebSocketServer as WsServer, type WebSocket } from 'ws';
import type http from 'node:http';
import type { IWebSocketServer, Observation, NovaEvent } from '@nova-architect/core';

export class WebSocketServer implements IWebSocketServer {
  private wss: WsServer | null = null;
  private observationHandlers: Array<(observation: Observation) => void> = [];
  private confirmHandlers: Array<() => void> = [];
  private cancelHandlers: Array<() => void> = [];
  private appendHandlers: Array<(text: string) => void> = [];
  private browserErrorHandlers: Array<(error: string) => void> = [];

  start(httpServer: http.Server): void {
    this.wss = new WsServer({
      server: httpServer,
      path: '/nova-ws',
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

          // Overlay sends { type: 'observation', data: BrowserObservation }
          const obsData = parsed.data ?? parsed;

          // Build proper Observation from BrowserObservation
          const observation: Observation = {
            screenshot: obsData.screenshotBase64
              ? Buffer.from(obsData.screenshotBase64, 'base64')
              : (obsData.screenshot instanceof Buffer ? obsData.screenshot : Buffer.alloc(0)),
            clickCoords: obsData.clickCoords,
            domSnapshot: obsData.domSnapshot,
            transcript: obsData.transcript,
            currentUrl: obsData.currentUrl ?? '',
            consoleErrors: obsData.consoleErrors,
            timestamp: obsData.timestamp ?? Date.now(),
          };

          for (const handler of this.observationHandlers) {
            handler(observation);
          }
        } catch {
          // Ignore malformed messages
        }
      });
    });
  }

  onObservation(handler: (observation: Observation) => void): void {
    this.observationHandlers.push(handler);
  }

  onConfirm(handler: () => void): void {
    this.confirmHandlers.push(handler);
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

  sendEvent(event: NovaEvent): void {
    if (!this.wss) return;

    const payload = JSON.stringify(event);
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
