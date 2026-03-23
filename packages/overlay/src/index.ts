export * from './contracts/index.js';
export * from './capture/index.js';
export * from './ui/index.js';
export { WebSocketClient } from './transport/WebSocketClient.js';
export type { BrowserObservation } from './transport/WebSocketClient.js';

import type { NovaEvent } from '@novastorm-ai/core';
import { ScreenshotCapture } from './capture/ScreenshotCapture.js';
import { DomCapture } from './capture/DomCapture.js';
import { VoiceCapture } from './capture/VoiceCapture.js';
import { ConsoleCapture } from './capture/ConsoleCapture.js';
import { CursorTracker } from './capture/CursorTracker.js';
import { GestureRecognizer } from './capture/GestureRecognizer.js';
import { TemporalCorrelator } from './capture/TemporalCorrelator.js';
import { OverlayPill } from './ui/OverlayPill.js';
import { CommandInput } from './ui/CommandInput.js';
import { ElementSelector } from './ui/ElementSelector.js';
import { StatusToast } from './ui/StatusToast.js';
import { TranscriptBar } from './ui/TranscriptBar.js';
import { TaskPanel } from './ui/TaskPanel.js';
import { ActivityLog } from './ui/ActivityLog.js';
import { ElementInspector } from './ui/ElementInspector.js';
import { MultiElementSelector } from './ui/MultiElementSelector.js';
import { SecretConsole } from './ui/SecretConsole.js';
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
  const taskPanel = new TaskPanel();
  const activityLog = new ActivityLog();
  const elementInspector = new ElementInspector();
  const multiSelector = new MultiElementSelector();
  const secretConsole = new SecretConsole();

  // Transport
  const wsClient = new WebSocketClient();

  // State
  let selectedElement: HTMLElement | null = null;
  let lastTranscript = '';
  let isProcessing = false;
  let autoExecute = false; // Skip confirmation for inspector/multi-edit modes
  let voiceStarted = false;
  let awaitingConfirmation = false;
  let awaitingSendConfirmation = false;
  let pendingVoiceCommand = '';
  let autofixInProgress = false;
  let autofixToastId: string | null = null;
  let executingToastId: string | null = null;
  let totalTasks = 0;
  let completedTasks = 0;

  // Gesture tracking
  const cursorTracker = new CursorTracker();
  const gestureRecognizer = new GestureRecognizer(cursorTracker, domCapture);
  const temporalCorrelator = new TemporalCorrelator(cursorTracker, gestureRecognizer, domCapture);
  let gestureModeEnabled = localStorage.getItem('nova-gesture-mode') === 'true';

  function updateCursorTracking(): void {
    const shouldTrack = gestureModeEnabled
      && voiceStarted
      && !elementInspector.isActive()
      && !multiSelector.isActive();
    if (shouldTrack && !cursorTracker.isTracking()) {
      cursorTracker.start();
    } else if (!shouldTrack && cursorTracker.isTracking()) {
      cursorTracker.stop();
    }
  }

  // Install console capture
  consoleCapture.install();

  // Create Nova container outside of React's reach (appended to <html>, not <body>)
  // This ensures the overlay survives React error boundaries and Next.js error pages
  let novaRoot = document.getElementById('nova-root');
  if (!novaRoot) {
    novaRoot = document.createElement('div');
    novaRoot.id = 'nova-root';
    novaRoot.style.position = 'fixed';
    novaRoot.style.top = '0';
    novaRoot.style.left = '0';
    novaRoot.style.width = '0';
    novaRoot.style.height = '0';
    novaRoot.style.overflow = 'visible';
    novaRoot.style.zIndex = '2147483647';
    novaRoot.style.pointerEvents = 'none';
    document.documentElement.appendChild(novaRoot);
  }

  // Mount UI into the indestructible nova-root
  pill.mount(novaRoot);
  transcriptBar.mount(novaRoot);
  taskPanel.mount(novaRoot);
  activityLog.mount(novaRoot);
  elementInspector.mount(novaRoot);
  multiSelector.mount(novaRoot);
  secretConsole.mount(novaRoot);

  // Secret console: send secrets to server
  secretConsole.onSubmit((secrets) => {
    wsClient.sendRaw({ type: 'secrets_submit', data: { secrets } });
  });
  secretConsole.onSkip(() => {
    // No-op — user chose to skip entering secrets
  });

  // Restore inspector popup state after hot reload
  setTimeout(() => elementInspector.restorePopupState(), 300);

  // Element inspector: send directly, auto-execute (no confirmation needed)
  elementInspector.onSubmit((element, instruction) => {
    selectedElement = element;
    autoExecute = true;
    const snapshot = domCapture.captureElement(element);
    const scopedInstruction = `SCOPED EDIT — change ONLY the selected element and its contents. Do NOT modify sibling elements or unrelated parts of the page.

Selected element:
${snapshot}

Instruction: ${instruction}

IMPORTANT: Only modify the minimum code needed. If the element is inside a component, change only the relevant part. Do not restructure, restyle, or rewrite other elements in the same file.`;
    void sendObservation(scopedInstruction);
  });

  // Multi-element selector: send directly, auto-execute
  multiSelector.onSubmit((elements, instruction) => {
    const snapshots = elements.map(({ number, element }) => {
      const snapshot = domCapture.captureElement(element);
      return `[Element ${number}]: ${snapshot}`;
    });
    const combinedInstruction = `${instruction}\n\nMarked elements:\n${snapshots.join('\n\n')}`;
    autoExecute = true;
    void sendObservation(combinedInstruction);
  });

  // Rage click detection: 3+ clicks within 1.5s on same element → open inspector popup
  let rageClicks: Array<{ target: EventTarget | null; time: number }> = [];
  document.addEventListener('click', (e) => {
    // Skip clicks on Nova UI elements
    const target = e.target as HTMLElement;
    if (target.closest('#nova-root') || target.closest('[data-nova-pill]') || target.closest('[data-nova-transcript]')) return;

    const now = Date.now();
    rageClicks.push({ target: e.target, time: now });
    // Keep only recent clicks
    rageClicks = rageClicks.filter(c => now - c.time < 1500);

    // Check for 3+ clicks on the same element
    const sameTarget = rageClicks.filter(c => c.target === e.target);
    if (sameTarget.length >= 3) {
      rageClicks = [];
      // Activate inspector and auto-select this element
      elementInspector.showPopupForElement(target, e.clientX, e.clientY);
    }
  }, true);

  // Watch for removal and re-mount if React or error boundaries nuke the elements
  const overlaySelectors = [
    { attr: 'data-nova-pill', remount: () => { pill.unmount(); pill.mount(novaRoot!); } },
    { attr: 'data-nova-transcript', remount: () => { transcriptBar.unmount(); transcriptBar.mount(novaRoot!); } },
    { attr: 'data-nova-task-panel', remount: () => { taskPanel.unmount(); taskPanel.mount(novaRoot!); } },
    { attr: 'data-nova-activity-log', remount: () => { activityLog.unmount(); activityLog.mount(novaRoot!); } },
    { attr: 'data-nova-inspector', remount: () => { elementInspector.unmount(); elementInspector.mount(novaRoot!); } },
    { attr: 'data-nova-multi-selector', remount: () => { multiSelector.unmount(); multiSelector.mount(novaRoot!); } },
    { attr: 'data-nova-secret-console', remount: () => { secretConsole.unmount(); secretConsole.mount(novaRoot!); } },
  ];

  const overlayObserver = new MutationObserver(() => {
    // Re-create nova-root if it got removed from <html>
    if (!document.getElementById('nova-root')) {
      novaRoot = document.createElement('div');
      novaRoot.id = 'nova-root';
      novaRoot.style.position = 'fixed';
      novaRoot.style.top = '0';
      novaRoot.style.left = '0';
      novaRoot.style.width = '0';
      novaRoot.style.height = '0';
      novaRoot.style.overflow = 'visible';
      novaRoot.style.zIndex = '2147483647';
      novaRoot.style.pointerEvents = 'none';
      document.documentElement.appendChild(novaRoot);
    }

    for (const item of overlaySelectors) {
      if (!novaRoot!.querySelector(`[${item.attr}]`)) {
        try { item.remount(); } catch { /* best-effort */ }
      }
    }
  });

  overlayObserver.observe(document.documentElement, { childList: true, subtree: true });

  // Show console errors in overlay toasts (Fix 2)
  // Track errors to debounce and avoid sending duplicates
  let lastSentError = '';
  let errorDebounce: ReturnType<typeof setTimeout> | null = null;

  consoleCapture.onError((error: string) => {
    // Skip Nova's own logs to avoid loops
    if (error.includes('[Nova]')) return;
    if (error.includes('nova-overlay')) return;
    if (autofixInProgress) return; // Don't report errors while fixing

    const isWarning = error.startsWith('[warn]');
    const isImageIssue = /image|src.*prop|hostname.*not configured|unsplash|picsum|placeholder/i.test(error);
    const isFixableError = /Module not found|Invalid src|Error boundary|SyntaxError|TypeError|Build error|Failed to compile/i.test(error);

    // Show toast for errors (not routine warnings)
    if (!isWarning || isImageIssue) {
      const shortError = error.length > 200 ? error.slice(0, 200) + '...' : error;
      statusToast.show(`Console ${isWarning ? 'warning' : 'error'}: ${shortError}`, isWarning ? 'info' : 'error');
      activityLog.addEntry(shortError, 'error');
    }

    // Send fixable errors/warnings to server for auto-fix
    if (isFixableError || isImageIssue) {
      const errorKey = error.slice(0, 100);
      if (errorKey === lastSentError) return;
      lastSentError = errorKey;

      if (errorDebounce) clearTimeout(errorDebounce);
      errorDebounce = setTimeout(() => {
        wsClient.sendRaw({ type: 'browser_error', data: { error: error.slice(0, 1000) } });
      }, 1500);
    }
  });

  // Track if user has been recording (to detect mic-off as command end)
  let hasRecordedText = false;

  // Mic toggle from TranscriptBar → start/stop VoiceCapture
  transcriptBar.onMicToggle((active: boolean) => {
    if (autofixInProgress) {
      statusToast.show('Build fix in progress — please wait...', 'info', 2000);
      return;
    }
    if (active) {
      // Start recording
      hasRecordedText = false;
      lastTranscript = '';
      voiceCapture.start();
      voiceStarted = true;
      pill.setState('listening');
      updateCursorTracking();
    } else {
      // Stop recording — if there was text, show send confirmation
      voiceCapture.stop();
      voiceStarted = false;
      pill.setState('idle');
      updateCursorTracking();

      if (hasRecordedText && lastTranscript.trim().length >= 3) {
        const text = lastTranscript.trim();
        pendingVoiceCommand = text;
        awaitingSendConfirmation = true;

        transcriptBar.showConfirmation(`Send: "${text.slice(0, 80)}"?`);
      }
      hasRecordedText = false;
    }
  });

  // Language change from TranscriptBar → update VoiceCapture
  transcriptBar.onLanguageChange((lang: string) => {
    voiceCapture.setLanguage(lang);
    const label = lang || 'Auto-detect';
    statusToast.show(`Voice language: ${label}`, 'info', 2000);
  });

  // Typed command from transcript bar input
  transcriptBar.onCommandSubmit((text: string) => {
    pendingVoiceCommand = text;
    awaitingSendConfirmation = true;
    transcriptBar.showConfirmation(`Send: "${text.slice(0, 80)}"?`);
  });

  // Confirmation bar Execute/Cancel handlers (handles both send + task confirm)
  transcriptBar.onConfirmExecute(() => {
    if (awaitingSendConfirmation && pendingVoiceCommand) {
      awaitingSendConfirmation = false;
      const cmd = pendingVoiceCommand;
      pendingVoiceCommand = '';
      void sendObservation(cmd);
    } else if (awaitingConfirmation) {
      awaitingConfirmation = false;
      completedTasks = 0;
      wsClient.sendRaw({ type: 'confirm' });
      statusToast.show('Confirmed!', 'success', 2000);
      pill.setState('processing');
    }
  });

  transcriptBar.onConfirmCancel(() => {
    if (awaitingSendConfirmation) {
      awaitingSendConfirmation = false;
      pendingVoiceCommand = '';
      statusToast.show('Command discarded.', 'info', 2000);
    } else if (awaitingConfirmation) {
      awaitingConfirmation = false;
      wsClient.sendRaw({ type: 'cancel' });
      statusToast.show('Cancelled.', 'info', 2000);
      pill.setState('listening');
    }
  });

  // Restore saved language on boot
  const savedLang = transcriptBar.getSelectedLanguage();
  if (savedLang) {
    voiceCapture.setLanguage(savedLang);
  }

  // Start with mic OFF — user clicks mic button to enable
  pill.setState('idle');
  transcriptBar.setListening(false);

  // Helper: send observation to server
  async function sendObservation(transcript: string): Promise<void> {
    if (isProcessing) return;

    // Block commands during autofix
    if (autofixInProgress) {
      statusToast.show('Build fix in progress — please wait...', 'info', 2000);
      return;
    }

    // If awaiting confirmation, append to existing request instead of sending new one
    if (awaitingConfirmation) {
      wsClient.sendRaw({ type: 'append', data: { text: transcript } });
      statusToast.show(`Added to request: "${transcript}"`, 'info', 3000);
      return;
    }

    isProcessing = true;
    pill.setState('processing');

    try {
      const screenshotBlob = await screenshotCapture.captureViewport();
      const screenshotBase64 = await blobToBase64(screenshotBlob);

      const domSnapshot = selectedElement
        ? domCapture.captureElement(selectedElement)
        : undefined;

      const gestureContext = gestureModeEnabled && !autoExecute
        ? temporalCorrelator.resolve()
        : undefined;

      const observation: BrowserObservation = {
        screenshotBase64,
        domSnapshot,
        transcript,
        currentUrl: window.location.href,
        consoleErrors: consoleCapture.getErrors(),
        timestamp: Date.now(),
        gestureContext: gestureContext?.gestures.length ? gestureContext : undefined,
      };

      console.log(`[Nova] Sending observation: screenshot=${screenshotBase64.length} chars, url=${window.location.href}, transcript="${transcript}", autoExec=${autoExecute}`);
      // Send autoExecute flag alongside observation
      if (autoExecute) {
        wsClient.sendRaw({ type: 'observation', data: { ...observation, autoExecute: true } });
      } else {
        wsClient.send(observation);
      }
      autoExecute = false; // Reset after sending
      cursorTracker.clear();
      temporalCorrelator.clear();
      pill.setState('processing');
      executingToastId = statusToast.show('🧠 AI is thinking... please wait', 'info', 0);
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

  // Collect voice transcripts — update transcript bar, track text
  voiceCapture.onTranscript((result) => {
    transcriptBar.setTranscript(result.text, result.isFinal);

    // Feed transcripts to temporal correlator for gesture correlation
    if (gestureModeEnabled) {
      temporalCorrelator.addTranscript(result);
    }

    // Track that user has spoken something
    if (result.text.trim().length > 0) {
      hasRecordedText = true;
    }

    if (result.isFinal) {
      // Accumulate transcript (speech recognition may fire multiple finals)
      if (result.text.trim().length > 0) {
        lastTranscript = lastTranscript
          ? `${lastTranscript} ${result.text.trim()}`
          : result.text.trim();
      }
    }

    // Feed into command input if visible
    if (commandInput.isVisible()) {
      commandInput.setTranscript(result.text);
    }
  });

  // Pill dropdown: Quick Edit
  pill.onQuickEdit(() => {
    multiSelector.deactivate();
    elementInspector.toggle();
    pill.setActiveMode(elementInspector.isActive() ? 'quickEdit' : 'none');
    if (elementInspector.isActive()) {
      statusToast.show('Quick Edit mode — click any element (Option+I)', 'info', 2000);
    }
  });

  // Pill dropdown: Multi-Edit
  pill.onMultiEdit(() => {
    elementInspector.deactivate();
    multiSelector.toggle();
    pill.setActiveMode(multiSelector.isActive() ? 'multiEdit' : 'none');
    if (multiSelector.isActive()) {
      statusToast.show('Multi-Edit mode — click elements to mark them (Option+K)', 'info', 2000);
    }
  });

  // Pill dropdown: Gesture Mode
  pill.onGestureMode(() => {
    gestureModeEnabled = !gestureModeEnabled;
    localStorage.setItem('nova-gesture-mode', String(gestureModeEnabled));
    pill.setGestureModeActive(gestureModeEnabled);
    updateCursorTracking();
    if (gestureModeEnabled) {
      statusToast.show('Gesture Mode ON \u2014 point at elements while speaking (Option+G)', 'info', 2000);
    } else {
      statusToast.show('Gesture Mode OFF', 'info', 1500);
    }
  });

  // Set initial gesture mode visual
  pill.setGestureModeActive(gestureModeEnabled);

  // Keyboard mutual exclusion for inspector modes
  document.addEventListener('keydown', (e) => {
    if (e.altKey && e.code === 'KeyI') {
      // Quick Edit toggled via keyboard — sync state
      setTimeout(() => {
        if (elementInspector.isActive()) {
          multiSelector.deactivate();
          pill.setActiveMode('quickEdit');
        } else {
          pill.setActiveMode('none');
        }
        updateCursorTracking();
      }, 10);
    }
    if (e.altKey && e.code === 'KeyK') {
      // Multi-Edit toggled via keyboard — sync state
      setTimeout(() => {
        if (multiSelector.isActive()) {
          elementInspector.deactivate();
          pill.setActiveMode('multiEdit');
        } else {
          pill.setActiveMode('none');
        }
        updateCursorTracking();
      }, 10);
    }
    if (e.altKey && e.code === 'KeyM') {
      e.preventDefault();
      window.open('/nova-project-map', '_blank');
    }
    if (e.altKey && e.code === 'KeyG') {
      e.preventDefault();
      gestureModeEnabled = !gestureModeEnabled;
      localStorage.setItem('nova-gesture-mode', String(gestureModeEnabled));
      pill.setGestureModeActive(gestureModeEnabled);
      updateCursorTracking();
      if (gestureModeEnabled) {
        statusToast.show('Gesture Mode ON \u2014 point at elements while speaking (Option+G)', 'info', 2000);
      } else {
        statusToast.show('Gesture Mode OFF', 'info', 1500);
      }
    }
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

  // Activity log: reasoning chunk accumulation
  let lastReasoningEntry: HTMLElement | null = null;
  let reasoningBuffer = '';

  // Handle events from server
  wsClient.onEvent((event: NovaEvent) => {
    switch (event.type) {
      case 'task_completed':
        completedTasks++;
        taskPanel.setTaskCompleted(event.data.taskId, event.data.commitHash);
        activityLog.addEntry(`Done: ${event.data.taskId}`, 'success');
        // Only finish when ALL tasks done
        if (completedTasks >= totalTasks && totalTasks > 0) {
          if (executingToastId) {
            statusToast.dismiss(executingToastId);
            executingToastId = null;
          }
          pill.setState('listening');
          statusToast.show(`All ${totalTasks} task(s) completed! Reloading...`, 'success');
          totalTasks = 0;
          completedTasks = 0;
          // Reload page to pick up changes via hot reload
          setTimeout(() => window.location.reload(), 1500);
        }
        break;
      case 'task_failed':
        completedTasks++;
        taskPanel.setTaskFailed(event.data.taskId, event.data.error);
        activityLog.addEntry(`Failed: ${event.data.taskId}${event.data.error ? ' - ' + event.data.error : ''}`, 'error');
        // Count failed as completed for tracking
        if (completedTasks >= totalTasks && totalTasks > 0) {
          if (executingToastId) {
            statusToast.dismiss(executingToastId);
            executingToastId = null;
          }
          pill.setState('error');
          statusToast.show('Some tasks failed. Check task panel.', 'error');
          totalTasks = 0;
          completedTasks = 0;
        }
        break;
      case 'task_started':
        pill.setState('processing');
        taskPanel.setTaskStarted(event.data.taskId);
        activityLog.addEntry(`Starting: ${event.data.taskId}`, 'info');
        break;
      case 'llm_chunk':
        // Show brief phase status instead of raw code in task panel
        if (event.data.taskId) {
          const phaseLabel = event.data.phase === 'reasoning' ? 'Thinking...' : 'Generating code...';
          taskPanel.setStreamingText(event.data.taskId, phaseLabel, event.data.phase);
        }
        // Activity log: accumulate reasoning, detect file writes in code
        if (event.data.phase === 'reasoning') {
          reasoningBuffer += event.data.text;
          if (lastReasoningEntry) {
            activityLog.updateLastEntry(reasoningBuffer.slice(-200));
          } else {
            lastReasoningEntry = activityLog.addEntry(event.data.text, 'thinking');
          }
        } else {
          if (reasoningBuffer) {
            lastReasoningEntry = null;
            reasoningBuffer = '';
          }
          if (event.data.text.includes('=== FILE:')) {
            const match = event.data.text.match(/=== FILE: (.+?) ===/);
            if (match) activityLog.addEntry(`Writing: ${match[1]}`, 'code');
          }
        }
        break;
      case 'task_created': {
        // Dismiss thinking toast
        if (executingToastId) { statusToast.dismiss(executingToastId); executingToastId = null; }
        const td = event.data as { id?: string; description?: string; lane?: number };
        if (td.id && td.description) {
          taskPanel.addTask({ id: td.id, description: td.description, lane: td.lane ?? 3 });
          totalTasks = Math.max(totalTasks, 1);
        }
        activityLog.addEntry(`Task: ${td.description} (Lane ${td.lane})`, 'info');
        break;
      }
      case 'secrets_required': {
        const { envVars } = event.data as { envVars: string[] };
        if (envVars && envVars.length > 0) {
          secretConsole.show(envVars);
        }
        break;
      }
      case 'analysis_complete': {
        const { fileCount, methodCount } = event.data as { fileCount: number; methodCount: number };
        statusToast.show(`Project analyzed: ${fileCount} files, ${methodCount} methods`, 'success', 4000);
        activityLog.addEntry(`Project analyzed: ${fileCount} files, ${methodCount} methods`, 'success');
        break;
      }
      case 'status': {
        const msg = event.data.message;
        activityLog.addEntry(msg, 'info');
        // Show confirmation toast with buttons for pending tasks
        if (msg.startsWith('question:')) {
          // AI is asking a clarifying question — show it with input for answer
          if (executingToastId) { statusToast.dismiss(executingToastId); executingToastId = null; }
          pill.setState('idle');
          const question = msg.slice('question:'.length).trim();
          activityLog.addEntry(`🤔 AI asks: ${question}`, 'thinking');

          // Show question in transcript bar and await the user's answer
          awaitingSendConfirmation = true;
          pendingVoiceCommand = '';

          void transcriptBar.askQuestion(`🤔 ${question}`).then((answer) => {
            awaitingSendConfirmation = false;
            if (answer) {
              void sendObservation(`Answer to question "${question}": ${answer}`);
            } else {
              statusToast.show('Question dismissed.', 'info', 2000);
            }
          });
        } else if (msg.startsWith('Pending:')) {
          // Dismiss "AI is thinking" toast
          if (executingToastId) { statusToast.dismiss(executingToastId); executingToastId = null; }
          awaitingConfirmation = true;
          pill.setState('idle');

          // Show task panel if structured tasks are included
          const statusTasks = (event.data as { tasks?: Array<{ id: string; description: string; lane: number }> }).tasks;
          if (statusTasks && statusTasks.length > 0) {
            taskPanel.setPendingTasks(statusTasks);
            totalTasks = statusTasks.length;
            completedTasks = 0;
          }

          // Show confirmation above transcript bar (persistent until Execute/Cancel)
          const taskCount = statusTasks?.length ?? 0;
          const shortMsg = `${taskCount} task(s) ready. Execute?`;
          transcriptBar.showConfirmation(shortMsg);
        } else if (msg === 'autofix_start') {
          autofixInProgress = true;
          pill.setState('processing');
          autofixToastId = statusToast.show('Fixing build errors... please wait', 'info', 0);
        } else if (msg === 'autofix_end') {
          autofixInProgress = false;
          if (autofixToastId) {
            statusToast.dismiss(autofixToastId);
            autofixToastId = null;
          }
          pill.setState('idle');
          statusToast.show('Build fix applied! Reloading...', 'success', 3000);
          // Reload page after short delay to pick up hot-reload changes
          setTimeout(() => window.location.reload(), 1500);
        } else if (msg === 'autofix_failed') {
          autofixInProgress = false;
          if (autofixToastId) {
            statusToast.dismiss(autofixToastId);
            autofixToastId = null;
          }
          pill.setState('error');
          statusToast.show('Auto-fix failed. Check console for details.', 'error');
        } else if (msg.startsWith('Confirmed!')) {
          pill.setState('processing');
          executingToastId = statusToast.show(msg, 'info', 0);
        } else {
          statusToast.show(msg, 'info');
        }
        break;
      }
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
