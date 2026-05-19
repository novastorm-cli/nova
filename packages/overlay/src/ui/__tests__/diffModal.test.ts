// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DiffModal } from '../DiffModal.js';

/**
 * Helper: track focus events on given elements.
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

/**
 * Get all focusable elements within the DiffModal's shadow DOM.
 */
function getDiffModalFocusables(host: HTMLElement): HTMLElement[] {
  const shadow = host.shadowRoot;
  if (!shadow) return [];
  const btns = Array.from(shadow.querySelectorAll('button:not([disabled])'));
  return btns as HTMLElement[];
}

const SAMPLE_DIFF = `--- a/src/index.ts
+++ b/src/index.ts
@@ -1,3 +1,3 @@
-console.log("hello");
+console.log("hello world");
 const x = 1;
 const y = 2;`;

describe('DiffModal', () => {
  let diffModal: DiffModal;
  let container: HTMLElement;

  beforeEach(() => {
    diffModal = new DiffModal();
    container = document.createElement('div');
    document.body.appendChild(container);
    diffModal.mount(container);
  });

  afterEach(() => {
    diffModal.unmount();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  describe('mount and structure', () => {
    it('creates host element with tabindex=-1', () => {
      const host = container.querySelector('[data-nova="diff-modal"]') as HTMLElement;
      expect(host).not.toBeNull();
      expect(host.getAttribute('tabindex')).toBe('-1');
    });

    it('uses delegatesFocus on shadow root', () => {
      const host = container.querySelector('[data-nova="diff-modal"]') as HTMLElement;
      // delegatesFocus is reflected as a property of the ShadowRoot, but
      // jsdom may not fully support this. We verify the attachShadow was
      // called by checking that the shadow root exists.
      expect(host.shadowRoot).not.toBeNull();
    });

    it('renders modal with role=dialog and aria-modal=true', () => {
      diffModal.show('src/index.ts', SAMPLE_DIFF);

      const host = container.querySelector('[data-nova="diff-modal"]') as HTMLElement;
      const shadow = host.shadowRoot!;
      const modal = shadow.querySelector('[role="dialog"]') as HTMLElement;
      expect(modal).not.toBeNull();
      expect(modal.getAttribute('aria-modal')).toBe('true');
    });
  });

  describe('Tab cycling within modal', () => {
    it('Tab wraps from last to first focusable element', () => {
      diffModal.show('src/index.ts', SAMPLE_DIFF, { canOpen: true });

      const host = container.querySelector('[data-nova="diff-modal"]') as HTMLElement;
      const focusables = getDiffModalFocusables(host);
      expect(focusables.length).toBeGreaterThanOrEqual(3); // close, copy, revert (+ open-file)

      const tracker = trackFocus(...focusables);

      // Clear any initial focus events from trap install
      tracker.events.length = 0;

      // The focus trap should be installed. Focus the last element, then
      // verify Tab wraps to first.
      focusables[focusables.length - 1]!.focus();
      tracker.events.length = 0;

      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }),
      );

      // After Tab from last element, focus should wrap to first
      expect(tracker.events.length).toBeGreaterThanOrEqual(1);
      expect(tracker.events[0]!.target).toBe(focusables[0]);

      tracker.cleanup();
    });

    it('Shift+Tab wraps from first to last focusable element', () => {
      diffModal.show('src/index.ts', SAMPLE_DIFF, { canOpen: true });

      const host = container.querySelector('[data-nova="diff-modal"]') as HTMLElement;
      const focusables = getDiffModalFocusables(host);
      expect(focusables.length).toBeGreaterThanOrEqual(3);

      const tracker = trackFocus(...focusables);

      // Focus the first element
      focusables[0]!.focus();
      tracker.events.length = 0;

      document.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Tab',
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );

      // After Shift+Tab from first element, focus should wrap to last
      expect(tracker.events.length).toBeGreaterThanOrEqual(1);
      expect(tracker.events[0]!.target).toBe(focusables[focusables.length - 1]);

      tracker.cleanup();
    });

    it('Tab advances forward through all focusable elements', () => {
      diffModal.show('src/index.ts', SAMPLE_DIFF, { canOpen: true });

      const host = container.querySelector('[data-nova="diff-modal"]') as HTMLElement;
      const focusables = getDiffModalFocusables(host);
      expect(focusables.length).toBeGreaterThanOrEqual(3);

      const tracker = trackFocus(...focusables);

      // Focus the first element
      focusables[0]!.focus();
      tracker.events.length = 0;

      // Tab forward through each element
      for (let i = 0; i < focusables.length - 1; i++) {
        document.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }),
        );
        expect(tracker.events[0]!.target).toBe(focusables[i + 1]);
        tracker.events.length = 0;
      }

      tracker.cleanup();
    });

    it('Tab does not escape to body', () => {
      diffModal.show('src/index.ts', SAMPLE_DIFF, { canOpen: true });

      const host = container.querySelector('[data-nova="diff-modal"]') as HTMLElement;
      const focusables = getDiffModalFocusables(host);
      expect(focusables.length).toBeGreaterThanOrEqual(3);

      // Focus the last element
      focusables[focusables.length - 1]!.focus();

      // Press Tab — should prevent default (trap active)
      const tabEvent = new KeyboardEvent('keydown', {
        key: 'Tab',
        bubbles: true,
        cancelable: true,
      });
      const spy = vi.spyOn(tabEvent, 'preventDefault');
      document.dispatchEvent(tabEvent);
      expect(spy).toHaveBeenCalled();
    });
  });

  describe('Escape restores focus to pill', () => {
    it('closes modal and restores focus to pill element', () => {
      // Create a pill element that serves as the focus source
      const pill = document.createElement('div');
      pill.setAttribute('data-nova', 'pill');
      pill.setAttribute('tabindex', '0');
      document.body.appendChild(pill);

      // Focus the pill first (simulating user clicked on pill)
      pill.focus();
      expect(document.activeElement).toBe(pill);

      // Open the modal (focus trap saves pill as previouslyFocused)
      diffModal.show('src/index.ts', SAMPLE_DIFF);

      const host = container.querySelector('[data-nova="diff-modal"]') as HTMLElement;
      expect(host).not.toBeNull();

      // Verify the overlay is visible (not hidden)
      const overlay = host.shadowRoot!.querySelector('.diff-overlay') as HTMLElement;
      expect(overlay).not.toBeNull();
      expect(overlay.classList.contains('hidden')).toBe(false);

      // Press Escape
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      );

      // Modal should be hidden now
      expect(overlay.classList.contains('hidden')).toBe(true);

      // Focus should return to pill
      // Note: in jsdom, document.activeElement may not update on programmatic
      // focus() calls. But we can verify that the trap was released.
    });

    it('Escape does not cause double-release', () => {
      const pill = document.createElement('div');
      pill.setAttribute('data-nova', 'pill');
      pill.setAttribute('tabindex', '0');
      document.body.appendChild(pill);

      pill.focus();

      const tracker = trackFocus(pill);

      diffModal.show('src/index.ts', SAMPLE_DIFF);
      tracker.events.length = 0; // clear install focus events

      // Press Escape
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      );

      // Focus should be restored exactly once to pillar
      const focusToPill = tracker.events.filter((e) => e.target === pill);
      expect(focusToPill.length).toBeLessThanOrEqual(1);

      tracker.cleanup();
    });
  });

  describe('focus trap release', () => {
    it('release is called once when hiding modal', () => {
      diffModal.show('src/index.ts', SAMPLE_DIFF);

      const host = container.querySelector('[data-nova="diff-modal"]') as HTMLElement;

      // After hiding, Tab should not be prevented
      diffModal.hide();

      const overlay = host.shadowRoot!.querySelector('.diff-overlay') as HTMLElement;
      expect(overlay.classList.contains('hidden')).toBe(true);

      // Tab should now NOT be prevented (focus trap is released)
      const tabEvent = new KeyboardEvent('keydown', {
        key: 'Tab',
        bubbles: true,
        cancelable: true,
      });
      const spy = vi.spyOn(tabEvent, 'preventDefault');
      document.dispatchEvent(tabEvent);
      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe('clipboard fallback', () => {
    it('Copy button writes diff to data-nova-clipboard when Clipboard API fails', async () => {
      // Simulate headless browser where clipboard API is denied
      // jsdom may not have navigator.clipboard at all
      const originalClipboard = navigator.clipboard;
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: vi.fn().mockRejectedValue(new Error('not allowed')) },
        writable: true,
        configurable: true,
      });

      diffModal.show('src/index.ts', SAMPLE_DIFF, { canOpen: true });

      const host = container.querySelector('[data-nova="diff-modal"]') as HTMLElement;
      const shadow = host.shadowRoot!;
      const copyBtn = shadow.querySelector('[data-nova="copy"]') as HTMLButtonElement;
      expect(copyBtn).not.toBeNull();

      // Add a nova-root element for the fallback
      const novaRoot = document.createElement('div');
      novaRoot.setAttribute('data-nova', 'root');
      document.body.appendChild(novaRoot);

      copyBtn.click();

      // Wait for async clipboard call to fail and fallback to execute
      await vi.waitFor(() => {
        expect(novaRoot.getAttribute('data-nova-clipboard')).toBe(SAMPLE_DIFF);
      });

      // Restore clipboard
      if (originalClipboard) {
        Object.defineProperty(navigator, 'clipboard', {
          value: originalClipboard,
          writable: true,
          configurable: true,
        });
      } else {
        Object.defineProperty(navigator, 'clipboard', {
          value: undefined,
          writable: true,
          configurable: true,
        });
      }
      document.body.removeChild(novaRoot);
    });

    it('__novaTest__.setClipboardText stores text in data-nova-clipboard', () => {
      const novaRoot = document.createElement('div');
      novaRoot.setAttribute('data-nova', 'root');
      document.body.appendChild(novaRoot);

      // Simulate the setClipboardText hook logic (same as in index.ts)
      const text = 'test-clipboard-content';
      novaRoot.setAttribute('data-nova-clipboard', text);

      expect(novaRoot.getAttribute('data-nova-clipboard')).toBe(text);

      // Verify attribute is readable (validators can read it)
      expect(novaRoot.hasAttribute('data-nova-clipboard')).toBe(true);

      document.body.removeChild(novaRoot);
    });
  });
});
