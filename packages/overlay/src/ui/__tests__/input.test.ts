// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CommandInput } from '../CommandInput.js';

describe('CommandInput', () => {
  let input: CommandInput;
  let anchor: HTMLElement;

  beforeEach(() => {
    anchor = document.createElement('div');
    anchor.style.position = 'absolute';
    anchor.style.top = '100px';
    anchor.style.left = '100px';
    document.body.appendChild(anchor);
    input = new CommandInput();

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

  it('show(anchor) makes the input visible and input element exists', () => {
    input.show(anchor);

    expect(input.isVisible()).toBe(true);
    // There should be an <input> or <textarea> in the DOM
    const inputEl =
      document.querySelector('input[type="text"]') ??
      document.querySelector('input:not([type])') ??
      document.querySelector('textarea') ??
      document.querySelector('input');
    expect(inputEl).not.toBeNull();
  });

  it('hide() makes the input not visible', () => {
    input.show(anchor);
    expect(input.isVisible()).toBe(true);

    input.hide();
    expect(input.isVisible()).toBe(false);
  });

  it('Enter key calls onSubmit with the text value', () => {
    const submitHandler = vi.fn();
    input.onSubmit(submitHandler);
    input.show(anchor);

    // Find the actual input element and set its value
    const inputEl = (document.querySelector('input') ??
      document.querySelector('textarea'))!;
    expect(inputEl).not.toBeNull();

    // Simulate typing
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )?.set?.call(inputEl, 'hello world');
    inputEl.value = 'hello world';
    inputEl.dispatchEvent(new Event('input', { bubbles: true }));

    // Press Enter
    inputEl.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
    );

    expect(submitHandler).toHaveBeenCalledWith('hello world');
  });

  it('Escape key calls onClose', () => {
    const closeHandler = vi.fn();
    input.onClose(closeHandler);
    input.show(anchor);

    const inputEl = (document.querySelector('input') ??
      document.querySelector('textarea'))!;

    inputEl.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );

    expect(closeHandler).toHaveBeenCalledTimes(1);
  });

  it('setTranscript("text") updates the input value', () => {
    input.show(anchor);
    input.setTranscript('transcribed text');

    const inputEl = (document.querySelector('input') ??
      document.querySelector('textarea'))!;

    expect(inputEl.value).toBe('transcribed text');
  });
});
