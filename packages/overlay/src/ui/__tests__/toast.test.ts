// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { StatusToast } from '../StatusToast.js';

describe('StatusToast', () => {
  let toast: StatusToast;

  beforeEach(() => {
    vi.useFakeTimers();
    toast = new StatusToast();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    toast.dismissAll();
    vi.useRealTimers();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('show("msg", "info") returns a string id and toast is visible in DOM', () => {
    const id = toast.show('Hello', 'info');

    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);

    // Toast element should be in the DOM
    const toastEl =
      document.querySelector(`[data-toast-id="${id}"]`) ??
      document.querySelector('[role="alert"]') ??
      document.querySelector('[class*="toast"]');
    expect(toastEl).not.toBeNull();
  });

  it('show("msg", "error") does NOT auto-dismiss', () => {
    const id = toast.show('Error occurred', 'error');

    // Advance well past the default 5s auto-dismiss
    vi.advanceTimersByTime(10_000);

    // Toast should still be in the DOM
    const toastEl =
      document.querySelector(`[data-toast-id="${id}"]`) ??
      document.querySelector('[role="alert"]') ??
      document.querySelector('[class*="toast"]');
    expect(toastEl).not.toBeNull();
  });

  it('dismiss(id) removes the toast from DOM', () => {
    const id = toast.show('Dismiss me', 'info');
    toast.dismiss(id);

    const toastEl = document.querySelector(`[data-toast-id="${id}"]`);
    // If toastEl exists it should not be visible; or it should be removed
    // Check that the element is gone
    expect(toastEl).toBeNull();
  });

  it('dismissAll() removes all toasts from DOM', () => {
    toast.show('First', 'info');
    toast.show('Second', 'success');
    toast.show('Third', 'error');

    toast.dismissAll();

    const remaining =
      document.querySelectorAll('[data-toast-id]').length ||
      document.querySelectorAll('[role="alert"]').length;
    expect(remaining).toBe(0);
  });

  it('max 5 visible: showing 6th removes the oldest', () => {
    const ids: string[] = [];
    for (let i = 0; i < 6; i++) {
      ids.push(toast.show(`Toast ${i}`, 'error')); // error so they don't auto-dismiss
    }

    // The first toast should have been dismissed
    const firstToast = document.querySelector(`[data-toast-id="${ids[0]}"]`);
    expect(firstToast).toBeNull();

    // The remaining 5 should still exist
    for (let i = 1; i <= 5; i++) {
      const el = document.querySelector(`[data-toast-id="${ids[i]}"]`);
      expect(el).not.toBeNull();
    }
  });

  it('onClick callback is called with id when toast is clicked', () => {
    const clickHandler = vi.fn();
    toast.onClick(clickHandler);

    const id = toast.show('Click me', 'info');

    const toastEl =
      document.querySelector(`[data-toast-id="${id}"]`) ??
      document.querySelector('[role="alert"]') ??
      document.querySelector('[class*="toast"]');
    expect(toastEl).not.toBeNull();

    toastEl!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(clickHandler).toHaveBeenCalledWith(id);
  });
});
