import type { IDomCapture } from '../contracts/ICapture.js';

const NOISY_ATTRIBUTES = new Set(['data-reactid', 'data-testid']);
const COMPUTED_STYLE_KEYS: readonly string[] = [
  'color',
  'background',
  'font-size',
  'display',
  'position',
] as const;
const MAX_CLASS_LENGTH = 100;
const MAX_OUTPUT_LENGTH = 2000;
const PARENT_LEVELS = 2;

export class DomCapture implements IDomCapture {
  captureElement(element: HTMLElement): string {
    const ancestors = this.getAncestors(element, PARENT_LEVELS);
    const rootElement = ancestors.length > 0 ? ancestors[ancestors.length - 1] : element;

    const clone = rootElement.cloneNode(true) as HTMLElement;
    this.cleanNode(clone, rootElement, element);

    let html = clone.outerHTML;
    if (html.length > MAX_OUTPUT_LENGTH) {
      html = html.slice(0, MAX_OUTPUT_LENGTH);
    }

    return html;
  }

  private getAncestors(element: HTMLElement, levels: number): HTMLElement[] {
    const ancestors: HTMLElement[] = [];
    let current: HTMLElement | null = element;

    for (let i = 0; i < levels; i++) {
      const parent: HTMLElement | null = current?.parentElement ?? null;
      if (!parent) break;
      ancestors.push(parent);
      current = parent;
    }

    return ancestors;
  }

  private cleanNode(
    cloneNode: HTMLElement,
    originalNode: HTMLElement,
    targetElement: HTMLElement,
  ): void {
    this.stripNoisyAttributes(cloneNode);

    if (originalNode === targetElement) {
      this.addComputedStyles(cloneNode, originalNode);
    }

    const cloneChildren = Array.from(cloneNode.children) as HTMLElement[];
    const originalChildren = Array.from(originalNode.children) as HTMLElement[];

    for (let i = 0; i < cloneChildren.length && i < originalChildren.length; i++) {
      this.cleanNode(cloneChildren[i], originalChildren[i], targetElement);
    }
  }

  private stripNoisyAttributes(node: HTMLElement): void {
    for (const attr of NOISY_ATTRIBUTES) {
      node.removeAttribute(attr);
    }

    const classValue = node.getAttribute('class');
    if (classValue && classValue.length > MAX_CLASS_LENGTH) {
      node.removeAttribute('class');
    }
  }

  private addComputedStyles(cloneNode: HTMLElement, originalNode: HTMLElement): void {
    const computed = window.getComputedStyle(originalNode);
    const styles: string[] = [];

    for (const key of COMPUTED_STYLE_KEYS) {
      const value = computed.getPropertyValue(key);
      if (value) {
        styles.push(`${key}: ${value}`);
      }
    }

    if (styles.length > 0) {
      const existing = cloneNode.getAttribute('style') ?? '';
      const separator = existing && !existing.endsWith(';') ? '; ' : '';
      cloneNode.setAttribute('style', `${existing}${separator}${styles.join('; ')}`);
    }
  }
}
