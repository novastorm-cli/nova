// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { installFocusTrap, getFocusableDescendants } from '../util/focusTrap.js';

/**
 * Helper: creates a modal root with N buttons, tracks focus via event listeners.
 */
function createModal(buttonCount: number): {
  root: HTMLElement;
  buttons: HTMLButtonElement[];
  container: HTMLElement;
} {
  const container = document.createElement('div');
  document.body.appendChild(container);

  const root = document.createElement('div');
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-labelledby', 'test-heading');

  const heading = document.createElement('h2');
  heading.id = 'test-heading';
  heading.textContent = 'Test Modal';
  root.appendChild(heading);

  const buttons: HTMLButtonElement[] = [];
  for (let i = 0; i < buttonCount; i++) {
    const btn = document.createElement('button');
    btn.textContent = `Button ${i + 1}`;
    root.appendChild(btn);
    buttons.push(btn);
  }

  container.appendChild(root);

  return { root, buttons, container };
}

function createModalInShadow(): {
  host: HTMLElement;
  root: HTMLElement;
  buttons: HTMLButtonElement[];
  container: HTMLElement;
} {
  const container = document.createElement('div');
  document.body.appendChild(container);

  const host = document.createElement('div');
  container.appendChild(host);
  const shadow = host.attachShadow({ mode: 'open' });

  const root = document.createElement('div');
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-labelledby', 'test-heading');

  const heading = document.createElement('h2');
  heading.id = 'test-heading';
  heading.textContent = 'Test Modal';
  root.appendChild(heading);

  const buttons: HTMLButtonElement[] = [];
  for (let i = 0; i < 3; i++) {
    const btn = document.createElement('button');
    btn.textContent = `Button ${i + 1}`;
    root.appendChild(btn);
    buttons.push(btn);
  }

  shadow.appendChild(root);

  return { host, root, buttons, container };
}

/**
 * Track which element receives focus via focus event listeners.
 */
function trackFocus(...elements: HTMLElement[]): {
  events: Array<{ target: HTMLElement }>;
  cleanup: () => void;
} {
  const events: Array<{ target: HTMLElement }> = [];
  function handler(e: Event) {
    events.push({ target: e.target as HTMLElement });
  }
  for (const el of elements) {
    el.addEventListener('focus', handler);
  }
  return {
    events,
    cleanup: () => {
      for (const el of elements) {
        el.removeEventListener('focus', handler);
      }
    },
  };
}

describe('installFocusTrap', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  describe('focus management', () => {
    it('focuses the first focusable element on install', () => {
      const { root, buttons } = createModal(3);
      const tracker = trackFocus(...buttons);

      const trap = installFocusTrap(root);

      // First button should receive focus
      expect(tracker.events.length).toBeGreaterThanOrEqual(1);
      expect(tracker.events[0]!.target).toBe(buttons[0]);

      tracker.cleanup();
      trap.release();
    });

    it('restores focus to the previously focused element on release', () => {
      const { root, buttons } = createModal(3);

      // Focus button 2 (simulate opener)
      buttons[2]!.focus();
      const tracker = trackFocus(buttons[2]!);
      tracker.events.length = 0; // clear initial focus event

      const trap = installFocusTrap(root);

      // Clear events from install
      tracker.events.length = 0;

      trap.release();

      // Opener should be re-focused
      expect(tracker.events.length).toBeGreaterThanOrEqual(1);
      expect(tracker.events[0]!.target).toBe(buttons[2]);

      tracker.cleanup();
    });
  });

  describe('Tab cycling', () => {
    it('Tab on last focusable wraps to first', () => {
      const { root, buttons } = createModal(3);
      const tracker = trackFocus(...buttons);

      installFocusTrap(root);
      tracker.events.length = 0; // clear install

      // Tab: 0 → 1
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }),
      );
      expect(tracker.events[0]!.target).toBe(buttons[1]);
      tracker.events.length = 0;

      // Tab: 1 → 2
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }),
      );
      expect(tracker.events[0]!.target).toBe(buttons[2]);
      tracker.events.length = 0;

      // Tab: 2 → 0 (wrap)
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }),
      );
      expect(tracker.events[0]!.target).toBe(buttons[0]);

      tracker.cleanup();
    });

    it('Shift+Tab on first focusable wraps to last', () => {
      const { root, buttons } = createModal(3);
      const tracker = trackFocus(...buttons);

      installFocusTrap(root);
      tracker.events.length = 0;

      // Shift+Tab from index 0 → wraps to index 2
      document.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Tab',
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
      expect(tracker.events[0]!.target).toBe(buttons[2]);

      tracker.cleanup();
    });

    it('Tab advances to next and wraps at end', () => {
      const { root, buttons } = createModal(3);
      const tracker = trackFocus(...buttons);

      installFocusTrap(root);
      tracker.events.length = 0;

      // 0 → 1
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }),
      );
      expect(tracker.events[0]!.target).toBe(buttons[1]);
      tracker.events.length = 0;

      // 1 → 2
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }),
      );
      expect(tracker.events[0]!.target).toBe(buttons[2]);
      tracker.events.length = 0;

      // 2 → 0 (wrap)
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }),
      );
      expect(tracker.events[0]!.target).toBe(buttons[0]);

      tracker.cleanup();
    });

    it('Shift+Tab reverses through focusable elements', () => {
      const { root, buttons } = createModal(3);
      const tracker = trackFocus(...buttons);

      installFocusTrap(root);
      tracker.events.length = 0;

      // 0 → 2 (wrap)
      document.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Tab',
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
      expect(tracker.events[0]!.target).toBe(buttons[2]);
      tracker.events.length = 0;

      // 2 → 1
      document.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Tab',
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
      expect(tracker.events[0]!.target).toBe(buttons[1]);

      tracker.cleanup();
    });
  });

  describe('Escape handling', () => {
    it('Escape releases the trap and restores focus', () => {
      const { root, buttons } = createModal(3);

      // Focus button 2 (pretend it was the opener)
      buttons[2]!.focus();
      const tracker = trackFocus(buttons[2]!);
      tracker.events.length = 0; // clear initial

      installFocusTrap(root);
      tracker.events.length = 0; // clear install focus events

      // Spy on preventDefault to verify handler is active
      const tabEvent = new KeyboardEvent('keydown', {
        key: 'Tab',
        bubbles: true,
        cancelable: true,
      });
      const preventDefaultSpy = vi.spyOn(tabEvent, 'preventDefault');
      document.dispatchEvent(tabEvent);
      // Should be prevented (trap is active)
      expect(preventDefaultSpy).toHaveBeenCalled();

      // Now press Escape
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      );

      // Focus should be restored to the opener
      expect(tracker.events.length).toBeGreaterThanOrEqual(1);
      expect(tracker.events[0]!.target).toBe(buttons[2]);

      // After release, Tab should NOT be prevented anymore
      const tabEvent2 = new KeyboardEvent('keydown', {
        key: 'Tab',
        bubbles: true,
        cancelable: true,
      });
      const preventDefaultSpy2 = vi.spyOn(tabEvent2, 'preventDefault');
      document.dispatchEvent(tabEvent2);
      // Trap is released, so Tab should NOT be prevented
      expect(preventDefaultSpy2).not.toHaveBeenCalled();

      tracker.cleanup();
    });
  });

  describe('with shadow DOM', () => {
    it('prevents default on Tab inside shadow DOM (trap is active)', () => {
      const { host } = createModalInShadow();
      const trap = installFocusTrap(host);

      const tabEvent = new KeyboardEvent('keydown', {
        key: 'Tab',
        bubbles: true,
        cancelable: true,
      });
      const spy = vi.spyOn(tabEvent, 'preventDefault');
      document.dispatchEvent(tabEvent);
      // Trap should prevent default (found focusable elements in shadow)
      expect(spy).toHaveBeenCalled();

      trap.release();
    });

    it('release removes the handler (Tab is no longer prevented)', () => {
      const { host } = createModalInShadow();
      const trap = installFocusTrap(host);

      trap.release();

      const tabEvent = new KeyboardEvent('keydown', {
        key: 'Tab',
        bubbles: true,
        cancelable: true,
      });
      const spy = vi.spyOn(tabEvent, 'preventDefault');
      document.dispatchEvent(tabEvent);
      // Trap is released, so Tab default is NOT prevented
      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe('preventDefault behavior', () => {
    it('prevents default on Tab when trap is active', () => {
      const { root } = createModal(2);
      const trap = installFocusTrap(root);

      const tabEvent = new KeyboardEvent('keydown', {
        key: 'Tab',
        bubbles: true,
        cancelable: true,
      });
      const spy = vi.spyOn(tabEvent, 'preventDefault');
      document.dispatchEvent(tabEvent);
      expect(spy).toHaveBeenCalled();

      trap.release();
    });

    it('does not prevent default on non-Tab keys', () => {
      const { root } = createModal(2);
      const trap = installFocusTrap(root);

      const enterEvent = new KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
        cancelable: true,
      });
      const spy = vi.spyOn(enterEvent, 'preventDefault');
      document.dispatchEvent(enterEvent);
      expect(spy).not.toHaveBeenCalled();

      trap.release();
    });
  });

  describe('edge cases', () => {
    it('getFocusableDescendants returns no duplicates', () => {
      // Construct a DOM tree with nested focusable elements that would
      // previously produce duplicates from the redundant querySelectorAll.
      const root = document.createElement('div');
      document.body.appendChild(root);

      // Nested structure: button inside a div
      const wrapper = document.createElement('div');
      root.appendChild(wrapper);
      const btn1 = document.createElement('button');
      btn1.textContent = 'Nested Button';
      wrapper.appendChild(btn1);

      // Sibling button at root level
      const btn2 = document.createElement('button');
      btn2.textContent = 'Sibling Button';
      root.appendChild(btn2);

      // Deeply nested button
      const outer = document.createElement('div');
      root.appendChild(outer);
      const inner = document.createElement('div');
      outer.appendChild(inner);
      const btn3 = document.createElement('button');
      btn3.textContent = 'Deep Button';
      inner.appendChild(btn3);

      const focusable = getFocusableDescendants(root);

      // Each button should appear exactly once
      expect(focusable.length).toBe(3);
      expect(focusable.filter((el) => el === btn1).length).toBe(1);
      expect(focusable.filter((el) => el === btn2).length).toBe(1);
      expect(focusable.filter((el) => el === btn3).length).toBe(1);

      // Verify order: pre-order traversal (root → wrapper → btn1 → btn2 → outer → inner → btn3)
      // Note: wrapper (div) is not focusable, so btn1 comes first
      expect(focusable[0]).toBe(btn1);
      expect(focusable[1]).toBe(btn2);
      expect(focusable[2]).toBe(btn3);
    });

    it('handles root with no focusable elements gracefully', () => {
      const root = document.createElement('div');
      root.textContent = 'No focusable content';
      document.body.appendChild(root);

      // Should not throw
      const trap = installFocusTrap(root);
      trap.release();
    });

    it('Tab is a no-op when there are no focusable elements', () => {
      const root = document.createElement('div');
      root.textContent = 'No focusable content';
      document.body.appendChild(root);

      const trap = installFocusTrap(root);

      // Should not throw - Tab is not prevented (no focusable elements to cycle through)
      const tabEvent = new KeyboardEvent('keydown', {
        key: 'Tab',
        bubbles: true,
        cancelable: true,
      });
      document.dispatchEvent(tabEvent);
      // No error thrown = passes

      trap.release();
    });

    it('skips hidden or disabled elements', () => {
      const root = document.createElement('div');
      document.body.appendChild(root);

      const visibleBtn = document.createElement('button');
      visibleBtn.textContent = 'Visible';
      root.appendChild(visibleBtn);

      const hiddenBtn = document.createElement('button');
      hiddenBtn.textContent = 'Hidden';
      hiddenBtn.style.display = 'none';
      root.appendChild(hiddenBtn);

      const disabledBtn = document.createElement('button');
      disabledBtn.textContent = 'Disabled';
      disabledBtn.disabled = true;
      root.appendChild(disabledBtn);

      const tracker = trackFocus(visibleBtn, hiddenBtn, disabledBtn);

      const trap = installFocusTrap(root);

      // Only visible button should receive focus
      const focusedTargets = tracker.events.map((e) => e.target);
      expect(focusedTargets).toContain(visibleBtn);
      expect(focusedTargets).not.toContain(hiddenBtn);
      expect(focusedTargets).not.toContain(disabledBtn);

      tracker.cleanup();
      trap.release();
    });
  });
});
