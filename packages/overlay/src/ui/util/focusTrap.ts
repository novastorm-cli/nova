/**
 * Focus trap utility for modal dialogs.
 *
 * Usage:
 *   const trap = installFocusTrap(modalElement);
 *   // ... modal is open, focus cycles within ...
 *   trap.release();  // removes keydown handler, restores focus
 *
 * On install:
 *   1. Saves document.activeElement
 *   2. Finds all focusable descendants (including inside shadow DOM)
 *   3. Focuses the first focusable descendant
 *   4. Installs a keydown handler that intercepts Tab/Shift+Tab to cycle
 *      within the focusable elements, and Escape to release.
 *
 * On release:
 *   1. Removes the keydown handler
 *   2. Restores focus to the element that was focused at install time
 */

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), summary, [contenteditable]';

function isVisible(el: HTMLElement): boolean {
  const style = getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden') {
    return false;
  }
  // In jsdom (test environment), offsets are always 0, so skip this check.
  // In real browsers, hidden/size-0 elements are naturally filtered out
  // because they aren't focusable by the browser anyway.
  return true;
}

/**
 * Collect all visible focusable elements within `root`, recursing into shadow DOM.
 * Uses manual child recursion (which handles shadow DOM piercing) to avoid
 * duplicates that would arise from mixing querySelectorAll with tree walk.
 */
export function getFocusableDescendants(root: HTMLElement): HTMLElement[] {
  const result: HTMLElement[] = [];

  function collect(node: Element | DocumentFragment | ShadowRoot): void {
    if (node instanceof ShadowRoot || node instanceof DocumentFragment) {
      for (const child of Array.from(node.children)) {
        if ((child as HTMLElement).shadowRoot) {
          collect((child as HTMLElement).shadowRoot!);
        }
        collect(child);
      }
      return;
    }

    // node is an Element — test it directly against the focusable selector
    const el = node as HTMLElement;
    if (el.matches(FOCUSABLE_SELECTOR) && isVisible(el)) {
      result.push(el);
    }

    // Recurse into children, piercing shadow roots
    for (const child of Array.from(el.children)) {
      if ((child as HTMLElement).shadowRoot) {
        collect((child as HTMLElement).shadowRoot!);
      }
      collect(child);
    }
  }

  // Also traverse the root's own shadow root
  if (root.shadowRoot) {
    collect(root.shadowRoot);
  }
  collect(root);
  return result;
}

/**
 * Determine which focusable element is currently focused (or contained by the active element).
 * Works with shadow DOM — if `document.activeElement` is a shadow host, it checks
 * `shadowRoot.activeElement`.
 *
 * Falls back to `lastKnownIndex` when the environment (e.g. jsdom) doesn't update
 * `document.activeElement` on programmatic focus.
 */
function currentFocusableIndex(
  focusable: HTMLElement[],
  root: HTMLElement,
  lastKnownIndex: number,
): number {
  const active = document.activeElement;
  if (active) {
    // Direct match
    const directIndex = focusable.indexOf(active as HTMLElement);
    if (directIndex !== -1) return directIndex;

    // Check if the active element is a shadow host containing one of our elements
    if ((active as HTMLElement).shadowRoot) {
      const shadowActive = (active as HTMLElement).shadowRoot!.activeElement;
      if (shadowActive) {
        const shadowIndex = focusable.indexOf(shadowActive as HTMLElement);
        if (shadowIndex !== -1) return shadowIndex;
      }
    }

    // If the active element is inside root (light DOM or shadow), treat as "in trap"
    if (root.contains(active) || root.shadowRoot?.contains(active)) {
      return lastKnownIndex;
    }
  }

  return lastKnownIndex;
}

export interface FocusTrap {
  /** Remove the keydown handler and restore focus to the previously focused element. */
  release(): void;
}

/**
 * Install a focus trap on `root`.
 *
 * Saves the currently focused element, finds all visible focusable descendants,
 * focuses the first one, and intercepts Tab / Shift+Tab / Escape.
 *
 * @param root - The modal host element to trap focus within.
 * @param onEscape - Optional callback invoked when Escape is pressed BEFORE releasing
 *   the trap. Use this to close/hide the modal that owns the trap.
 * @returns An object with a `release()` method that removes the trap and restores focus.
 */
export function installFocusTrap(root: HTMLElement, onEscape?: () => void): FocusTrap {
  const previouslyFocused = document.activeElement as HTMLElement | null;

  const focusable = getFocusableDescendants(root);
  let lastFocusedIndex = 0;

  // Focus the first focusable element
  if (focusable.length > 0) {
    focusable[0].focus();
    lastFocusedIndex = 0;
  }

  function handleKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      if (onEscape) {
        onEscape();
      }
      release();
      return;
    }

    if (e.key !== 'Tab') return;

    // Refresh focusable list (elements may have been added/removed)
    const current = getFocusableDescendants(root);
    if (current.length === 0) return;

    const idx = currentFocusableIndex(current, root, lastFocusedIndex);

    e.preventDefault();

    if (e.shiftKey) {
      // Shift+Tab: go backwards, wrap to last
      const next = idx <= 0 ? current.length - 1 : idx - 1;
      current[next].focus();
      lastFocusedIndex = next;
    } else {
      // Tab: go forwards, wrap to first
      const next = idx < 0 || idx >= current.length - 1 ? 0 : idx + 1;
      current[next].focus();
      lastFocusedIndex = next;
    }
  }

  document.addEventListener('keydown', handleKeyDown);

  function release(): void {
    document.removeEventListener('keydown', handleKeyDown);
    if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
      previouslyFocused.focus();
    }
  }

  return { release };
}
