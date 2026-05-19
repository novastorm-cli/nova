// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ElementInspector } from '../ElementInspector.js';

describe('ElementInspector', () => {
  let inspector: ElementInspector;
  let container: HTMLElement;

  beforeEach(() => {
    inspector = new ElementInspector();
    container = document.createElement('div');
    document.body.appendChild(container);
    inspector.mount(container);
  });

  afterEach(() => {
    inspector.unmount();
    document.body.innerHTML = '';
  });

  it('isPopupVisible() returns false by default', () => {
    expect(inspector.isPopupVisible()).toBe(false);
  });

  it('isPopupVisible() returns true after showPopupForElement()', () => {
    const target = document.createElement('button');
    target.id = 'test-btn';
    document.body.appendChild(target);

    inspector.showPopupForElement(target, 200, 200);
    expect(inspector.isPopupVisible()).toBe(true);

    target.remove();
  });

  it('isPopupVisible() returns false after deactivate()', () => {
    const target = document.createElement('button');
    target.id = 'test-btn';
    document.body.appendChild(target);

    inspector.showPopupForElement(target, 200, 200);
    expect(inspector.isPopupVisible()).toBe(true);

    inspector.deactivate();
    expect(inspector.isPopupVisible()).toBe(false);

    target.remove();
  });

  it('popup has role=dialog and aria-modal=true when visible', () => {
    const target = document.createElement('button');
    target.id = 'test-btn';
    document.body.appendChild(target);

    inspector.showPopupForElement(target, 200, 200);
    expect(inspector.isPopupVisible()).toBe(true);

    // The popup is rendered inside the shadow DOM of the host
    const host = container.querySelector('[data-nova="inspector"]') as HTMLElement;
    expect(host).not.toBeNull();
    const shadow = host.shadowRoot!;
    const popup = shadow.querySelector('.inspector-popup') as HTMLElement;
    expect(popup).not.toBeNull();
    expect(popup.getAttribute('role')).toBe('dialog');
    expect(popup.getAttribute('aria-modal')).toBe('true');

    target.remove();
  });

  it('popup is hidden after deactivate() via DOM state', () => {
    const target = document.createElement('button');
    target.id = 'test-btn';
    document.body.appendChild(target);

    inspector.showPopupForElement(target, 200, 200);
    expect(inspector.isPopupVisible()).toBe(true);

    inspector.deactivate();
    expect(inspector.isPopupVisible()).toBe(false);

    const host = container.querySelector('[data-nova="inspector"]') as HTMLElement;
    const shadow = host.shadowRoot!;
    const popup = shadow.querySelector('.inspector-popup') as HTMLElement;
    expect(popup.style.display).toBe('none');

    target.remove();
  });
});
