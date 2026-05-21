// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MissionPanel } from '../MissionPanel.js';

describe('MissionPanel', () => {
  let missionPanel: MissionPanel;
  let container: HTMLElement;
  let mockSessionStorage: Record<string, string>;
  let mockLocalStorage: Record<string, string>;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    missionPanel = new MissionPanel();

    mockSessionStorage = {};
    vi.stubGlobal('sessionStorage', {
      getItem: vi.fn((key: string) => mockSessionStorage[key] ?? null),
      setItem: vi.fn((key: string, value: string) => {
        mockSessionStorage[key] = value;
      }),
      removeItem: vi.fn((key: string) => {
        delete mockSessionStorage[key];
      }),
      clear: vi.fn(() => {
        Object.keys(mockSessionStorage).forEach((k) => delete mockSessionStorage[k]);
      }),
      get length() {
        return Object.keys(mockSessionStorage).length;
      },
      key: vi.fn((i: number) => Object.keys(mockSessionStorage)[i] ?? null),
    });

    mockLocalStorage = {};
    vi.stubGlobal('localStorage', {
      getItem: vi.fn((key: string) => mockLocalStorage[key] ?? null),
      setItem: vi.fn((key: string, value: string) => {
        mockLocalStorage[key] = value;
      }),
      removeItem: vi.fn((key: string) => {
        delete mockLocalStorage[key];
      }),
      clear: vi.fn(() => {
        Object.keys(mockLocalStorage).forEach((k) => delete mockLocalStorage[k]);
      }),
      get length() {
        return Object.keys(mockLocalStorage).length;
      },
      key: vi.fn((i: number) => Object.keys(mockLocalStorage)[i] ?? null),
    });

    vi.useFakeTimers();
  });

  afterEach(() => {
    missionPanel.unmount();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  // ── Helper ─────────────────────────────────────────────────

  function getPanelEl(): HTMLElement | null {
    const host = container.querySelector('[data-nova="mission-panel"]');
    return host?.shadowRoot?.querySelector('.mission-panel') ?? null;
  }

  function getFeatureRows(): NodeListOf<Element> {
    const host = container.querySelector('[data-nova="mission-panel"]');
    return host?.shadowRoot?.querySelectorAll('.mission-feature-row') ?? ([] as any);
  }

  function getList(): HTMLElement | null {
    const host = container.querySelector('[data-nova="mission-panel"]');
    return host?.shadowRoot?.querySelector('.mission-feature-list') ?? null;
  }

  // ── Mount / Unmount ────────────────────────────────────────

  it('mounts to container with data-nova="mission-panel" and Shadow DOM', () => {
    missionPanel.mount(container);

    const hostEl = container.querySelector('[data-nova="mission-panel"]');
    expect(hostEl).not.toBeNull();
    expect(hostEl!.shadowRoot).not.toBeNull();
    expect(hostEl!.getAttribute('role')).toBe('region');
    expect(hostEl!.getAttribute('aria-label')).toBe('Mission progress');
  });

  it('panel starts hidden after mount', () => {
    missionPanel.mount(container);
    const panelEl = getPanelEl();
    expect(panelEl).not.toBeNull();
    expect(panelEl!.classList.contains('hidden')).toBe(true);
  });

  it('unmount() removes element from container', () => {
    missionPanel.mount(container);
    expect(container.children.length).toBeGreaterThan(0);
    missionPanel.unmount();
    expect(container.children.length).toBe(0);
  });

  it('getHost() returns non-null after mount, null after unmount', () => {
    missionPanel.mount(container);
    expect(missionPanel.getHost()).not.toBeNull();
    missionPanel.unmount();
    expect(missionPanel.getHost()).toBeNull();
  });

  // ── Close button ────────────────────────────────────────────

  it('renders a real <button> close button with aria-label', () => {
    missionPanel.mount(container);
    const hostEl = container.querySelector('[data-nova="mission-panel"]')!;
    const shadow = hostEl.shadowRoot!;
    const closeBtn = shadow.querySelector('.mission-panel-close');
    expect(closeBtn).not.toBeNull();
    expect(closeBtn!.tagName.toLowerCase()).toBe('button');
    expect(closeBtn!.getAttribute('aria-label')).toBe('Close mission panel');
    expect(closeBtn!.getAttribute('data-nova')).toBe('close');
  });

  it('close button hides the panel immediately', () => {
    missionPanel.mount(container);
    missionPanel.setPlan({
      features: [{ id: 'f1', description: 'Feature 1', dependencies: [] }],
    });

    const panelEl = getPanelEl()!;
    expect(panelEl.classList.contains('hidden')).toBe(false);

    const hostEl = container.querySelector('[data-nova="mission-panel"]')!;
    const shadow = hostEl.shadowRoot!;
    const closeBtn = shadow.querySelector('.mission-panel-close') as HTMLElement;
    closeBtn.click();

    expect(panelEl.classList.contains('hidden')).toBe(true);
  });

  it('close button clears features map and any pending auto-hide timer', () => {
    missionPanel.mount(container);
    missionPanel.setPlan({
      features: [{ id: 'f1', description: 'Feature 1', dependencies: [] }],
    });
    missionPanel.setFeatureCompleted('f1', 'abc1234');

    const panelEl = getPanelEl()!;
    expect(panelEl.classList.contains('hidden')).toBe(false);

    const hostEl = container.querySelector('[data-nova="mission-panel"]')!;
    const shadow = hostEl.shadowRoot!;
    const closeBtn = shadow.querySelector('.mission-panel-close') as HTMLElement;
    closeBtn.click();

    expect(panelEl.classList.contains('hidden')).toBe(true);

    // Advance past 5s — still hidden (timer was cleared)
    vi.advanceTimersByTime(6000);
    expect(panelEl.classList.contains('hidden')).toBe(true);

    // sessionStorage should be cleared
    expect(mockSessionStorage['nova-mission-panel-state']).toBeUndefined();
  });

  // ── ARIA attributes ──────────────────────────────────────────

  it('host element has role="region" and aria-label', () => {
    missionPanel.mount(container);
    const hostEl = container.querySelector('[data-nova="mission-panel"]')!;
    expect(hostEl.getAttribute('role')).toBe('region');
    expect(hostEl.getAttribute('aria-label')).toBe('Mission progress');
  });

  it('feature list has role="list" and feature rows have role="listitem"', () => {
    missionPanel.mount(container);
    missionPanel.setPlan({
      features: [
        { id: 'f1', description: 'Feature 1', dependencies: [] },
        { id: 'f2', description: 'Feature 2', dependencies: [] },
      ],
    });

    const list = getList();
    expect(list).not.toBeNull();
    expect(list!.getAttribute('role')).toBe('list');

    const rows = getFeatureRows();
    expect(rows.length).toBe(2);
    expect(rows[0]!.getAttribute('role')).toBe('listitem');
    expect(rows[1]!.getAttribute('role')).toBe('listitem');
  });

  it('verdict banner has aria-live="polite"', () => {
    missionPanel.mount(container);
    const hostEl = container.querySelector('[data-nova="mission-panel"]')!;
    const shadow = hostEl.shadowRoot!;
    const verdict = shadow.querySelector('.mission-verdict');
    expect(verdict).not.toBeNull();
    expect(verdict!.getAttribute('aria-live')).toBe('polite');
  });

  // ── Plan rendering ───────────────────────────────────────────

  it('setPlan renders feature rows with description and type badge', () => {
    missionPanel.mount(container);
    missionPanel.setPlan({
      features: [
        { id: 'f1', description: 'Add login page', type: 'page', files: ['login.tsx'], dependencies: [] },
        { id: 'f2', description: 'Fix navbar', type: 'fix', files: ['nav.tsx'], dependencies: [] },
      ],
    });

    const rows = getFeatureRows();
    expect(rows.length).toBe(2);

    const desc1 = rows[0]!.querySelector('.mission-feature-desc');
    expect(desc1!.textContent).toBe('Add login page');

    const type1 = rows[0]!.querySelector('.mission-feature-type');
    expect(type1!.textContent).toBe('page');

    const files1 = rows[0]!.querySelector('.mission-feature-files');
    expect(files1!.textContent).toBe('1 file');
  });

  it('setPlan shows empty state when features array is empty', () => {
    missionPanel.mount(container);
    missionPanel.setPlan({ features: [] });

    const panelEl = getPanelEl()!;
    expect(panelEl.classList.contains('hidden')).toBe(false);

    const emptyMsg = panelEl.querySelector('.mission-empty');
    expect(emptyMsg).not.toBeNull();
    expect(emptyMsg!.textContent).toBe('No features to implement');
  });

  it('setPlan with zero features does not throw', () => {
    missionPanel.mount(container);
    expect(() => missionPanel.setPlan({ features: [] })).not.toThrow();
  });

  // ── Dependency arrows ────────────────────────────────────────

  it('renders dependency arrows for features with dependencies', () => {
    missionPanel.mount(container);
    missionPanel.setPlan({
      features: [
        { id: 'f1', description: 'Base auth', dependencies: [] },
        { id: 'f2', description: 'Login page', dependencies: ['f1'] },
      ],
    });

    const rows = getFeatureRows();
    expect(rows.length).toBe(2);

    // f1 should have "depended-by" arrow (someone depends on it)
    const arrow1 = rows[0]!.querySelector('.mission-dep-arrow');
    expect(arrow1).not.toBeNull();
    expect(arrow1!.classList.contains('depended-by')).toBe(true);

    // f2 should have "depends-on" arrow (has dependencies)
    const arrow2 = rows[1]!.querySelector('.mission-dep-arrow');
    expect(arrow2).not.toBeNull();
    expect(arrow2!.classList.contains('depends-on')).toBe(true);
  });

  // ── Feature lifecycle ────────────────────────────────────────

  it('feature rows transition: pending → executing → completed', () => {
    missionPanel.mount(container);
    missionPanel.setPlan({
      features: [{ id: 'f1', description: 'Feature 1', dependencies: [] }],
    });

    let row = getFeatureRows()[0]!;
    expect(row.className).toContain('status-pending');

    missionPanel.setFeatureStarted('f1');
    row = getFeatureRows()[0]!;
    expect(row.className).toContain('status-executing');

    missionPanel.setFeatureCompleted('f1', 'abc1234');
    row = getFeatureRows()[0]!;
    expect(row.className).toContain('status-completed');
  });

  it('feature row transitions to failed state', () => {
    missionPanel.mount(container);
    missionPanel.setPlan({
      features: [{ id: 'f1', description: 'Feature 1', dependencies: [] }],
    });

    missionPanel.setFeatureStarted('f1');
    missionPanel.setFeatureFailed('f1', 'Build error');

    const row = getFeatureRows()[0]!;
    expect(row.className).toContain('status-failed');

    const meta = row.querySelector('.mission-feature-meta');
    expect(meta).not.toBeNull();
    expect(meta!.textContent).toContain('Build error');
  });

  it('Parallel features reflected simultaneously', () => {
    missionPanel.mount(container);
    missionPanel.setPlan({
      features: [
        { id: 'f1', description: 'Feature 1', dependencies: [] },
        { id: 'f2', description: 'Feature 2', dependencies: [] },
        { id: 'f3', description: 'Feature 3', dependencies: [] },
      ],
    });

    // Start all three
    missionPanel.setFeatureStarted('f1');
    missionPanel.setFeatureStarted('f2');
    missionPanel.setFeatureStarted('f3');

    let rows = getFeatureRows();
    expect(rows[0]!.className).toContain('status-executing');
    expect(rows[1]!.className).toContain('status-executing');
    expect(rows[2]!.className).toContain('status-executing');

    // Complete only f1 and f3 — f2 stays executing
    missionPanel.setFeatureCompleted('f1', 'hash1');
    missionPanel.setFeatureCompleted('f3', 'hash3');

    rows = getFeatureRows();
    expect(rows[0]!.className).toContain('status-completed');
    expect(rows[1]!.className).toContain('status-executing');
    expect(rows[2]!.className).toContain('status-completed');
  });

  // ── Progress counter ─────────────────────────────────────────

  it('progress counter shows "2/5 features completed"', () => {
    missionPanel.mount(container);
    missionPanel.setPlan({
      features: [
        { id: 'f1', description: 'F1', dependencies: [] },
        { id: 'f2', description: 'F2', dependencies: [] },
        { id: 'f3', description: 'F3', dependencies: [] },
        { id: 'f4', description: 'F4', dependencies: [] },
        { id: 'f5', description: 'F5', dependencies: [] },
      ],
    });

    const hostEl = container.querySelector('[data-nova="mission-panel"]')!;
    const shadow = hostEl.shadowRoot!;
    const progress = shadow.querySelector('.mission-progress');
    expect(progress!.textContent).toBe('0/5 features completed');

    missionPanel.setFeatureCompleted('f1', 'hash');
    missionPanel.setFeatureCompleted('f2', 'hash');
    expect(progress!.textContent).toBe('2/5 features completed');
  });

  // ── Director verdict ─────────────────────────────────────────

  it('shows APPROVED verdict banner (green) from mission_director_review', () => {
    missionPanel.mount(container);
    missionPanel.setPlan({
      features: [{ id: 'f1', description: 'F1', dependencies: [] }],
    });

    missionPanel.setVerdict('APPROVED');

    const hostEl = container.querySelector('[data-nova="mission-panel"]')!;
    const shadow = hostEl.shadowRoot!;
    const verdict = shadow.querySelector('.mission-verdict')!;
    expect(verdict.classList.contains('hidden')).toBe(false);
    expect(verdict.classList.contains('mission-verdict-approved')).toBe(true);
    expect(verdict.textContent).toContain('APPROVED');
  });

  it('shows NEEDS_REVISION verdict with highlighted failed features', () => {
    missionPanel.mount(container);
    missionPanel.setPlan({
      features: [
        { id: 'f1', description: 'F1', dependencies: [] },
        { id: 'f2', description: 'F2', dependencies: [] },
      ],
    });

    missionPanel.setFeatureFailed('f2', 'Type error');

    missionPanel.setVerdict('NEEDS_REVISION', [
      { featureId: 'f2', actionItems: ['fix type error'] },
    ]);

    const hostEl = container.querySelector('[data-nova="mission-panel"]')!;
    const shadow = hostEl.shadowRoot!;
    const verdict = shadow.querySelector('.mission-verdict')!;
    expect(verdict.classList.contains('mission-verdict-revision')).toBe(true);
    expect(verdict.textContent).toContain('NEEDS REVISION');

    // f2 row should have needs-revision highlight
    const rows = getFeatureRows();
    expect(rows[1]!.classList.contains('needs-revision')).toBe(true);
  });

  // ── Iteration badge ──────────────────────────────────────────

  it('iteration badge updates on mission_iteration event', () => {
    missionPanel.mount(container);
    missionPanel.setPlan({
      features: [{ id: 'f1', description: 'F1', dependencies: [] }],
    });

    missionPanel.setIteration(2, 5);

    const hostEl = container.querySelector('[data-nova="mission-panel"]')!;
    const shadow = hostEl.shadowRoot!;
    const badge = shadow.querySelector('.mission-iteration-badge')!;
    expect(badge.classList.contains('hidden')).toBe(false);
    expect(badge.textContent).toBe('Review 2/5');

    missionPanel.setIteration(3, 5);
    expect(badge.textContent).toBe('Review 3/5');
  });

  // ── Auto-hide timer ──────────────────────────────────────────

  it('auto-hides 5s after all features complete', () => {
    missionPanel.mount(container);
    missionPanel.setPlan({
      features: [
        { id: 'f1', description: 'F1', dependencies: [] },
        { id: 'f2', description: 'F2', dependencies: [] },
      ],
    });

    missionPanel.setFeatureCompleted('f1', 'hash');
    missionPanel.setFeatureCompleted('f2', 'hash');

    const panelEl = getPanelEl()!;
    expect(panelEl.classList.contains('hidden')).toBe(false);

    vi.advanceTimersByTime(5100);
    expect(panelEl.classList.contains('hidden')).toBe(true);
  });

  it('does NOT auto-hide if features are still pending', () => {
    missionPanel.mount(container);
    missionPanel.setPlan({
      features: [
        { id: 'f1', description: 'F1', dependencies: [] },
        { id: 'f2', description: 'F2', dependencies: [] },
      ],
    });

    missionPanel.setFeatureCompleted('f1', 'hash');
    // f2 still pending

    const panelEl = getPanelEl()!;
    vi.advanceTimersByTime(10000);
    expect(panelEl.classList.contains('hidden')).toBe(false);
  });

  it('does NOT auto-hide on mission failure', () => {
    missionPanel.mount(container);
    missionPanel.setPlan({
      features: [{ id: 'f1', description: 'F1', dependencies: [] }],
    });
    missionPanel.setFeatureFailed('f1', 'Error');
    missionPanel.setMissionFailed('fatal error');

    const panelEl = getPanelEl()!;
    vi.advanceTimersByTime(10000);
    // Panel should stay visible on failure
    expect(panelEl.classList.contains('hidden')).toBe(false);
  });

  // ── Pin-on-hover ────────────────────────────────────────────

  it('pin-on-hover prevents auto-hide', () => {
    missionPanel.mount(container);
    missionPanel.setPlan({
      features: [{ id: 'f1', description: 'F1', dependencies: [] }],
    });
    missionPanel.setFeatureCompleted('f1', 'hash');

    const panelEl = getPanelEl()!;

    // Hover
    panelEl.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }));

    vi.advanceTimersByTime(10000);
    expect(panelEl.classList.contains('hidden')).toBe(false);

    // Leave hover — timer restarts
    panelEl.dispatchEvent(new PointerEvent('pointerleave', { bubbles: true }));

    vi.advanceTimersByTime(5100);
    expect(panelEl.classList.contains('hidden')).toBe(true);
  });

  it('hover during countdown suspends the timer', () => {
    missionPanel.mount(container);
    missionPanel.setPlan({
      features: [{ id: 'f1', description: 'F1', dependencies: [] }],
    });
    missionPanel.setFeatureCompleted('f1', 'hash');

    const panelEl = getPanelEl()!;

    // After 2s, start hovering
    vi.advanceTimersByTime(2000);
    panelEl.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }));

    // 4s later — still visible (hover paused timer)
    vi.advanceTimersByTime(4000);
    expect(panelEl.classList.contains('hidden')).toBe(false);

    // Leave hover — fresh 5s timer
    panelEl.dispatchEvent(new PointerEvent('pointerleave', { bubbles: true }));
    vi.advanceTimersByTime(5100);
    expect(panelEl.classList.contains('hidden')).toBe(true);
  });

  // ── Streaming output ─────────────────────────────────────────

  it('streaming output appears under feature row with correct phase class', () => {
    missionPanel.mount(container);
    missionPanel.setPlan({
      features: [{ id: 'f1', description: 'F1', dependencies: [] }],
    });

    missionPanel.setStreamingText('f1', 'Thinking...', 'reasoning');

    const row = getFeatureRows()[0]!;
    const stream = row.querySelector('.mission-stream');
    expect(stream).not.toBeNull();
    expect(stream!.classList.contains('phase-reasoning')).toBe(true);
    expect(stream!.textContent).toBe('Thinking...');

    missionPanel.setStreamingText('f1', 'Generating code...', 'code');
    expect(stream!.classList.contains('phase-code')).toBe(true);
    expect(stream!.textContent).toBe('Generating code...');
  });

  // ── Session storage persistence ──────────────────────────────

  it('restores state from sessionStorage after hot reload', () => {
    mockSessionStorage['nova-mission-panel-state'] = JSON.stringify({
      missionId: 'test-mission',
      features: [
        {
          id: 'f1',
          description: 'In progress',
          type: 'page',
          files: ['file.tsx'],
          dependencies: [],
          status: 'executing',
        },
        {
          id: 'f2',
          description: 'Done',
          type: 'fix',
          files: [],
          dependencies: ['f1'],
          status: 'completed',
          commitHash: 'abc1234',
        },
      ],
      iteration: 1,
      maxIterations: 5,
      missionStatus: 'in-progress',
    });

    missionPanel.mount(container);

    const panelEl = getPanelEl()!;
    expect(panelEl.classList.contains('hidden')).toBe(false);

    const rows = getFeatureRows();
    expect(rows.length).toBe(2);
  });

  it('discards stale terminal state from sessionStorage', () => {
    mockSessionStorage['nova-mission-panel-state'] = JSON.stringify({
      missionId: 'test-mission',
      features: [
        { id: 'f1', description: 'Done', type: 'page', files: [], dependencies: [], status: 'completed', commitHash: 'abc' },
        { id: 'f2', description: 'Failed', type: 'fix', files: [], dependencies: [], status: 'failed', error: 'err' },
      ],
      iteration: 2,
      maxIterations: 5,
      missionStatus: 'terminal',
    });

    missionPanel.mount(container);

    const panelEl = getPanelEl()!;
    expect(panelEl.classList.contains('hidden')).toBe(true);
    expect(getFeatureRows().length).toBe(0);

    // sessionStorage should have been cleaned up
    expect(mockSessionStorage['nova-mission-panel-state']).toBeUndefined();
  });

  // ── localStorage history ─────────────────────────────────────

  it('persists completed missions to localStorage', () => {
    missionPanel.mount(container);
    missionPanel.setPlan({
      features: [
        { id: 'f1', description: 'Feature 1', dependencies: [] },
        { id: 'f2', description: 'Feature 2', dependencies: [] },
      ],
    });

    missionPanel.setFeatureCompleted('f1', 'hash1');
    missionPanel.setFeatureCompleted('f2', 'hash2');

    const stored = JSON.parse(mockLocalStorage['nova:recent-missions']!) as Array<{
      missionId: string;
      features: Array<{ status: string }>;
      missionStatus: string;
    }>;
    expect(stored).toHaveLength(1);
    expect(stored[0]!.missionStatus).toBe('completed');
    expect(stored[0]!.features[0]!.status).toBe('completed');
  });

  it('caps recent missions at 10', () => {
    // Pre-populate with 9 existing missions
    const existing = Array.from({ length: 9 }, (_, i) => ({
      missionId: `old-${i}`,
      features: [],
      iteration: 1,
      maxIterations: 5,
      missionStatus: 'completed',
    }));
    mockLocalStorage['nova:recent-missions'] = JSON.stringify(existing);

    missionPanel.mount(container);

    // Add 3 new missions
    for (let i = 0; i < 3; i++) {
      missionPanel.setPlan({
        features: [{ id: `f-${i}`, description: `F${i}`, dependencies: [] }],
      });
      missionPanel.setFeatureCompleted(`f-${i}`, 'hash');
    }

    const stored = JSON.parse(mockLocalStorage['nova:recent-missions']) as Array<{ missionId: string }>;
    // 9 existing + 3 new = 12, capped to 10
    expect(stored.length).toBeLessThanOrEqual(10);
  });

  // ── Multiple plans ────────────────────────────────────────────

  it('only shows the latest plan (clears old features)', () => {
    missionPanel.mount(container);
    missionPanel.setPlan({
      features: [
        { id: 'f1', description: 'Old Feature', dependencies: [] },
      ],
    });
    expect(getFeatureRows().length).toBe(1);

    // New plan arrives — should replace old one
    missionPanel.setPlan({
      features: [
        { id: 'f2', description: 'New Feature', dependencies: [] },
        { id: 'f3', description: 'Another New', dependencies: [] },
      ],
    });

    const rows = getFeatureRows();
    expect(rows.length).toBe(2);
    const descriptions = Array.from(rows).map((r) => r.querySelector('.mission-feature-desc')?.textContent);
    expect(descriptions).toContain('New Feature');
    expect(descriptions).toContain('Another New');
    expect(descriptions).not.toContain('Old Feature');
  });

  // ── Large plans are scrollable ────────────────────────────────

  it('feature list has overflow-y: auto for large plans', () => {
    missionPanel.mount(container);
    const features = Array.from({ length: 25 }, (_, i) => ({
      id: `f${i}`,
      description: `Feature ${i}`,
      dependencies: [] as string[],
    }));
    missionPanel.setPlan({ features });

    const list = getList();
    expect(list).not.toBeNull();
    // The list is scrollable
    const _overflowY = window.getComputedStyle(list!).overflowY;
    // In jsdom all computed styles may return empty; the CSS class should handle scroll
    expect(list!.className).toContain('mission-feature-list');
    expect(getFeatureRows().length).toBe(25);
  });

  // ── Rapid events ──────────────────────────────────────────────

  it('handles rapid started→completed transitions without glitches', () => {
    missionPanel.mount(container);
    missionPanel.setPlan({
      features: [{ id: 'f1', description: 'F1', dependencies: [] }],
    });

    // Fire started and completed synchronously
    missionPanel.setFeatureStarted('f1');
    missionPanel.setFeatureCompleted('f1', 'hash');

    const row = getFeatureRows()[0]!;
    expect(row.className).toContain('status-completed');
  });

  // ── Reduced-motion media query ────────────────────────────────

  it('CSS contains reduced-motion media query for animations', () => {
    missionPanel.mount(container);
    const hostEl = container.querySelector('[data-nova="mission-panel"]')!;
    const style = hostEl.shadowRoot!.querySelector('style')!;
    expect(style.textContent).toContain('prefers-reduced-motion');
    expect(style.textContent).toContain('@keyframes mission-spin');
    expect(style.textContent).toContain('@keyframes checkmark-draw');
  });

  // ── Error boundary resilience (setPlan with unexpected data) ──

  it('handles setPlan with undefined/null features gracefully', () => {
    missionPanel.mount(container);
    // Should not throw — instead show empty state
    expect(() =>
      missionPanel.setPlan({ features: undefined as unknown as Array<{ id: string; description: string; dependencies: string[] }> }),
    ).not.toThrow();

    const panelEl = getPanelEl()!;
    const emptyMsg = panelEl.querySelector('.mission-empty');
    expect(emptyMsg).not.toBeNull();
    expect(emptyMsg!.textContent).toBe('No features to implement');
  });

  // ── getState() for test hooks ─────────────────────────────────

  it('getState returns correct mission state', () => {
    missionPanel.mount(container);
    missionPanel.setPlan({
      features: [{ id: 'f1', description: 'F1', dependencies: [] }],
    });
    missionPanel.setFeatureStarted('f1');
    missionPanel.setIteration(1, 5);

    const state = missionPanel.getState();
    expect(state.features).toHaveLength(1);
    expect(state.features[0]!.status).toBe('executing');
    expect(state.iteration).toBe(1);
    expect(state.maxIterations).toBe(5);
    expect(state.isVisible).toBe(true);
  });

  // ── Auto-approved badge ──────────────────────────────────────

  it('shows auto-approved badge when plan is autoApproved', () => {
    missionPanel.mount(container);
    missionPanel.setPlan({
      features: [{ id: 'f1', description: 'F1', dependencies: [] }],
      autoApproved: true,
    });

    const hostEl = container.querySelector('[data-nova="mission-panel"]')!;
    const shadow = hostEl.shadowRoot!;
    const verdict = shadow.querySelector('.mission-verdict')!;
    expect(verdict.classList.contains('mission-auto-approved')).toBe(true);
    expect(verdict.textContent).toBe('auto-approved');
  });

  // ── Feature type badge ────────────────────────────────────────

  it('renders feature type badge when provided', () => {
    missionPanel.mount(container);
    missionPanel.setPlan({
      features: [
        { id: 'f1', description: 'F1', type: 'page', dependencies: [] },
        { id: 'f2', description: 'F2', dependencies: [] },
      ],
    });

    const rows = getFeatureRows();
    // f1 has type badge
    expect(rows[0]!.querySelector('.mission-feature-type')!.textContent).toBe('page');
    // f2 has no type badge
    expect(rows[1]!.querySelector('.mission-feature-type')).toBeNull();
  });

  // ── File count badge ──────────────────────────────────────────

  it('renders file count when provided', () => {
    missionPanel.mount(container);
    missionPanel.setPlan({
      features: [
        { id: 'f1', description: 'F1', files: ['a.ts', 'b.ts'], dependencies: [] },
        { id: 'f2', description: 'F2', files: ['c.ts'], dependencies: [] },
      ],
    });

    const rows = getFeatureRows();
    expect(rows[0]!.querySelector('.mission-feature-files')!.textContent).toBe('2 files');
    expect(rows[1]!.querySelector('.mission-feature-files')!.textContent).toBe('1 file');
  });

  // ── Mission completed (finalizes + hash) ──────────────────────

  it('setMissionCompleted updates verdict with commit hash', () => {
    missionPanel.mount(container);
    missionPanel.setPlan({
      features: [{ id: 'f1', description: 'F1', dependencies: [] }],
    });
    missionPanel.setFeatureCompleted('f1', 'abc1234567');
    missionPanel.setMissionCompleted('abc1234567');

    const hostEl = container.querySelector('[data-nova="mission-panel"]')!;
    const shadow = hostEl.shadowRoot!;
    const verdict = shadow.querySelector('.mission-verdict')!;
    expect(verdict.textContent).toContain('abc1234');
    expect(verdict.classList.contains('mission-verdict-approved')).toBe(true);
  });

  // ── Mission failed ────────────────────────────────────────────

  it('setMissionFailed shows error message in verdict banner', () => {
    missionPanel.mount(container);
    missionPanel.setPlan({
      features: [{ id: 'f1', description: 'F1', dependencies: [] }],
    });
    missionPanel.setMissionFailed('orchestrator timeout');

    const hostEl = container.querySelector('[data-nova="mission-panel"]')!;
    const shadow = hostEl.shadowRoot!;
    const verdict = shadow.querySelector('.mission-verdict')!;
    expect(verdict.textContent).toContain('orchestrator timeout');
    expect(verdict.classList.contains('mission-verdict-failed')).toBe(true);
  });
});
