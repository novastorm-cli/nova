import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { JSDOM } from 'jsdom';

// Setup jsdom environment before importing AreaSelector
let dom: JSDOM;
let cleanup: () => void;

beforeEach(() => {
  dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
    url: 'http://localhost',
    pretendToBeVisual: true,
  });

  const origDocument = globalThis.document;
  const origHTMLElement = globalThis.HTMLElement;
  const origImage = globalThis.Image;

  // Expose DOM globals
  globalThis.document = dom.window.document as unknown as Document;
  globalThis.HTMLElement = dom.window.HTMLElement as unknown as typeof HTMLElement;
  globalThis.HTMLDivElement = dom.window.HTMLDivElement as unknown as typeof HTMLDivElement;
  globalThis.Image = dom.window.Image as unknown as typeof Image;
  globalThis.MouseEvent = dom.window.MouseEvent as unknown as typeof MouseEvent;
  globalThis.KeyboardEvent = dom.window.KeyboardEvent as unknown as typeof KeyboardEvent;

  cleanup = () => {
    globalThis.document = origDocument;
    globalThis.HTMLElement = origHTMLElement;
    globalThis.Image = origImage;
  };
});

afterEach(() => {
  cleanup();
});

// Dynamic import so it picks up our patched globals
async function createSelector() {
  // Clear module cache to get fresh instance with current globals
  const mod = await import('../AreaSelector.js');
  return new mod.AreaSelector();
}

describe('AreaSelector', () => {
  it('should start inactive', async () => {
    const selector = await createSelector();
    expect(selector.isActive()).toBe(false);
    selector.destroy();
  });

  it('should become active on activate() and inactive on deactivate()', async () => {
    const selector = await createSelector();

    selector.activate();
    expect(selector.isActive()).toBe(true);

    selector.deactivate();
    expect(selector.isActive()).toBe(false);
    selector.destroy();
  });

  it('should create overlay element on activate', async () => {
    const selector = await createSelector();

    selector.activate();
    const overlay = document.querySelector('[data-nova-area-selector]');
    expect(overlay).not.toBeNull();

    selector.deactivate();
    const overlayAfter = document.querySelector('[data-nova-area-selector]');
    expect(overlayAfter).toBeNull();
    selector.destroy();
  });

  it('should not double-activate', async () => {
    const selector = await createSelector();

    selector.activate();
    selector.activate();

    const overlays = document.querySelectorAll('[data-nova-area-selector]');
    expect(overlays.length).toBe(1);

    selector.deactivate();
    selector.destroy();
  });

  it('should call onCancel when Escape is pressed', async () => {
    const selector = await createSelector();
    const cancelFn = vi.fn();
    selector.onCancel(cancelFn);

    selector.activate();

    const event = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(event);

    expect(cancelFn).toHaveBeenCalledOnce();
    expect(selector.isActive()).toBe(false);
    selector.destroy();
  });

  it('should call onSelect with correct normalized coordinates on drag', async () => {
    const selector = await createSelector();
    const selectFn = vi.fn();
    selector.onSelect(selectFn);

    selector.activate();

    const overlay = document.querySelector('[data-nova-area-selector]') as HTMLElement;
    expect(overlay).not.toBeNull();

    // Simulate mousedown at (100, 100)
    const mousedown = new MouseEvent('mousedown', {
      clientX: 100,
      clientY: 100,
      bubbles: true,
      cancelable: true,
    });
    overlay.dispatchEvent(mousedown);

    // Simulate mousemove to (200, 250)
    const mousemove = new MouseEvent('mousemove', {
      clientX: 200,
      clientY: 250,
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(mousemove);

    // Simulate mouseup at (200, 250)
    const mouseup = new MouseEvent('mouseup', {
      clientX: 200,
      clientY: 250,
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(mouseup);

    expect(selectFn).toHaveBeenCalledOnce();
    expect(selectFn).toHaveBeenCalledWith({
      x: 100,
      y: 100,
      width: 100,
      height: 150,
    });
    selector.destroy();
  });

  it('should normalize coordinates when dragging from bottom-right to top-left', async () => {
    const selector = await createSelector();
    const selectFn = vi.fn();
    selector.onSelect(selectFn);

    selector.activate();

    const overlay = document.querySelector('[data-nova-area-selector]') as HTMLElement;

    // Start from bottom-right (300, 300), end at top-left (100, 100)
    overlay.dispatchEvent(new MouseEvent('mousedown', {
      clientX: 300, clientY: 300, bubbles: true, cancelable: true,
    }));

    document.dispatchEvent(new MouseEvent('mouseup', {
      clientX: 100, clientY: 100, bubbles: true, cancelable: true,
    }));

    expect(selectFn).toHaveBeenCalledWith({
      x: 100,
      y: 100,
      width: 200,
      height: 200,
    });
    selector.destroy();
  });

  it('should ignore selections smaller than 10x10', async () => {
    const selector = await createSelector();
    const selectFn = vi.fn();
    selector.onSelect(selectFn);

    selector.activate();

    const overlay = document.querySelector('[data-nova-area-selector]') as HTMLElement;

    // Tiny drag: 5x5 pixels
    overlay.dispatchEvent(new MouseEvent('mousedown', {
      clientX: 100, clientY: 100, bubbles: true, cancelable: true,
    }));

    document.dispatchEvent(new MouseEvent('mouseup', {
      clientX: 105, clientY: 105, bubbles: true, cancelable: true,
    }));

    expect(selectFn).not.toHaveBeenCalled();
    // Should still be active (not deactivated on tiny selection)
    expect(selector.isActive()).toBe(true);
    selector.deactivate();
    selector.destroy();
  });

  it('should toggle on Alt+A hotkey', async () => {
    const selector = await createSelector();

    // Alt+A to activate
    document.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'a',
      altKey: true,
      bubbles: true,
      cancelable: true,
    }));

    expect(selector.isActive()).toBe(true);

    // Alt+A again to deactivate
    document.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'a',
      altKey: true,
      bubbles: true,
      cancelable: true,
    }));

    expect(selector.isActive()).toBe(false);
    selector.destroy();
  });
});
