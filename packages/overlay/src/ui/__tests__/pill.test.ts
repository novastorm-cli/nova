// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OverlayPill } from '../OverlayPill.js';

describe('OverlayPill', () => {
  let pill: OverlayPill;
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    pill = new OverlayPill();

    const mockStorage: Record<string, string> = {};
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

  it('mount(container) creates shadow DOM and element is visible in container', () => {
    pill.mount(container);

    // Shadow DOM should be attached to an element inside the container
    const hostEl = container.querySelector('*');
    expect(hostEl).not.toBeNull();
    expect(hostEl!.shadowRoot).not.toBeNull();
  });

  it('setState("listening") reflects in DOM via class or attribute', () => {
    pill.mount(container);
    pill.setState('listening');

    const hostEl = container.querySelector('*')!;
    const shadow = hostEl.shadowRoot!;
    const pillEl = shadow.querySelector('[data-state]') ?? hostEl;

    // Check either the host or an inner element reflects the state
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

  it('onActivate callback is called on click', () => {
    const handler = vi.fn();
    pill.onActivate(handler);
    pill.mount(container);

    const hostEl = container.querySelector('*')!;
    const shadow = hostEl.shadowRoot!;
    // Click the pill element (could be the host or an inner element)
    const clickTarget = shadow.querySelector('button') ?? shadow.querySelector('div') ?? hostEl;
    clickTarget.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('unmount() removes element from container', () => {
    pill.mount(container);
    expect(container.children.length).toBeGreaterThan(0);

    pill.unmount();
    expect(container.children.length).toBe(0);
  });
});
