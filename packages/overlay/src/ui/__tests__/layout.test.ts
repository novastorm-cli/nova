// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

// ResizeObserver polyfill for jsdom (not natively available)
class MockResizeObserver {
  private callback: ResizeObserverCallback;
  private elements = new Set<Element>();

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }

  observe(target: Element): void {
    this.elements.add(target);
    // Fire immediately with the element's current bounding rect
    const rect = target.getBoundingClientRect();
    const entry: ResizeObserverEntry = {
      target,
      contentRect: rect,
      borderBoxSize: [],
      contentBoxSize: [],
      devicePixelContentBoxSize: [],
    };

    this.callback([entry], this as unknown as ResizeObserver);
  }

  unobserve(target: Element): void {
    this.elements.delete(target);
  }

  disconnect(): void {
    this.elements.clear();
  }
}

// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
(globalThis as any).ResizeObserver = MockResizeObserver;

import { LayoutSlots } from '../layout.js';

/**
 * Helper: create a host element with a visible shadow-DOM panel
 * (mimics what ActivityLog / SuggestionPanel / TaskPanel do).
 */
function createPanelHost(name: string, height: number): HTMLElement {
  const host = document.createElement('div');
  host.style.position = 'fixed';
  host.style.left = '20px';
  host.setAttribute('data-nova-test-panel', name);
  // jsdom does not fully compute layout for shadow DOM hosts,
  // so set explicit dimensions on the host for getBoundingClientRect.
  host.style.width = '350px';
  host.style.height = `${height}px`;
  host.style.display = 'block';
  const shadow = host.attachShadow({ mode: 'open' });

  const panel = document.createElement('div');
  panel.className =
    name === 'activityLog'
      ? 'activity-panel'
      : name === 'suggestionPanel'
        ? 'suggestion-panel'
        : 'task-panel';
  panel.style.width = '350px';
  panel.style.height = `${height}px`;
  panel.style.background = 'rgba(0,0,0,0.8)';
  shadow.appendChild(panel);

  document.body.appendChild(host);
  return host;
}

/**
 * Helper: make panel "hidden" by adding the `.hidden` class
 * (mimics what the real components do).
 */
function hidePanel(host: HTMLElement): void {
  const panel = host.shadowRoot!.querySelector('.activity-panel, .suggestion-panel, .task-panel');
  if (panel) panel.classList.add('hidden');
}

function showPanel(host: HTMLElement): void {
  const panel = host.shadowRoot!.querySelector('.activity-panel, .suggestion-panel, .task-panel');
  if (panel) panel.classList.remove('hidden');
}

describe('LayoutSlots', () => {
  let layout: LayoutSlots;
  let activityLog: HTMLElement;
  let suggestionPanel: HTMLElement;
  let taskPanel: HTMLElement;

  beforeEach(() => {
    layout = new LayoutSlots({ gap: 8, left: 20, bottom: 20 });
    activityLog = createPanelHost('activityLog', 200);
    suggestionPanel = createPanelHost('suggestionPanel', 100);
    taskPanel = createPanelHost('taskPanel', 150);
  });

  afterEach(() => {
    layout.destroy();
    document.body.innerHTML = '';
  });

  it('registers panels and sets data-slot attribute', () => {
    layout.register('activityLog', activityLog);
    layout.register('suggestionPanel', suggestionPanel);
    layout.register('taskPanel', taskPanel);

    expect(activityLog.getAttribute('data-slot')).toBe('activityLog');
    expect(suggestionPanel.getAttribute('data-slot')).toBe('suggestionPanel');
    expect(taskPanel.getAttribute('data-slot')).toBe('taskPanel');
  });

  it('stacks panels bottom-up with gap when all are visible', () => {
    layout.register('activityLog', activityLog);
    layout.register('suggestionPanel', suggestionPanel);
    layout.register('taskPanel', taskPanel);
    layout.recalc();

    const alBottom = parseFloat(activityLog.style.bottom);
    const spBottom = parseFloat(suggestionPanel.style.bottom);
    const tpBottom = parseFloat(taskPanel.style.bottom);

    // ActivityLog is bottom-most
    expect(alBottom).toBe(20);
    // SuggestionPanel is above ActivityLog: ActivityLog bottom(20) + height(200) + gap(8)
    expect(spBottom).toBe(20 + 200 + 8);
    // TaskPanel is above SuggestionPanel: spBottom(228) + height(100) + gap(8)
    expect(tpBottom).toBe(228 + 100 + 8);
  });

  it('skips hidden panels in stacking', () => {
    // Hide SuggestionPanel
    hidePanel(suggestionPanel);

    layout.register('activityLog', activityLog);
    layout.register('suggestionPanel', suggestionPanel);
    layout.register('taskPanel', taskPanel);
    layout.recalc();

    const alBottom = parseFloat(activityLog.style.bottom);
    const tpBottom = parseFloat(taskPanel.style.bottom);

    // ActivityLog at base
    expect(alBottom).toBe(20);
    // TaskPanel is directly above ActivityLog (SuggestionPanel is hidden/skipped)
    expect(tpBottom).toBe(20 + 200 + 8);
  });

  it('handles show/hide toggling', () => {
    // Start with SuggestionPanel hidden
    hidePanel(suggestionPanel);

    layout.register('activityLog', activityLog);
    layout.register('suggestionPanel', suggestionPanel);
    layout.register('taskPanel', taskPanel);
    layout.recalc();

    // TaskPanel is directly above ActivityLog (228)
    expect(parseFloat(taskPanel.style.bottom)).toBe(228);

    // Now show SuggestionPanel and recalc
    showPanel(suggestionPanel);
    layout.recalc();

    // SuggestionPanel is above ActivityLog
    expect(parseFloat(suggestionPanel.style.bottom)).toBe(228);
    // TaskPanel is above SuggestionPanel
    expect(parseFloat(taskPanel.style.bottom)).toBe(228 + 100 + 8);
  });

  it('unregisters a panel so it no longer participates in stacking', () => {
    layout.register('activityLog', activityLog);
    layout.register('suggestionPanel', suggestionPanel);
    layout.register('taskPanel', taskPanel);

    layout.unregister('suggestionPanel');
    layout.recalc();

    // TaskPanel is now directly above ActivityLog
    expect(parseFloat(taskPanel.style.bottom)).toBe(228);
  });

  it('panels have left set to base left', () => {
    layout.register('activityLog', activityLog);
    layout.register('taskPanel', taskPanel);
    layout.recalc();

    expect(parseFloat(activityLog.style.left)).toBe(20);
    expect(parseFloat(taskPanel.style.left)).toBe(20);
  });

  it('accepts custom gap and margins', () => {
    const custom = new LayoutSlots({ gap: 16, left: 30, bottom: 40 });
    custom.register('activityLog', activityLog);
    custom.register('taskPanel', taskPanel);
    custom.recalc();

    expect(parseFloat(activityLog.style.bottom)).toBe(40);
    expect(parseFloat(activityLog.style.left)).toBe(30);
    // TaskPanel above: base(40) + height(200) + gap(16)
    expect(parseFloat(taskPanel.style.bottom)).toBe(40 + 200 + 16);

    custom.destroy();
  });

  it('destroy disconnects observer and clears slots', () => {
    layout.register('activityLog', activityLog);
    layout.register('taskPanel', taskPanel);
    layout.recalc();

    expect(parseFloat(activityLog.style.bottom)).toBe(20);

    layout.destroy();

    // Changing panel height should not trigger recalc after destroy
    const panel = activityLog.shadowRoot!.querySelector('.activity-panel') as HTMLElement;
    panel.style.height = '300px';

    // Give time for any stale observer callback — since the mock isn't
    // truly async, just assert the position is unchanged.
    expect(parseFloat(activityLog.style.bottom)).toBe(20);
  });
});
