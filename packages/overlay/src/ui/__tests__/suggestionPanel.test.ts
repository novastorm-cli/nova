/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SuggestionPanel } from '../SuggestionPanel.js';
import type { SuggestionItem } from '../../contracts/IOverlayUI.js';

function createSuggestionItem(overrides: Partial<SuggestionItem> = {}): SuggestionItem {
  return {
    id: 'sug-' + Math.random().toString(36).slice(2, 8),
    title: 'Test suggestion',
    description: 'Test description for the suggestion',
    ...overrides,
  };
}

describe('SuggestionPanel', () => {
  let panel: SuggestionPanel;
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    panel = new SuggestionPanel();
  });

  afterEach(() => {
    panel.unmount();
    container.remove();
  });

  it('should mount and create shadow DOM', () => {
    panel.mount(container);

    const host = container.querySelector('[data-nova-suggestion-panel]');
    expect(host).not.toBeNull();
    expect(host?.shadowRoot).not.toBeNull();
  });

  it('should be hidden initially', () => {
    panel.mount(container);

    const host = container.querySelector('[data-nova-suggestion-panel]');
    const panelEl = host?.shadowRoot?.querySelector('.suggestion-panel');
    expect(panelEl?.classList.contains('hidden')).toBe(true);
  });

  it('should show panel when suggestion is added', () => {
    panel.mount(container);
    panel.addSuggestion(createSuggestionItem({ id: 'test-1' }));

    const host = container.querySelector('[data-nova-suggestion-panel]');
    const panelEl = host?.shadowRoot?.querySelector('.suggestion-panel');
    expect(panelEl?.classList.contains('hidden')).toBe(false);
  });

  it('should render suggestion title and description', () => {
    panel.mount(container);
    panel.addSuggestion(createSuggestionItem({
      id: 'render-test',
      title: 'My Title',
      description: 'My Description',
    }));

    const host = container.querySelector('[data-nova-suggestion-panel]');
    const title = host?.shadowRoot?.querySelector('.suggestion-title');
    const desc = host?.shadowRoot?.querySelector('.suggestion-desc');
    expect(title?.textContent).toBe('My Title');
    expect(desc?.textContent).toBe('My Description');
  });

  it('should render approve and reject buttons', () => {
    panel.mount(container);
    panel.addSuggestion(createSuggestionItem({ id: 'btn-test' }));

    const host = container.querySelector('[data-nova-suggestion-panel]');
    const approveBtn = host?.shadowRoot?.querySelector('.suggestion-btn.approve');
    const rejectBtn = host?.shadowRoot?.querySelector('.suggestion-btn.reject');
    expect(approveBtn?.textContent).toBe('Approve');
    expect(rejectBtn?.textContent).toBe('Reject');
  });

  it('should call response handler on approve', () => {
    panel.mount(container);
    const handler = vi.fn();
    panel.onResponse(handler);

    panel.addSuggestion(createSuggestionItem({ id: 'approve-test' }));

    const host = container.querySelector('[data-nova-suggestion-panel]');
    const approveBtn = host?.shadowRoot?.querySelector('.suggestion-btn.approve') as HTMLElement;
    approveBtn.click();

    expect(handler).toHaveBeenCalledWith('approve-test', true);
  });

  it('should call response handler on reject', () => {
    panel.mount(container);
    const handler = vi.fn();
    panel.onResponse(handler);

    panel.addSuggestion(createSuggestionItem({ id: 'reject-test' }));

    const host = container.querySelector('[data-nova-suggestion-panel]');
    const rejectBtn = host?.shadowRoot?.querySelector('.suggestion-btn.reject') as HTMLElement;
    rejectBtn.click();

    expect(handler).toHaveBeenCalledWith('reject-test', false);
  });

  it('should remove suggestion after approve/reject', () => {
    panel.mount(container);
    panel.onResponse(vi.fn());
    panel.addSuggestion(createSuggestionItem({ id: 'remove-test' }));

    const host = container.querySelector('[data-nova-suggestion-panel]');
    const approveBtn = host?.shadowRoot?.querySelector('.suggestion-btn.approve') as HTMLElement;
    approveBtn.click();

    const row = host?.shadowRoot?.querySelector('[data-suggestion-id="remove-test"]');
    expect(row).toBeNull();
  });

  it('should hide panel when all suggestions are removed', () => {
    panel.mount(container);
    panel.onResponse(vi.fn());

    panel.addSuggestion(createSuggestionItem({ id: 'only-one' }));
    panel.removeSuggestion('only-one');

    const host = container.querySelector('[data-nova-suggestion-panel]');
    const panelEl = host?.shadowRoot?.querySelector('.suggestion-panel');
    expect(panelEl?.classList.contains('hidden')).toBe(true);
  });

  it('should not add duplicate suggestions', () => {
    panel.mount(container);
    panel.addSuggestion(createSuggestionItem({ id: 'dup' }));
    panel.addSuggestion(createSuggestionItem({ id: 'dup' }));

    const host = container.querySelector('[data-nova-suggestion-panel]');
    const rows = host?.shadowRoot?.querySelectorAll('.suggestion-row');
    expect(rows?.length).toBe(1);
  });

  it('should clean up on unmount', () => {
    panel.mount(container);
    panel.unmount();

    const host = container.querySelector('[data-nova-suggestion-panel]');
    expect(host).toBeNull();
  });
});
