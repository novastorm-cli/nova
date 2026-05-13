// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OverlayPill } from '../OverlayPill.js';

function createPointerEvent(
  type: string,
  opts: { clientX?: number; clientY?: number; pointerId?: number; bubbles?: boolean } = {},
): PointerEvent {
  return new PointerEvent(type, {
    bubbles: opts.bubbles ?? true,
    clientX: opts.clientX ?? 0,
    clientY: opts.clientY ?? 0,
    pointerId: opts.pointerId ?? 1,
    pointerType: 'mouse',
    isPrimary: true,
  });
}

describe('OverlayPill', () => {
  let pill: OverlayPill;
  let container: HTMLElement;
  let mockStorage: Record<string, string>;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    pill = new OverlayPill();

    mockStorage = {};
    vi.stubGlobal('localStorage', {
      getItem: vi.fn((key: string) => mockStorage[key] ?? null),
      setItem: vi.fn((key: string, value: string) => {
        mockStorage[key] = value;
      }),
      removeItem: vi.fn((key: string) => {
        delete mockStorage[key];
      }),
      clear: vi.fn(() => {
        Object.keys(mockStorage).forEach((k) => delete mockStorage[k]);
      }),
      get length() {
        return Object.keys(mockStorage).length;
      },
      key: vi.fn((i: number) => Object.keys(mockStorage)[i] ?? null),
    });
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  // ── Basic mount / unmount / state ────────────────────────────

  it('mount(container) creates shadow DOM and element is visible in container', () => {
    pill.mount(container);

    const hostEl = container.querySelector('*')!;
    expect(hostEl).not.toBeNull();
    expect(hostEl.shadowRoot).not.toBeNull();
  });

  it('unmount() removes element from container', () => {
    pill.mount(container);
    expect(container.children.length).toBeGreaterThan(0);

    pill.unmount();
    expect(container.children.length).toBe(0);
  });

  it('setState("listening") reflects in DOM via class or attribute', () => {
    pill.mount(container);
    pill.setState('listening');

    const hostEl = container.querySelector('*')!;
    const shadow = hostEl.shadowRoot!;
    const pillEl = shadow.querySelector('[data-state]') ?? hostEl;

    const hasState =
      hostEl.getAttribute('data-state') === 'listening' ||
      hostEl.classList.contains('listening') ||
      (pillEl && pillEl.getAttribute('data-state') === 'listening') ||
      (pillEl && pillEl.classList.contains('listening'));

    expect(hasState).toBe(true);
  });

  it('setState("error") reflects a different state in DOM', () => {
    pill.mount(container);
    pill.setState('error');

    const hostEl = container.querySelector('*')!;
    const shadow = hostEl.shadowRoot!;
    const pillEl = shadow.querySelector('[data-state]') ?? hostEl;

    const hasState =
      hostEl.getAttribute('data-state') === 'error' ||
      hostEl.classList.contains('error') ||
      (pillEl && pillEl.getAttribute('data-state') === 'error') ||
      (pillEl && pillEl.classList.contains('error'));

    expect(hasState).toBe(true);
  });

  // ── Dropdown callbacks ────────────────────────────────────────

  it('onQuickEdit callback is called when Quick Edit is selected from dropdown', () => {
    const handler = vi.fn();
    pill.onQuickEdit(handler);
    pill.mount(container);

    const hostEl = container.querySelector('*')!;
    const shadow = hostEl.shadowRoot!;
    const pillBtn = shadow.querySelector('button.nova-pill') ?? shadow.querySelector('button');
    pillBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    const quickEditItem = shadow.querySelector('[data-mode="quickEdit"]') as HTMLElement;
    expect(quickEditItem).not.toBeNull();
    quickEditItem.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(handler).toHaveBeenCalledTimes(1);
  });

  // ── Position persistence from localStorage ────────────────────

  it('mount reads nova-pill-x / nova-pill-y from localStorage and positions pill there', () => {
    mockStorage['nova-pill-x'] = '200';
    mockStorage['nova-pill-y'] = '300';

    pill.mount(container);

    const hostEl = container.querySelector<HTMLElement>('*')!;
    expect(hostEl).not.toBeNull();
    expect(hostEl.style.left).toBe('200px');
    expect(hostEl.style.top).toBe('300px');
  });

  it('mount clamps saved x to viewport width', () => {
    const maxX = window.innerWidth - 48;
    mockStorage['nova-pill-x'] = String(maxX + 500);
    mockStorage['nova-pill-y'] = '100';

    pill.mount(container);

    const hostEl = container.querySelector<HTMLElement>('*')!;
    expect(hostEl.style.left).toBe(`${maxX}px`);
  });

  it('mount clamps saved y to viewport height', () => {
    const maxY = window.innerHeight - 48;
    mockStorage['nova-pill-x'] = '100';
    mockStorage['nova-pill-y'] = String(maxY + 500);

    pill.mount(container);

    const hostEl = container.querySelector<HTMLElement>('*')!;
    expect(hostEl.style.top).toBe(`${maxY}px`);
  });

  it('mount clamps negative x to 0', () => {
    mockStorage['nova-pill-x'] = '-100';
    mockStorage['nova-pill-y'] = '100';

    pill.mount(container);

    const hostEl = container.querySelector<HTMLElement>('*')!;
    expect(hostEl.style.left).toBe('0px');
  });

  it('mount clamps negative y to 0', () => {
    mockStorage['nova-pill-x'] = '100';
    mockStorage['nova-pill-y'] = '-100';

    pill.mount(container);

    const hostEl = container.querySelector<HTMLElement>('*')!;
    expect(hostEl.style.top).toBe('0px');
  });

  it('mount uses left/top when localStorage is empty (default position)', () => {
    pill.mount(container);

    const hostEl = container.querySelector<HTMLElement>('*')!;
    expect(hostEl.style.left).toBeTruthy();
    expect(hostEl.style.top).toBeTruthy();
    // Should NOT use right/bottom for default position
    expect(hostEl.style.right).toBe('auto');
    expect(hostEl.style.bottom).toBe('auto');
  });

  // ── aria-haspopup and aria-expanded ───────────────────────────

  it('pill button has aria-haspopup="menu" at all times', () => {
    pill.mount(container);

    const hostEl = container.querySelector('*')!;
    const shadow = hostEl.shadowRoot!;
    const pillBtn = shadow.querySelector('button.nova-pill') as HTMLElement;
    expect(pillBtn).not.toBeNull();
    expect(pillBtn.getAttribute('aria-haspopup')).toBe('menu');
  });

  it('aria-expanded is "false" when dropdown is closed', () => {
    pill.mount(container);

    const hostEl = container.querySelector('*')!;
    const shadow = hostEl.shadowRoot!;
    const pillBtn = shadow.querySelector('button.nova-pill') as HTMLElement;
    expect(pillBtn.getAttribute('aria-expanded')).toBe('false');
  });

  it('aria-expanded is "true" when dropdown is open', () => {
    pill.mount(container);

    const hostEl = container.querySelector('*')!;
    const shadow = hostEl.shadowRoot!;
    const pillBtn = shadow.querySelector('button.nova-pill') as HTMLElement;

    // Open dropdown by clicking the pill
    pillBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(pillBtn.getAttribute('aria-expanded')).toBe('true');
  });

  it('aria-expanded returns to "false" when dropdown is closed', () => {
    pill.mount(container);

    const hostEl = container.querySelector('*')!;
    const shadow = hostEl.shadowRoot!;
    const pillBtn = shadow.querySelector('button.nova-pill') as HTMLElement;

    // Open then close
    pillBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(pillBtn.getAttribute('aria-expanded')).toBe('true');

    pillBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(pillBtn.getAttribute('aria-expanded')).toBe('false');
  });

  // ── Pointer event drag with 4px deadzone ─────────────────────

  it('micro-move (<4px) does NOT register as a drag — pill stays in place', () => {
    pill.mount(container);

    const hostEl = container.querySelector<HTMLElement>('*')!;
    const origLeft = hostEl.style.left;
    const origTop = hostEl.style.top;

    const shadow = hostEl.shadowRoot!;
    const pillBtn = shadow.querySelector('button.nova-pill') as HTMLElement;

    // pointerdown at center of pill
    const startClientX = parseInt(origLeft, 10) + 24;
    const startClientY = parseInt(origTop, 10) + 24;
    pillBtn.dispatchEvent(
      createPointerEvent('pointerdown', { clientX: startClientX, clientY: startClientY }),
    );
    // move only 2px — below the 4px deadzone
    document.dispatchEvent(
      createPointerEvent('pointermove', { clientX: startClientX + 2, clientY: startClientY }),
    );
    document.dispatchEvent(
      createPointerEvent('pointerup', { clientX: startClientX + 2, clientY: startClientY }),
    );

    // Position should NOT have changed
    expect(hostEl.style.left).toBe(origLeft);
    expect(hostEl.style.top).toBe(origTop);
  });

  it('move >4px DOES register as a drag — pill changes position', () => {
    pill.mount(container);

    const hostEl = container.querySelector<HTMLElement>('*')!;
    const origLeft = hostEl.style.left;

    const shadow = hostEl.shadowRoot!;
    const pillBtn = shadow.querySelector('button.nova-pill') as HTMLElement;

    pillBtn.dispatchEvent(createPointerEvent('pointerdown', { clientX: 100, clientY: 100 }));
    // move 50px — well above 4px deadzone
    document.dispatchEvent(createPointerEvent('pointermove', { clientX: 150, clientY: 100 }));
    document.dispatchEvent(createPointerEvent('pointerup', { clientX: 150, clientY: 100 }));

    // Pill position should have changed (left increased)
    expect(hostEl.style.left).not.toBe(origLeft);
  });

  it('drag saves position to localStorage on pointerup', () => {
    pill.mount(container);

    const hostEl = container.querySelector<HTMLElement>('*')!;
    const startX = parseInt(hostEl.style.left, 10);
    const startY = parseInt(hostEl.style.top, 10);

    const shadow = hostEl.shadowRoot!;
    const pillBtn = shadow.querySelector('button.nova-pill') as HTMLElement;

    pillBtn.dispatchEvent(
      createPointerEvent('pointerdown', { clientX: startX + 24, clientY: startY + 24 }),
    );
    document.dispatchEvent(
      createPointerEvent('pointermove', { clientX: startX + 124, clientY: startY + 24 }),
    );
    document.dispatchEvent(
      createPointerEvent('pointerup', { clientX: startX + 124, clientY: startY + 24 }),
    );

    expect(mockStorage['nova-pill-x']).toBeTruthy();
    expect(mockStorage['nova-pill-y']).toBeTruthy();
  });

  // ── Dropdown flip based on viewport ───────────────────────────

  it('dropdown opens above pill when near bottom of viewport', () => {
    pill.mount(container);

    const hostEl = container.querySelector<HTMLElement>('*')!;
    // Place pill near bottom of viewport
    const pillTop = window.innerHeight - 60;
    hostEl.style.top = `${pillTop}px`;
    hostEl.style.left = '100px';

    // Mock getBoundingClientRect so positionDropdown sees the right values
    const origGBCR = hostEl.getBoundingClientRect.bind(hostEl);
    hostEl.getBoundingClientRect = () => ({
      top: pillTop,
      bottom: pillTop + 48,
      left: 100,
      right: 148,
      width: 48,
      height: 48,
      x: 100,
      y: pillTop,
      toJSON: () => ({}),
    });

    const shadow = hostEl.shadowRoot!;
    const pillBtn = shadow.querySelector('button.nova-pill') as HTMLElement;
    pillBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    const dropdown = shadow.querySelector('.pill-dropdown') as HTMLElement;
    expect(dropdown).not.toBeNull();
    expect(dropdown.classList.contains('hidden')).toBe(false);

    // Dropdown should be positioned above (bottom style set, top empty)
    expect(dropdown.style.bottom).toBeTruthy();
    expect(dropdown.style.top).toBeFalsy();

    // Restore
    hostEl.getBoundingClientRect = origGBCR;
  });

  it('dropdown opens below pill when near top of viewport', () => {
    pill.mount(container);

    const hostEl = container.querySelector<HTMLElement>('*')!;
    // Place pill near top
    const pillTop = 10;
    hostEl.style.top = `${pillTop}px`;
    hostEl.style.left = '100px';

    // Mock getBoundingClientRect so positionDropdown sees the right values
    const origGBCR = hostEl.getBoundingClientRect.bind(hostEl);
    hostEl.getBoundingClientRect = () => ({
      top: pillTop,
      bottom: pillTop + 48,
      left: 100,
      right: 148,
      width: 48,
      height: 48,
      x: 100,
      y: pillTop,
      toJSON: () => ({}),
    });

    const shadow = hostEl.shadowRoot!;
    const pillBtn = shadow.querySelector('button.nova-pill') as HTMLElement;
    pillBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    const dropdown = shadow.querySelector('.pill-dropdown') as HTMLElement;
    expect(dropdown).not.toBeNull();
    expect(dropdown.classList.contains('hidden')).toBe(false);

    // Dropdown should be positioned below (top style set)
    expect(dropdown.style.top).toBeTruthy();

    // Restore
    hostEl.getBoundingClientRect = origGBCR;
  });

  // ── Platform-aware shortcut glyphs ────────────────────────────

  it('pill menu shows ⌥ glyphs when navigator indicates macOS', () => {
    // Mock macOS platform
    const origPlatform = Object.getOwnPropertyDescriptor(navigator, 'platform');
    Object.defineProperty(navigator, 'platform', {
      value: 'MacIntel',
      configurable: true,
    });

    pill.mount(container);

    const hostEl = container.querySelector('*')!;
    const shadow = hostEl.shadowRoot!;
    const pillBtn = shadow.querySelector('button.nova-pill') as HTMLElement;
    pillBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    // All shortcuts should use ⌥ glyph
    const shortcuts = shadow.querySelectorAll('.shortcut');
    for (const s of shortcuts) {
      expect(s.textContent).toContain('\u2325'); // ⌥
      expect(s.textContent).not.toContain('Alt+');
    }

    // Restore platform
    if (origPlatform) {
      Object.defineProperty(navigator, 'platform', origPlatform);
    }
  });

  it('pill menu shows Alt+ text when not on macOS', () => {
    // Mock non-Mac platform
    const origPlatform = Object.getOwnPropertyDescriptor(navigator, 'platform');
    Object.defineProperty(navigator, 'platform', {
      value: 'Linux x86_64',
      configurable: true,
    });

    pill.mount(container);

    const hostEl = container.querySelector('*')!;
    const shadow = hostEl.shadowRoot!;
    const pillBtn = shadow.querySelector('button.nova-pill') as HTMLElement;
    pillBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    // All shortcuts should use Alt+ text
    const shortcuts = shadow.querySelectorAll('.shortcut');
    for (const s of shortcuts) {
      expect(s.textContent).toContain('Alt+');
      expect(s.textContent).not.toContain('\u2325'); // ⌥
    }

    // Restore platform
    if (origPlatform) {
      Object.defineProperty(navigator, 'platform', origPlatform);
    }
  });

  it('shortcut glyphs use userAgentData?.platform as fallback on macOS', () => {
    // Simulate a scenario where navigator.platform is generic but userAgentData indicates macOS
    const origPlatform = Object.getOwnPropertyDescriptor(navigator, 'platform');
    const origUserAgentData = (navigator as unknown as { userAgentData?: unknown }).userAgentData;

    Object.defineProperty(navigator, 'platform', {
      value: 'Win32',
      configurable: true,
    });
    Object.defineProperty(navigator, 'userAgentData', {
      value: { platform: 'macOS' },
      configurable: true,
    });

    pill.mount(container);

    const hostEl = container.querySelector('*')!;
    const shadow = hostEl.shadowRoot!;
    const pillBtn = shadow.querySelector('button.nova-pill') as HTMLElement;
    pillBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    // Should use ⌥ because userAgentData.platform === 'macOS'
    const shortcuts = shadow.querySelectorAll('.shortcut');
    for (const s of shortcuts) {
      expect(s.textContent).toContain('\u2325');
    }

    // Restore
    if (origPlatform) {
      Object.defineProperty(navigator, 'platform', origPlatform);
    }
    if (origUserAgentData !== undefined) {
      Object.defineProperty(navigator, 'userAgentData', {
        value: origUserAgentData,
        configurable: true,
      });
    } else {
      delete (navigator as unknown as { userAgentData?: unknown }).userAgentData;
    }
  });

  // ── Click vs drag distinction ─────────────────────────────────

  it('pointerdown + small move (<4px) + pointerup opens dropdown (not a drag)', () => {
    pill.mount(container);

    const hostEl = container.querySelector<HTMLElement>('*')!;
    const shadow = hostEl.shadowRoot!;
    const pillBtn = shadow.querySelector('button.nova-pill') as HTMLElement;

    const startX = parseInt(hostEl.style.left, 10);
    const startY = parseInt(hostEl.style.top, 10);

    pillBtn.dispatchEvent(
      createPointerEvent('pointerdown', { clientX: startX + 24, clientY: startY + 24 }),
    );
    document.dispatchEvent(
      createPointerEvent('pointermove', { clientX: startX + 26, clientY: startY + 25 }),
    ); // ~2.2px move
    document.dispatchEvent(
      createPointerEvent('pointerup', { clientX: startX + 26, clientY: startY + 25 }),
    );

    // Dropdown should be open
    const dropdown = shadow.querySelector('.pill-dropdown') as HTMLElement;
    expect(dropdown.classList.contains('hidden')).toBe(false);
    expect(pillBtn.getAttribute('aria-expanded')).toBe('true');
  });

  it('pointerdown + large move (>4px) + pointerup does NOT open dropdown', () => {
    pill.mount(container);

    const hostEl = container.querySelector<HTMLElement>('*')!;
    const shadow = hostEl.shadowRoot!;
    const pillBtn = shadow.querySelector('button.nova-pill') as HTMLElement;

    const startX = parseInt(hostEl.style.left, 10);
    const startY = parseInt(hostEl.style.top, 10);

    pillBtn.dispatchEvent(
      createPointerEvent('pointerdown', { clientX: startX + 24, clientY: startY + 24 }),
    );
    document.dispatchEvent(
      createPointerEvent('pointermove', { clientX: startX + 74, clientY: startY + 24 }),
    ); // 50px move
    document.dispatchEvent(
      createPointerEvent('pointerup', { clientX: startX + 74, clientY: startY + 24 }),
    );

    // Dropdown should still be closed (it was a drag, not a click)
    const dropdown = shadow.querySelector('.pill-dropdown') as HTMLElement;
    expect(dropdown.classList.contains('hidden')).toBe(true);
    expect(pillBtn.getAttribute('aria-expanded')).toBe('false');
  });

  // ── Position clamping during drag ─────────────────────────────

  it('drag cannot move pill beyond left edge of viewport', () => {
    pill.mount(container);

    const hostEl = container.querySelector<HTMLElement>('*')!;
    hostEl.style.top = '100px';
    hostEl.style.left = '100px';

    const shadow = hostEl.shadowRoot!;
    const pillBtn = shadow.querySelector('button.nova-pill') as HTMLElement;

    // Try to drag pill far left, off-screen
    pillBtn.dispatchEvent(createPointerEvent('pointerdown', { clientX: 100, clientY: 100 }));
    document.dispatchEvent(createPointerEvent('pointermove', { clientX: -200, clientY: 100 }));
    document.dispatchEvent(createPointerEvent('pointerup', { clientX: -200, clientY: 100 }));

    const newLeft = parseInt(hostEl.style.left, 10);
    expect(newLeft).toBeGreaterThanOrEqual(0);
  });

  it('drag cannot move pill beyond right edge of viewport', () => {
    pill.mount(container);

    const hostEl = container.querySelector<HTMLElement>('*')!;
    hostEl.style.top = '100px';
    hostEl.style.left = '100px';

    const shadow = hostEl.shadowRoot!;
    const pillBtn = shadow.querySelector('button.nova-pill') as HTMLElement;

    const maxX = window.innerWidth - 48;
    pillBtn.dispatchEvent(createPointerEvent('pointerdown', { clientX: 100, clientY: 100 }));
    document.dispatchEvent(
      createPointerEvent('pointermove', { clientX: maxX + 500, clientY: 100 }),
    );
    document.dispatchEvent(createPointerEvent('pointerup', { clientX: maxX + 500, clientY: 100 }));

    const newLeft = parseInt(hostEl.style.left, 10);
    expect(newLeft).toBeLessThanOrEqual(maxX);
  });
});
