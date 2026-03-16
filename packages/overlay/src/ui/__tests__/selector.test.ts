// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ElementSelector } from '../ElementSelector.js';

describe('ElementSelector', () => {
  let selector: ElementSelector;
  let targetEl: HTMLElement;

  beforeEach(() => {
    targetEl = document.createElement('div');
    targetEl.id = 'target';
    targetEl.textContent = 'Select me';
    document.body.appendChild(targetEl);
    selector = new ElementSelector();
  });

  afterEach(() => {
    selector.deactivate();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('activate() sets isActive() to true', () => {
    expect(selector.isActive()).toBe(false);
    selector.activate();
    expect(selector.isActive()).toBe(true);
  });

  it('mouseover on element gives it an outline style when active', () => {
    selector.activate();

    targetEl.dispatchEvent(
      new MouseEvent('mouseover', { bubbles: true }),
    );

    // Contract says "2px solid blue" outline
    const outline = targetEl.style.outline;
    expect(outline).toContain('2px');
    expect(outline.toLowerCase()).toContain('blue');
  });

  it('click on element calls onSelect with element and deactivates', () => {
    const selectHandler = vi.fn();
    selector.onSelect(selectHandler);
    selector.activate();

    targetEl.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true }),
    );

    expect(selectHandler).toHaveBeenCalledWith(targetEl);
    expect(selector.isActive()).toBe(false);
  });

  it('Escape cancels selection and calls onCancel', () => {
    const cancelHandler = vi.fn();
    selector.onCancel(cancelHandler);
    selector.activate();

    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );

    expect(cancelHandler).toHaveBeenCalledTimes(1);
    expect(selector.isActive()).toBe(false);
  });

  it('deactivate() removes outlines and sets isActive() to false', () => {
    selector.activate();

    // Hover to apply outline
    targetEl.dispatchEvent(
      new MouseEvent('mouseover', { bubbles: true }),
    );
    expect(targetEl.style.outline).toContain('2px');

    selector.deactivate();

    expect(selector.isActive()).toBe(false);
    // Outline should be removed
    expect(targetEl.style.outline).toBe('');
  });
});
