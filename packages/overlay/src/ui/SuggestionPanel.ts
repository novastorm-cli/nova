import { Z_INDEX, COLORS } from './styles.js';
import type { ISuggestionPanel, SuggestionItem } from '../contracts/IOverlayUI.js';

export class SuggestionPanel implements ISuggestionPanel {
  private host: HTMLElement | null = null;
  private shadow: ShadowRoot | null = null;
  private listEl: HTMLElement | null = null;
  private panelEl: HTMLElement | null = null;
  private suggestions: Map<string, SuggestionItem> = new Map();
  private responseHandler: ((suggestionId: string, approved: boolean) => void) | null = null;

  mount(container: HTMLElement): void {
    this.host = document.createElement('div');
    this.host.setAttribute('data-nova-suggestion-panel', '');
    this.host.style.position = 'fixed';
    this.host.style.bottom = '80px';
    this.host.style.left = '20px';
    this.host.style.zIndex = String(Z_INDEX.suggestionPanel);
    this.host.style.pointerEvents = 'none';

    this.shadow = this.host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = this.getStyles();
    this.shadow.appendChild(style);

    this.panelEl = document.createElement('div');
    this.panelEl.className = 'suggestion-panel hidden';

    const title = document.createElement('div');
    title.className = 'suggestion-panel-title';
    title.textContent = 'Nova Suggestions';
    this.panelEl.appendChild(title);

    this.listEl = document.createElement('div');
    this.listEl.className = 'suggestion-list';
    this.panelEl.appendChild(this.listEl);

    this.shadow.appendChild(this.panelEl);
    container.appendChild(this.host);
  }

  unmount(): void {
    this.host?.remove();
    this.host = null;
    this.shadow = null;
    this.listEl = null;
    this.panelEl = null;
    this.suggestions.clear();
  }

  addSuggestion(suggestion: SuggestionItem): void {
    if (this.suggestions.has(suggestion.id)) return;
    this.suggestions.set(suggestion.id, suggestion);

    const row = this.createSuggestionRow(suggestion);
    this.listEl?.appendChild(row);
    this.show();
  }

  removeSuggestion(id: string): void {
    this.suggestions.delete(id);
    if (!this.shadow) return;

    const row = this.shadow.querySelector(`[data-suggestion-id="${id}"]`);
    row?.remove();

    if (this.suggestions.size === 0) {
      this.hide();
    }
  }

  onResponse(handler: (suggestionId: string, approved: boolean) => void): void {
    this.responseHandler = handler;
  }

  private show(): void {
    this.panelEl?.classList.remove('hidden');
  }

  private hide(): void {
    this.panelEl?.classList.add('hidden');
  }

  private createSuggestionRow(suggestion: SuggestionItem): HTMLElement {
    const row = document.createElement('div');
    row.className = 'suggestion-row';
    row.setAttribute('data-suggestion-id', suggestion.id);

    const content = document.createElement('div');
    content.className = 'suggestion-content';

    const titleEl = document.createElement('div');
    titleEl.className = 'suggestion-title';
    titleEl.textContent = suggestion.title;

    const descEl = document.createElement('div');
    descEl.className = 'suggestion-desc';
    descEl.textContent = suggestion.description;

    content.appendChild(titleEl);
    content.appendChild(descEl);

    const actions = document.createElement('div');
    actions.className = 'suggestion-actions';

    const approveBtn = document.createElement('button');
    approveBtn.className = 'suggestion-btn approve';
    approveBtn.textContent = 'Approve';
    approveBtn.addEventListener('click', () => {
      this.responseHandler?.(suggestion.id, true);
      this.removeSuggestion(suggestion.id);
    });

    const rejectBtn = document.createElement('button');
    rejectBtn.className = 'suggestion-btn reject';
    rejectBtn.textContent = 'Reject';
    rejectBtn.addEventListener('click', () => {
      this.responseHandler?.(suggestion.id, false);
      this.removeSuggestion(suggestion.id);
    });

    actions.appendChild(approveBtn);
    actions.appendChild(rejectBtn);

    row.appendChild(content);
    row.appendChild(actions);

    return row;
  }

  private getStyles(): string {
    return `
      .suggestion-panel {
        background: ${COLORS.overlayBg}ee;
        border-radius: 10px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
        max-width: 380px;
        min-width: 280px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        pointer-events: auto;
        opacity: 1;
        transform: translateY(0);
        transition: opacity 0.3s ease, transform 0.3s ease;
        overflow: hidden;
      }

      .suggestion-panel.hidden {
        opacity: 0;
        transform: translateY(10px);
        pointer-events: none;
      }

      .suggestion-panel-title {
        padding: 12px 16px 8px;
        font-size: 13px;
        font-weight: 600;
        color: ${COLORS.textSecondary};
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }

      .suggestion-list {
        padding: 0 12px 12px;
        display: flex;
        flex-direction: column;
        gap: 8px;
        max-height: 400px;
        overflow-y: auto;
      }

      .suggestion-row {
        padding: 10px 12px;
        border-radius: 8px;
        background: rgba(255, 255, 255, 0.04);
        border: 1px solid ${COLORS.inputBorder};
      }

      .suggestion-content {
        margin-bottom: 8px;
      }

      .suggestion-title {
        font-size: 13px;
        font-weight: 600;
        color: ${COLORS.textPrimary};
        margin-bottom: 4px;
      }

      .suggestion-desc {
        font-size: 12px;
        color: ${COLORS.textSecondary};
        line-height: 1.4;
      }

      .suggestion-actions {
        display: flex;
        gap: 8px;
      }

      .suggestion-btn {
        padding: 4px 12px;
        border-radius: 4px;
        border: none;
        font-size: 12px;
        font-weight: 500;
        cursor: pointer;
        transition: opacity 0.2s ease;
      }

      .suggestion-btn:hover {
        opacity: 0.85;
      }

      .suggestion-btn.approve {
        background: ${COLORS.success};
        color: ${COLORS.white};
      }

      .suggestion-btn.reject {
        background: ${COLORS.error};
        color: ${COLORS.white};
      }
    `;
  }
}
