import type { IDomCapture } from '../contracts/ICapture.js';
import type { GestureElement } from './GestureTypes.js';

const MAX_DOM_SNIPPET = 500;

export function buildGestureElement(
  element: Element,
  role: GestureElement['role'],
  domCapture: IDomCapture,
): GestureElement {
  const tagName = element.tagName.toLowerCase();
  const selector = buildSelector(element);
  let domSnippet: string;

  try {
    domSnippet = domCapture.captureElement(element as HTMLElement);
  } catch {
    domSnippet = element.outerHTML?.slice(0, MAX_DOM_SNIPPET) ?? '';
  }

  if (domSnippet.length > MAX_DOM_SNIPPET) {
    domSnippet = domSnippet.slice(0, MAX_DOM_SNIPPET);
  }

  return { tagName, selector, domSnippet, role };
}

export function buildSelector(element: Element): string {
  if (element.id) return `#${element.id}`;

  const tag = element.tagName.toLowerCase();
  const classes = Array.from(element.classList).slice(0, 2).join('.');
  if (classes) return `${tag}.${classes}`;

  return tag;
}
