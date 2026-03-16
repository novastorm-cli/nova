import type { NovaEvent } from '@nova-architect/core';

/**
 * Browser Observation payload sent over WebSocket.
 * Uses base64 for screenshot instead of Node Buffer.
 */
export interface BrowserObservation {
  screenshotBase64: string;
  clickCoords?: { x: number; y: number };
  domSnapshot?: string;
  transcript?: string;
  currentUrl: string;
  consoleErrors?: string[];
  timestamp: number;
}

type EventCallback = (event: NovaEvent) => void;

const MAX_RETRIES = 5;
const RECONNECT_DELAY_MS = 1000;

export class WebSocketClient {
  private ws: WebSocket | null = null;
  private url = '';
  private eventCallbacks: EventCallback[] = [];
  private retryCount = 0;
  private closed = false;

  connect(url: string): void {
    this.url = url;
    this.closed = false;
    this.retryCount = 0;
    this.openConnection();
  }

  send(observation: BrowserObservation): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn('[Nova] WebSocket not connected, dropping observation');
      return;
    }

    const message = JSON.stringify({
      type: 'observation' as const,
      data: observation,
    });
    this.ws.send(message);
  }

  onEvent(callback: EventCallback): void {
    this.eventCallbacks.push(callback);
  }

  disconnect(): void {
    this.closed = true;
    this.ws?.close();
    this.ws = null;
  }

  private openConnection(): void {
    if (this.closed) return;

    try {
      this.ws = new WebSocket(this.url);
    } catch (err) {
      console.error('[Nova] Failed to create WebSocket:', err);
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.retryCount = 0;
    };

    this.ws.onmessage = (event: MessageEvent) => {
      try {
        const parsed = JSON.parse(event.data as string) as NovaEvent;
        for (const cb of this.eventCallbacks) {
          cb(parsed);
        }
      } catch (err) {
        console.error('[Nova] Failed to parse WebSocket message:', err);
      }
    };

    this.ws.onclose = () => {
      this.ws = null;
      this.scheduleReconnect();
    };

    this.ws.onerror = () => {
      // onclose will fire after onerror, reconnect is handled there
    };
  }

  private scheduleReconnect(): void {
    if (this.closed) return;

    if (this.retryCount >= MAX_RETRIES) {
      console.error(`[Nova] WebSocket reconnect failed after ${MAX_RETRIES} attempts`);
      return;
    }

    this.retryCount++;
    setTimeout(() => this.openConnection(), RECONNECT_DELAY_MS);
  }
}
