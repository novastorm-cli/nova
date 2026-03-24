import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import http from 'node:http';
import net from 'node:net';
import WebSocket from 'ws';
import { WebSocketServer as NovaWsServer } from '../WebSocketServer.js';
import type { Observation, NovaEvent } from '@novastorm-ai/core';

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

describe('WebSocketServer', () => {
  let httpServer: http.Server;
  let wsServer: InstanceType<typeof NovaWsServer>;
  let port: number;
  let clients: WebSocket[] = [];

  beforeEach(async () => {
    port = await getRandomPort();
    wsServer = new NovaWsServer();

    httpServer = http.createServer();
    await new Promise<void>((resolve) => {
      httpServer.listen(port, () => resolve());
    });

    wsServer.start(httpServer);
    clients = [];
  });

  afterEach(async () => {
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.close();
      }
    }
    await new Promise<void>((resolve) => {
      httpServer.close(() => resolve());
    });
  });

  function connectClient(): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://localhost:${port}/nova-ws`);
      clients.push(ws);
      ws.on('open', () => resolve(ws));
      ws.on('error', reject);
    });
  }

  it('accepts WS connection on /nova-ws', async () => {
    const ws = await connectClient();
    expect(ws.readyState).toBe(WebSocket.OPEN);
  });

  it('client sends Observation JSON and onObservation callback is called', async () => {
    const handler = vi.fn();
    wsServer.onObservation(handler);

    const ws = await connectClient();

    const observation: Observation = {
      screenshot: Buffer.from('fake-screenshot'),
      currentUrl: 'http://localhost:3000/dashboard',
      timestamp: Date.now(),
      consoleErrors: ['TypeError: x is not a function'],
    };

    ws.send(JSON.stringify(observation));

    // Wait for the message to be processed
    await waitFor(100);

    expect(handler).toHaveBeenCalledOnce();
    const received = handler.mock.calls[0][0];
    expect(received.currentUrl).toBe(observation.currentUrl);
    expect(received.timestamp).toBe(observation.timestamp);
    expect(received.consoleErrors).toEqual(observation.consoleErrors);
  });

  it('sendEvent() delivers NovaEvent JSON to connected client', async () => {
    const ws = await connectClient();

    const receivedMessages: NovaEvent[] = [];
    ws.on('message', (data) => {
      receivedMessages.push(JSON.parse(data.toString()));
    });

    // Small delay so the connection is fully registered
    await waitFor(50);

    const event: NovaEvent = {
      type: 'status',
      data: { message: 'processing your request' },
    };

    wsServer.sendEvent(event);

    await waitFor(100);

    expect(receivedMessages).toHaveLength(1);
    expect(receivedMessages[0]).toMatchObject(event);
  });

  it('getClientCount() returns 0 initially, then 1 after connection', async () => {
    expect(wsServer.getClientCount()).toBe(0);

    await connectClient();
    // Small delay for server to register the connection
    await waitFor(50);

    expect(wsServer.getClientCount()).toBe(1);
  });
});
