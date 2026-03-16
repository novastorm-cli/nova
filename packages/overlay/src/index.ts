export * from './contracts/index.js';
export * from './capture/index.js';
export * from './ui/index.js';
export { WebSocketClient } from './transport/WebSocketClient.js';
export type { BrowserObservation } from './transport/WebSocketClient.js';

import type { NovaEvent } from '@nova-architect/core';
import { ScreenshotCapture } from './capture/ScreenshotCapture.js';
import { DomCapture } from './capture/DomCapture.js';
import { VoiceCapture } from './capture/VoiceCapture.js';
import { ConsoleCapture } from './capture/ConsoleCapture.js';
import { OverlayPill } from './ui/OverlayPill.js';
import { CommandInput } from './ui/CommandInput.js';
import { ElementSelector } from './ui/ElementSelector.js';
import { StatusToast } from './ui/StatusToast.js';
import { TranscriptBar } from './ui/TranscriptBar.js';
import { WebSocketClient } from './transport/WebSocketClient.js';
import type { BrowserObservation } from './transport/WebSocketClient.js';

const DEFAULT_PORT = 3001;

function getPort(): number {
  const script = document.querySelector('script[data-nova-port]');
  if (script) {
    const port = parseInt(script.getAttribute('data-nova-port') ?? '', 10);
    if (!isNaN(port) && port > 0) return port;
  }
  return DEFAULT_PORT;
}

async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      // Strip the data:...;base64, prefix
      const base64 = result.split(',')[1] ?? result;
      resolve(base64);
    };
    reader.onerror = () => reject(new Error('Failed to read blob as base64'));
    reader.readAsDataURL(blob);
  });
}

function boot(): void {
  // Capture modules
  const screenshotCapture = new ScreenshotCapture();
  const domCapture = new DomCapture();
  const voiceCapture = new VoiceCapture();
  const consoleCapture = new ConsoleCapture();

  // UI modules
  const pill = new OverlayPill();
  const commandInput = new CommandInput();
  const elementSelector = new ElementSelector();
  const statusToast = new StatusToast();
  const transcriptBar = new TranscriptBar();

  // Transport
  const wsClient = new WebSocketClient();

  // State
  let selectedElement: HTMLElement | null = null;
  let lastTranscript = '';
  let isProcessing = false;

  // Install console capture
  consoleCapture.install();

  // Mount UI
  pill.mount(document.body);
  transcriptBar.mount(document.body);

  // Try to auto-start voice (may fail without user gesture in Chrome)
  let voiceStarted = false;
  try {
    voiceCapture.start();
    voiceStarted = true;
    pill.setState('listening');
    transcriptBar.setListening(true);
  } catch {
    // Browser requires user gesture — will start on first pill click
    pill.setState('idle');
    transcriptBar.setListening(false);
    statusToast.show('Click the mic button to enable voice', 'info', 5000);
  }

  // Helper: send observation to server
  async function sendObservation(transcript: string): Promise<void> {
    if (isProcessing) return;
    isProcessing = true;
    pill.setState('processing');

    try {
      const screenshotBlob = await screenshotCapture.captureViewport();
      const screenshotBase64 = await blobToBase64(screenshotBlob);

      const domSnapshot = selectedElement
        ? domCapture.captureElement(selectedElement)
        : undefined;

      const observation: BrowserObservation = {
        screenshotBase64,
        domSnapshot,
        transcript,
        currentUrl: window.location.href,
        consoleErrors: consoleCapture.getErrors(),
        timestamp: Date.now(),
      };

      wsClient.send(observation);
      statusToast.show('Command sent to Nova', 'info');
      pill.setState('listening');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[Nova] Failed to send observation:', message);
      statusToast.show(`Failed to send: ${message}`, 'error');
      pill.setState('error');
    } finally {
      isProcessing = false;
    }

    selectedElement = null;
    lastTranscript = '';
  }

  // Collect voice transcripts — always update transcript bar
  voiceCapture.onTranscript((result) => {
    transcriptBar.setTranscript(result.text, result.isFinal);

    if (result.isFinal) {
      lastTranscript = result.text;
    }

    // Feed into command input if visible
    if (commandInput.isVisible()) {
      commandInput.setTranscript(result.text);
    }

    // Auto-submit final transcripts of sufficient length
    if (result.isFinal && result.text.trim().length >= 10) {
      const text = result.text.trim();
      statusToast.show(`Voice command: ${text}`, 'info');
      void sendObservation(text);
    }
  });

  // Pill click -> start voice on first click, then toggle element selector
  pill.onActivate(() => {
    // First click: start voice if not yet started (browser requires user gesture)
    if (!voiceStarted) {
      voiceCapture.start();
      voiceStarted = true;
      pill.setState('listening');
      transcriptBar.setListening(true);
      statusToast.show('Voice enabled! Start speaking.', 'success', 3000);
      return;
    }

    // Subsequent clicks: toggle element selector
    if (elementSelector.isActive()) {
      elementSelector.deactivate();
      return;
    }
    elementSelector.activate();
  });

  // Element selected -> show command input
  elementSelector.onSelect((element) => {
    selectedElement = element;
    const pillHost = document.querySelector('[data-nova-pill]') as HTMLElement | null;
    commandInput.show(pillHost ?? document.body);
  });

  // Element selector cancelled — voice stays on
  elementSelector.onCancel(() => {
    pill.setState('listening');
  });

  // Command input closed — voice stays on
  commandInput.onClose(() => {
    commandInput.hide();
    pill.setState('listening');
    selectedElement = null;
  });

  // Typed command submitted -> capture everything and send (voice stays on)
  commandInput.onSubmit(async (text) => {
    commandInput.hide();
    await sendObservation(text || lastTranscript);
  });

  // Handle events from server
  wsClient.onEvent((event: NovaEvent) => {
    switch (event.type) {
      case 'task_completed':
        pill.setState('listening');
        statusToast.show('Task completed successfully', 'success');
        break;
      case 'task_failed':
        pill.setState('error');
        statusToast.show(`Task failed: ${event.data.error}`, 'error');
        break;
      case 'task_started':
        pill.setState('processing');
        statusToast.show('Nova is working...', 'info');
        break;
      case 'status':
        statusToast.show(event.data.message, 'info');
        break;
    }
  });

  // Connect WebSocket
  const port = getPort();
  wsClient.connect(`ws://localhost:${port}/nova-ws`);
}

// Self-executing on DOMContentLoaded
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
