import { WebSocketServer as WsServer, type WebSocket } from 'ws';
import type http from 'node:http';
import type { IWebSocketServer, Observation, NovaEvent } from '@nova-architect/core';

export class WebSocketServer implements IWebSocketServer {
  private wss: WsServer | null = null;
  private observationHandlers: Array<(observation: Observation) => void> = [];

  start(httpServer: http.Server): void {
    this.wss = new WsServer({
      server: httpServer,
      path: '/nova-ws',
    });

    this.wss.on('connection', (ws: WebSocket) => {
      ws.on('message', (data: Buffer | string) => {
        try {
          const raw = typeof data === 'string' ? data : data.toString('utf-8');
          const observation = JSON.parse(raw) as Observation;

          // Convert screenshot back to Buffer if it was serialized
          if (
            observation.screenshot &&
            typeof observation.screenshot === 'string'
          ) {
            observation.screenshot = Buffer.from(
              observation.screenshot as unknown as string,
              'base64',
            );
          }

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
