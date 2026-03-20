// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SecretConsole } from '../SecretConsole.js';

describe('SecretConsole', () => {
  let console_: SecretConsole;
  let container: HTMLElement;

  beforeEach(() => {
    console_ = new SecretConsole();
    container = document.createElement('div');
    document.body.appendChild(container);
    console_.mount(container);
  });

  afterEach(() => {
    console_.unmount();
    document.body.innerHTML = '';
  });

  it('mounts a host element with data-nova-secret-console attribute', () => {
    const host = container.querySelector('[data-nova-secret-console]');
    expect(host).not.toBeNull();
  });

  it('is hidden by default after mount', () => {
    const host = container.querySelector('[data-nova-secret-console]') as HTMLElement;
    expect(host.style.display).toBe('none');
  });

  it('show() makes it visible and renders fields for each var', () => {
    console_.show(['API_KEY', 'DATABASE_URL']);

    const host = container.querySelector('[data-nova-secret-console]') as HTMLElement;
    expect(host.style.display).toBe('block');

    const shadow = host.shadowRoot!;
    const inputs = shadow.querySelectorAll('.secret-input');
    expect(inputs.length).toBe(2);

    const labels = shadow.querySelectorAll('.secret-label');
    expect(labels[0].textContent).toBe('API_KEY');
    expect(labels[1].textContent).toBe('DATABASE_URL');
  });

  it('hide() hides the component', () => {
    console_.show(['API_KEY']);
    console_.hide();

    const host = container.querySelector('[data-nova-secret-console]') as HTMLElement;
    expect(host.style.display).toBe('none');
  });

  it('inputs are password type by default', () => {
    console_.show(['SECRET']);

    const host = container.querySelector('[data-nova-secret-console]') as HTMLElement;
    const input = host.shadowRoot!.querySelector('.secret-input') as HTMLInputElement;
    expect(input.type).toBe('password');
  });

  it('toggle button switches input type between password and text', () => {
    console_.show(['SECRET']);

    const host = container.querySelector('[data-nova-secret-console]') as HTMLElement;
    const shadow = host.shadowRoot!;
    const input = shadow.querySelector('.secret-input') as HTMLInputElement;
    const toggle = shadow.querySelector('.secret-toggle') as HTMLButtonElement;

    toggle.click();
    expect(input.type).toBe('text');

    toggle.click();
    expect(input.type).toBe('password');
  });

  it('Save button calls onSubmit handler with filled values', () => {
    const handler = vi.fn();
    console_.onSubmit(handler);
    console_.show(['API_KEY', 'DB_URL']);

    const host = container.querySelector('[data-nova-secret-console]') as HTMLElement;
    const shadow = host.shadowRoot!;
    const inputs = shadow.querySelectorAll<HTMLInputElement>('.secret-input');

    // Simulate typing
    inputs[0].value = 'sk_test_123';
    inputs[1].value = 'postgres://localhost';

    const saveBtn = shadow.querySelector('.secret-btn-save') as HTMLButtonElement;
    saveBtn.click();

    expect(handler).toHaveBeenCalledWith({
      API_KEY: 'sk_test_123',
      DB_URL: 'postgres://localhost',
    });
  });

  it('Save button does not call handler when all inputs are empty', () => {
    const handler = vi.fn();
    console_.onSubmit(handler);
    console_.show(['API_KEY']);

    const host = container.querySelector('[data-nova-secret-console]') as HTMLElement;
    const shadow = host.shadowRoot!;

    const saveBtn = shadow.querySelector('.secret-btn-save') as HTMLButtonElement;
    saveBtn.click();

    expect(handler).not.toHaveBeenCalled();
  });

  it('Skip button calls onSkip handler and hides the console', () => {
    const handler = vi.fn();
    console_.onSkip(handler);
    console_.show(['API_KEY']);

    const host = container.querySelector('[data-nova-secret-console]') as HTMLElement;
    const shadow = host.shadowRoot!;

    const skipBtn = shadow.querySelector('.secret-btn-skip') as HTMLButtonElement;
    skipBtn.click();

    expect(handler).toHaveBeenCalled();
    expect(host.style.display).toBe('none');
  });

  it('unmount removes the host element from the container', () => {
    console_.unmount();

    const host = container.querySelector('[data-nova-secret-console]');
    expect(host).toBeNull();
  });
});
