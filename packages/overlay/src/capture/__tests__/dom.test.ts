// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { DomCapture } from '../DomCapture.js';

describe('DomCapture', () => {
  let capture: DomCapture;

  beforeEach(() => {
    capture = new DomCapture();
    document.body.innerHTML = '';
  });

  it('captureElement(el) returns HTML string containing the element', () => {
    const el = document.createElement('span');
    el.textContent = 'hello';
    document.body.appendChild(el);

    const result = capture.captureElement(el);

    expect(typeof result).toBe('string');
    expect(result).toContain('hello');
  });

  it('includes parent elements in the output', () => {
    const grandparent = document.createElement('section');
    grandparent.id = 'gp';
    const parent = document.createElement('div');
    parent.id = 'parent';
    const child = document.createElement('span');
    child.id = 'child';
    child.textContent = 'target';

    grandparent.appendChild(parent);
    parent.appendChild(child);
    document.body.appendChild(grandparent);

    const result = capture.captureElement(child);

    expect(result).toContain('child');
    expect(result).toContain('parent');
    expect(result).toContain('gp');
  });

  it('strips data-reactid attributes', () => {
    const el = document.createElement('div');
    el.setAttribute('data-reactid', '.0.1.2');
    el.textContent = 'react-node';
    document.body.appendChild(el);

    const result = capture.captureElement(el);

    expect(result).not.toContain('data-reactid');
  });

  it('strips class names longer than 100 characters', () => {
    const longClass = 'a'.repeat(101);
    const el = document.createElement('div');
    el.className = longClass;
    el.textContent = 'long-class-node';
    document.body.appendChild(el);

    const result = capture.captureElement(el);

    expect(result).not.toContain(longClass);
  });

  it('result is at most ~2000 characters', () => {
    const wrapper = document.createElement('div');
    for (let i = 0; i < 50; i++) {
      const child = document.createElement('p');
      child.textContent = 'x'.repeat(100);
      wrapper.appendChild(child);
    }
    document.body.appendChild(wrapper);

    const target = wrapper.querySelector('p')!;
    const result = capture.captureElement(target);

    expect(result.length).toBeLessThanOrEqual(2000);
  });
});
